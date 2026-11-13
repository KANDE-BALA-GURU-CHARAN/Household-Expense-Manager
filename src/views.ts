import * as XLSX from 'xlsx';
import {
  renderBudgetDumbbell,
  renderBudgetProgressCards,
  renderBudgetScatterOLS,
  renderCashFlowProjectionChart,
  renderCategorySparklines,
  renderCompositionStack,
  renderIncomeOutflowBar,
  renderLoanProgress,
  renderMoneyFlowBar,
  renderObligationsTimeline,
  renderRotatedKpiBars,
  renderSavingsTrend,
  renderScrollyColumns,
  renderSpendingHeatmap,
  renderUnitMatrix,
  renderWaffleAllocation
} from './charts';
import { MAX_MEMBERS, MONTHS, REPORTS, ROLES, SEED, THEMES } from './constants';
import {
  compareLoanStrategies,
  computeFinancialSummary,
  deriveProfileFromLedger,
  expenseToMonthly,
  generateAdvisorInsights,
  getAlertState,
  incomeToMonthly,
  isLoanObligation,
  isTaxObligation,
  obligationToMonthly,
  todayIsoLocal
} from './intelligence';
import { createDefaultProfile, normalizeProfile, saveProfile, uid } from './profileStore';
import {
  buildComprehensiveReportData,
  exportFinancialReportExcel,
  exportFinancialReportPdf
} from './reportExport';
import { Backend, DB, Net, Perm, SessionContext } from './storage';
import type { ThemePanelApi } from './theme';
import type {
  AssetKind,
  ExpenseCategoryKind,
  ExpenseFrequency,
  FilterState,
  FinancialProfile,
  FinancialSummary,
  IncomeFrequency,
  IncomeKind,
  LiabilityKind,
  Member,
  ObligationItem,
  ObligationKind,
  ObligationStatus,
  EntryOrigin,
  ReportId,
  Role,
  TaxRegime,
  ThemeId,
  Transaction,
  AdvisorRecommendation
} from './types';
import {
  $,
  $$,
  compactMoney,
  countUpCurrency,
  download,
  el,
  esc,
  filterTransactions,
  fmtDate,
  fmtIn,
  groupBy,
  isDue,
  isPaid,
  money,
  monthOf,
  num,
  signed,
  toCsv,
  toast,
  totals,
  uniq,
  yearOf
} from './utils';

export interface AppState {
  tx: Transaction[];
  profile: FinancialProfile;
  nextId: number;
  editId: number | null;
  editIncomeId: string | null;
  editExpenseId: string | null;
  editObligId: string | null;
  filters: FilterState;
  unitMode: 'all' | 'type' | 'member' | 'status' | 'pm';
  ovSparkMode: 'all' | 'INCOME' | 'EXPENSE';
  compMode: 'outflow' | 'pm';
  bProgFilter: 'all' | 'alerts' | 'healthy';
  dumbSort: 'spent' | 'budget' | 'variance';
  rotMember: string;
  hmAxis: 'member' | 'month';
  hmThresh: number;
  svMember: string;
  tSearch: string;
  tStatusFilter: 'ALL' | 'PAID' | 'TO BE PAID';
  tSize: number;
  tPage: number;
  tSortKey: keyof Transaction | 'year' | 'month';
  tSortDir: 'asc' | 'desc';
  scrollyStep: number;
  scrollyMode: 'abs' | 'share';
  scrollySeries: Set<string>;
  scatterTypes: Set<string>;
  scatterMinBudget: number;
  scatterTrend: boolean;
  reportId: ReportId;
  reportEntity: string;
  advPriority: 'ALL' | 'High' | 'Medium' | 'Low';
  repFromDate: string;
  repToDate: string;
  repPreset: 'all' | 'month' | '3m' | 'year';
  importMode: 'merge' | 'replace';
  hasAnimatedKpis: boolean;
}

export function createInitialState(): AppState {
  return {
    tx: [],
    profile: createDefaultProfile(),
    nextId: 1,
    editId: null,
    editIncomeId: null,
    editExpenseId: null,
    editObligId: null,
    filters: {
      year: 'ALL',
      month: 'ALL',
      member: 'ALL',
      type: 'ALL',
      category: 'ALL',
      pm: 'ALL',
      status: 'ALL'
    },
    unitMode: 'type',
    ovSparkMode: 'all',
    compMode: 'outflow',
    bProgFilter: 'all',
    dumbSort: 'spent',
    rotMember: 'ALL',
    hmAxis: 'member',
    hmThresh: 0,
    svMember: 'ALL',
    tSearch: '',
    tStatusFilter: 'ALL',
    tSize: 20,
    tPage: 1,
    tSortKey: 'id',
    tSortDir: 'desc',
    scrollyStep: 0,
    scrollyMode: 'abs',
    scrollySeries: new Set(['expense', 'loan', 'saving']),
    scatterTypes: new Set(['EXPENSE', 'LOAN', 'SAVING']),
    scatterMinBudget: 0,
    scatterTrend: true,
    reportId: 'monthly',
    reportEntity: 'ALL',
    advPriority: 'ALL',
    repFromDate: '',
    repToDate: '',
    repPreset: 'all',
    importMode: 'merge',
    hasAnimatedKpis: false
  };
}

export interface ViewsController {
  renderAll: () => void;
  openTxDialog: (row?: Transaction | null, preset?: Partial<Transaction>) => void;
  closeTxDialog: () => void;
  markPaid: (id: number) => void;
  markObligationPaid: (id: string) => void;
  syncFormState: () => void;
  wireEvents: () => void;
}

function askConfirm(title: string, message: string, okLabel = 'Confirm'): Promise<boolean> {
  return new Promise(resolve => {
    const dlg = $('#confirmDialog') as HTMLDialogElement | null;
    const tEl = $('#confirmTitle');
    const bEl = $('#confirmBody');
    const okBtn = $('#confirmOk') as HTMLButtonElement | null;
    const cancelBtn = $('#confirmCancel') as HTMLButtonElement | null;
    if (!dlg || !okBtn || !cancelBtn) {
      resolve(true);
      return;
    }
    if (tEl) tEl.textContent = title;
    if (bEl) bEl.textContent = message;
    okBtn.textContent = okLabel;

    const cleanup = (res: boolean) => {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      dlg.removeEventListener('cancel', onDialogCancel);
      if (dlg.open) dlg.close();
      resolve(res);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onDialogCancel = (e: Event) => {
      e.preventDefault();
      cleanup(false);
    };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    dlg.addEventListener('cancel', onDialogCancel);
    dlg.showModal();
  });
}

export function createViews(
  S: AppState,
  persist: () => void,
  themeApi: ThemePanelApi,
  onSignOut: () => void
): ViewsController {
  function filtered(): Transaction[] {
    return filterTransactions(S.tx, S.filters);
  }

  function persistProfile() {
    saveProfile(SessionContext.hid, S.profile);
    renderAll();
  }

  function markObligationPaid(id: string) {
    if (!Perm.demand('edit')) return;
    const ob = S.profile.obligations.find(o => o.id === id);
    if (!ob) return;
    ob.status = 'Paid';
    ob.amountDue = 0;
    ob.entrySource = 'confirmed';
    persistProfile();
    toast(`Marked obligation "${ob.name}" as Paid`, 'ok');
  }

  function recomputeNextId() {
    S.nextId = S.tx.reduce((m, r) => Math.max(m, num(r.id)), 0) + 1;
  }

  function renderHeaderMeta() {
    const house = $('#heroHouse');
    const user = $('#heroUser');
    const sync = $('#heroSync');
    const rowsCount = $('#heroRowsCount');
    if (house && SessionContext.house) house.textContent = SessionContext.house.name;
    if (user && SessionContext.me) {
      const label = SessionContext.me.name || SessionContext.me.email;
      user.textContent = `${label} · ${ROLES[SessionContext.me.role].name}`;
    }
    if (sync) {
      sync.textContent =
        Net.mode === 'firebase'
          ? 'Firebase E2EE'
          : Net.online
            ? `Server synced`
            : 'Device ledger';
    }
    if (rowsCount) rowsCount.textContent = `${S.tx.length} entries`;
  }

  function populateFilterDropdowns() {
    const pairs: Array<[string, string[], keyof FilterState]> = [
      ['#fYear', uniq(S.tx.map(yearOf)), 'year'],
      ['#fMonth', MONTHS.filter(m => S.tx.some(r => monthOf(r) === m)), 'month'],
      ['#fMember', uniq(S.tx.map(r => r.member)), 'member'],
      ['#fType', uniq(S.tx.map(r => r.type)), 'type'],
      ['#fCategory', uniq(S.tx.map(r => r.category)), 'category'],
      ['#fPm', uniq(S.tx.map(r => r.pm)), 'pm'],
      ['#fStatus', uniq(S.tx.map(r => r.status)), 'status']
    ];

    let activeFilters = 0;
    pairs.forEach(([selId, opts, key]) => {
      const sel = $(selId) as HTMLSelectElement | null;
      if (!sel) return;
      const cur = S.filters[key];
      sel.innerHTML = `<option value="ALL">All</option>` + opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
      sel.value = opts.includes(cur) ? cur : 'ALL';
      if (sel.value !== 'ALL') activeFilters++;
      S.filters[key] = sel.value;
    });

    const fRows = filtered();
    const countLabel = $('#fCountLabel');
    if (countLabel) {
      countLabel.textContent =
        activeFilters > 0
          ? `${fRows.length} of ${S.tx.length} records (${activeFilters} filter${activeFilters > 1 ? 's' : ''} active)`
          : `${fRows.length} ledger records`;
    }
    const resetBtn = $('#fReset') as HTMLButtonElement | null;
    if (resetBtn) resetBtn.disabled = activeFilters === 0;

    // Update datalists for quick entry & section 02 form
    const fillList = (id: string, vals: string[]) => {
      const dl = $(id);
      if (dl) dl.innerHTML = vals.map(v => `<option value="${esc(v)}">`).join('');
    };
    fillList('#dlMembers', uniq([...S.tx.map(r => r.member), 'SYAM', 'MADHURI', 'CHINMAYI', 'OTHER INCOME']));
    fillList('#dlCategories', uniq([...S.tx.map(r => r.category), 'EXPENSE', 'OCCASIONAL EXPENSE', 'INCOME', 'SAVING', 'HOUSING LOAN', 'GOLD LOAN', 'HDFC PERSONAL LOAN', 'CRED LOAN']));
    fillList('#dlDescs', uniq(S.tx.map(r => r.desc)));
    fillList('#dlPms', uniq([...S.tx.map(r => r.pm), 'UPI', 'BANK', 'CASH', 'CARD', 'OTHER']));

    // Update member selectors in Sections 03 and 04
    const members = uniq(S.tx.map(r => r.member));
    ['#bRotMemberSel', '#svMemberSel'].forEach((id, idx) => {
      const sel = $(id) as HTMLSelectElement | null;
      if (!sel) return;
      const cur = idx === 0 ? S.rotMember : S.svMember;
      sel.innerHTML = `<option value="ALL">All members</option>` + members.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
      sel.value = members.includes(cur) ? cur : 'ALL';
      if (idx === 0) S.rotMember = sel.value;
      else S.svMember = sel.value;
    });
  }

  /* ============================================================
     SECTION 01: OVERVIEW
     ============================================================ */
  function renderOverview(rows: Transaction[]) {
    const t = totals(rows);
    const setKpi = (id: string, val: number, suffix = '') => {
      const node = $(id);
      if (!node) return;
      if (!S.hasAnimatedKpis && suffix === '' && val !== 0) {
        countUpCurrency(node, val, '₹');
      } else {
        node.textContent = suffix ? `${fmtIn(val, 1)}${suffix}` : signed(val);
      }
    };

    setKpi('#kpiIncome', t.income);
    setKpi('#kpiOutflow', t.outflow);
    setKpi('#kpiBalance', t.balance);
    setKpi('#kpiSavings', t.saving);
    setKpi('#kpiLoans', t.loan);
    const util = t.budget > 0 ? (t.spent / t.budget) * 100 : 0;
    const utilNode = $('#kpiUtil');
    if (utilNode) utilNode.textContent = `${util.toFixed(1)}%`;

    const paidSub = $('#kpiPaidSub');
    const dueSub = $('#kpiDueSub');
    if (paidSub) paidSub.textContent = `Paid: ${money(t.paid)}`;
    if (dueSub) dueSub.textContent = `To be paid: ${money(t.due)}`;

    renderMoneyFlowBar('ovFlowBar', 'ovFlowKey', 'ovFlowCap', t);
    renderUnitMatrix('ovUnitChart', 'ovUnitCap', rows, S.unitMode, () => openTxDialog(null));
    renderCategorySparklines('ovSparkHost', 'ovSparkWindow', S.tx, S.filters, S.ovSparkMode, () => openTxDialog(null));

    // Upcoming bills
    const upHost = $('#ovUpcomingList');
    if (upHost) {
      const dueRows = rows.filter(isDue);
      upHost.innerHTML = '';
      if (!dueRows.length) {
        upHost.appendChild(el('p', { class: 'mono-meta', text: 'All scheduled bills for this selection are settled.' }));
      } else {
        dueRows.slice(0, 6).forEach(r => {
          const item = el('div', { class: 'feed-row' }, [
            el('div', { class: 'feed-main' }, [
              el('div', { class: 'feed-title', text: r.desc }),
              el('div', { class: 'mono-meta', text: `${r.member} · ${r.category} · ${fmtDate(r.due || r.date) || r.date}` })
            ]),
            el('div', { class: 'feed-right' }, [
              el('span', { class: 'num feed-amt is-brick', text: money(r.budget) }),
              Perm.can('edit')
                ? (() => {
                    const b = el('button', { type: 'button', class: 'btn sm ghost', text: 'Mark paid' });
                    b.addEventListener('click', () => markPaid(r.id));
                    return b;
                  })()
                : null
            ])
          ]);
          upHost.appendChild(item);
        });
      }
    }

    // Recent transactions
    const recHost = $('#ovRecentList');
    if (recHost) {
      recHost.innerHTML = '';
      const rec = [...rows].sort((a, b) => b.id - a.id).slice(0, 6);
      if (!rec.length) {
        recHost.appendChild(el('p', { class: 'mono-meta', text: 'No recent transactions match current filters.' }));
      } else {
        rec.forEach(r => {
          const isInc = r.type.toUpperCase() === 'INCOME';
          const amt = num(r.spent) || num(r.budget);
          const item = el('div', { class: 'feed-row' }, [
            el('div', { class: 'feed-main' }, [
              el('div', { class: 'feed-title', text: r.desc }),
              el('div', { class: 'mono-meta', text: `#${r.id} · ${r.member} · ${r.type} · ${r.pm} · ${r.status}` })
            ]),
            el('div', { class: 'feed-right' }, [
              el('span', { class: `num feed-amt ${isInc ? 'is-green' : ''}`, text: `${isInc ? '+' : ''}${money(amt)}` }),
              Perm.can('edit')
                ? (() => {
                    const b = el('button', { type: 'button', class: 'btn sm ghost', text: 'Edit' });
                    b.addEventListener('click', () => startEdit(r.id, false));
                    return b;
                  })()
                : null
            ])
          ]);
          recHost.appendChild(item);
        });
      }
    }

    S.hasAnimatedKpis = true;
  }

  /* ============================================================
     PERSONAL FINANCE ANALYSIS DASHBOARD (Inside Spread 01)
     ============================================================ */
  function renderOverviewAnalysis(summary: FinancialSummary) {
    const alertHost = $('#ovAlertBanner');
    if (alertHost) {
      alertHost.innerHTML = '';
      const chips: HTMLElement[] = [];
      if (summary.overdueObligationsCount > 0) {
        chips.push(
          el('span', {
            class: 'alert-chip is-overdue',
            text: `Overdue: ${summary.overdueObligationsCount} (${money(summary.overdueObligationsAmount)})`
          })
        );
      }
      if (summary.dueTodayCount > 0) {
        chips.push(
          el('span', {
            class: 'alert-chip is-today',
            text: `Due Today: ${summary.dueTodayCount}`
          })
        );
      }
      if (summary.upcomingObligationsCount > 0) {
        chips.push(
          el('span', {
            class: 'alert-chip is-upcoming',
            text: `Upcoming: ${summary.upcomingObligationsCount} (${money(summary.upcomingObligationsAmount)})`
          })
        );
      }
      const negMonths = summary.projections.filter(p => p.netCashFlow < 0);
      if (negMonths.length > 0) {
        chips.push(
          el('span', {
            class: 'alert-chip is-overdue',
            text: `Forecast Alert: ${negMonths.length} negative cash-flow month(s)`
          })
        );
      }
      if (!chips.length) {
        alertHost.hidden = true;
      } else {
        alertHost.hidden = false;
        alertHost.appendChild(el('strong', { text: 'Smart Financial Alerts:' }));
        chips.forEach(c => alertHost.appendChild(c));
      }
    }

    const taxBadge = $('#ovTaxBadge');
    if (taxBadge) {
      if (summary.tax.configured) {
        taxBadge.textContent = `Tax: ${summary.tax.regime.toUpperCase()} Regime · ${money(summary.tax.remainingTaxPayable)} due`;
        taxBadge.classList.add('is-editing');
      } else {
        taxBadge.textContent = 'Tax: Not configured (₹0 assumed)';
        taxBadge.classList.remove('is-editing');
      }
    }

    const pfGrid = $('#pfKpiGrid');
    if (pfGrid) {
      pfGrid.innerHTML = '';
      const tiles: Array<{ label: string; value: string; sub: string; tone?: string }> = [
        {
          label: 'Monthly Income',
          value: money(summary.monthlyIncome),
          sub: summary.profileIncomeConfigured
            ? `${S.profile.incomes.length} Profile source(s)`
            : 'From active ledger month(s)',
          tone: 'is-green'
        },
        {
          label: 'Annual Income',
          value: money(summary.annualIncome),
          sub: summary.estimatedMonthlyIncome > 0
            ? `Incl. ${money(summary.estimatedMonthlyIncome)}/mo est.`
            : 'Normalized annualized inflow',
          tone: 'is-green'
        },
        {
          label: 'Fixed Expenses / Mo',
          value: money(summary.fixedMonthlyExpenses),
          sub: `${money(summary.essentialMonthlyExpenses)}/mo essential`
        },
        {
          label: 'Variable Expenses / Mo',
          value: money(summary.variableMonthlyExpenses),
          sub: `${money(summary.totalMonthlyExpenses)}/mo total expenses`
        },
        {
          label: 'Monthly EMIs & Debt',
          value: money(summary.monthlyEmiPayments),
          sub: `Annualized: ${money(summary.annualEmiPayments)}`
        },
        {
          label: 'Estimated Tax Reserve',
          value: summary.tax.configured ? `${money(summary.tax.monthlyTaxReserve)}/mo` : 'Not set',
          sub: summary.tax.configured
            ? `Remaining: ${money(summary.tax.remainingTaxPayable)}`
            : 'Configure in 03 Obligations'
        },
        {
          label: 'Upcoming Obligations',
          value: money(summary.upcomingObligationsAmount + summary.overdueObligationsAmount),
          sub: `${summary.overdueObligationsCount} overdue · ${summary.upcomingObligationsCount} upcoming`,
          tone: summary.overdueObligationsCount > 0 ? 'is-brick' : ''
        },
        {
          label: 'Monthly Savings',
          value: money(summary.monthlySavingsActual),
          sub: `${summary.savingsRatePct.toFixed(1)}% savings rate`,
          tone: 'is-green'
        },
        {
          label: 'Disposable Income / Mo',
          value: signed(summary.disposableIncomeMonthly),
          sub: 'Income − fixed − EMIs − tax',
          tone: summary.disposableIncomeMonthly >= 0 ? 'is-green' : 'is-brick'
        },
        {
          label: 'Monthly Cash Flow',
          value: signed(summary.monthlyCashFlow),
          sub: 'Net surplus after all outflows',
          tone: summary.monthlyCashFlow >= 0 ? 'is-green' : 'is-brick'
        },
        {
          label: 'Debt-to-Income Ratio',
          value: `${summary.dtiPct.toFixed(1)}%`,
          sub: summary.dtiPct > 35 ? 'Above 35% safe threshold' : 'Within ≤35% benchmark',
          tone: summary.dtiPct > 35 ? 'is-brick' : 'is-green'
        },
        {
          label: 'Net Worth',
          value: summary.netWorth !== null ? signed(summary.netWorth) : 'Not entered',
          sub: summary.netWorth !== null
            ? `Assets ${money(summary.totalAssets)} − Debt ${money(summary.totalLiabilities)}`
            : 'Add Assets/Debt in 02 Profile',
          tone: summary.netWorth !== null ? (summary.netWorth >= 0 ? 'is-green' : 'is-brick') : ''
        }
      ];

      tiles.forEach(tile => {
        pfGrid.appendChild(
          el('div', { class: 'pf-kpi-card' }, [
            el('div', { class: 'pf-kpi-lbl', text: tile.label }),
            el('div', { class: `pf-kpi-val num ${tile.tone || ''}`, text: tile.value }),
            el('div', { class: 'pf-kpi-sub', text: tile.sub })
          ])
        );
      });
    }

    renderCashFlowProjectionChart('ovForecastChart', 'ovForecastCap', summary.projections);
  }

  /* ============================================================
     SECTION 02 (PROFILE): MY FINANCIAL PROFILE
     ============================================================ */
  function renderFinancialProfile(summary: FinancialSummary) {
    const canEdit = Perm.can('edit');
    const strip = $('#profSummaryStrip');
    if (strip) {
      strip.innerHTML = '';
      const boxes = [
        { lbl: 'Normalized Monthly Income', val: money(summary.monthlyIncome), sub: `${S.profile.incomes.length} source(s)` },
        { lbl: 'Normalized Monthly Expenses', val: money(summary.totalMonthlyExpenses), sub: `${S.profile.expenses.length} rule(s)` },
        { lbl: 'Total Assets', val: money(summary.totalAssets), sub: `${S.profile.assets.length} asset(s)` },
        {
          lbl: 'Household Net Worth',
          val: summary.netWorth !== null ? signed(summary.netWorth) : 'Add Assets/Debt',
          sub: `Liabilities: ${money(summary.totalLiabilities)}`
        }
      ];
      boxes.forEach(b => {
        strip.appendChild(
          el('div', { class: 'kpi-box' }, [
            el('div', { class: 'kpi-lbl', text: b.lbl }),
            el('div', { class: 'kpi-val num', text: b.val }),
            el('div', { class: 'kpi-sub', text: b.sub })
          ])
        );
      });
    }

    // Sync income form controls
    const incMode = $('#profIncMode');
    const incBtn = $('#piSubmit') as HTMLButtonElement | null;
    const incCancel = $('#piCancel') as HTMLButtonElement | null;
    if (S.editIncomeId) {
      if (incMode) {
        incMode.textContent = 'Editing source';
        incMode.classList.add('is-editing');
      }
      if (incBtn) incBtn.textContent = 'Save income source';
      if (incCancel) incCancel.hidden = false;
    } else {
      if (incMode) {
        incMode.textContent = 'New source';
        incMode.classList.remove('is-editing');
      }
      if (incBtn) incBtn.textContent = 'Add income source';
      if (incCancel) incCancel.hidden = true;
    }

    // Sync expense form controls
    const expMode = $('#profExpMode');
    const expBtn = $('#peSubmit') as HTMLButtonElement | null;
    const expCancel = $('#peCancel') as HTMLButtonElement | null;
    if (S.editExpenseId) {
      if (expMode) {
        expMode.textContent = 'Editing rule';
        expMode.classList.add('is-editing');
      }
      if (expBtn) expBtn.textContent = 'Save expense rule';
      if (expCancel) expCancel.hidden = false;
    } else {
      if (expMode) {
        expMode.textContent = 'New expense';
        expMode.classList.remove('is-editing');
      }
      if (expBtn) expBtn.textContent = 'Add expense rule';
      if (expCancel) expCancel.hidden = true;
    }

    // Disable mutation controls for viewers
    ['#profIncForm', '#profExpForm', '#profAssetForm', '#profLiabForm'].forEach(sel => {
      const form = $(sel);
      if (form) {
        Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button')).forEach(
          ctrl => {
            ctrl.disabled = !canEdit;
          }
        );
      }
    });
    const impBtn = $('#profImportBtn') as HTMLButtonElement | null;
    if (impBtn) impBtn.disabled = !canEdit;

    // Income Sources list
    const incHost = $('#profIncList');
    if (incHost) {
      incHost.innerHTML = '';
      if (!S.profile.incomes.length) {
        incHost.appendChild(
          el('p', {
            class: 'mono-meta',
            text: 'No income sources added yet. Add salary, freelance, business, rental, interest, or click "Import Streams from Ledger".'
          })
        );
      } else {
        S.profile.incomes.forEach(inc => {
          const mo = incomeToMonthly(inc.amount, inc.frequency);
          const originBadge = el('span', {
            class: `origin-tag ${inc.isEstimate ? 'is-est' : 'is-conf'}`,
            text: inc.isEstimate ? 'Estimated' : 'Confirmed'
          });
          const actions = el('div', { class: 'feed-right' }, [
            el('span', { class: 'num feed-amt is-green', text: money(inc.amount) }),
            canEdit
              ? (() => {
                  const ed = el('button', { type: 'button', class: 'btn sm ghost', text: 'Edit' });
                  ed.addEventListener('click', () => {
                    S.editIncomeId = inc.id;
                    const set = (id: string, v: string | number | boolean | undefined) => {
                      const n = $(id) as HTMLInputElement | HTMLSelectElement | null;
                      if (!n) return;
                      if (n instanceof HTMLInputElement && n.type === 'checkbox') n.checked = !!v;
                      else n.value = String(v ?? '');
                    };
                    set('#piName', inc.name);
                    set('#piKind', inc.kind);
                    set('#piAmt', inc.amount);
                    set('#piFreq', inc.frequency);
                    set('#piPayDay', inc.payDay ?? 1);
                    set('#piMember', inc.member || '');
                    set('#piDate', inc.date || '');
                    set('#piEst', !!inc.isEstimate);
                    renderFinancialProfile(summary);
                  });
                  return ed;
                })()
              : null,
            canEdit
              ? (() => {
                  const rm = el('button', { type: 'button', class: 'btn sm ghost is-brick', text: 'Del' });
                  rm.addEventListener('click', () => {
                    if (!Perm.demand('edit')) return;
                    S.profile.incomes = S.profile.incomes.filter(x => x.id !== inc.id);
                    if (S.editIncomeId === inc.id) S.editIncomeId = null;
                    persistProfile();
                    toast(`Removed income source "${inc.name}"`, 'ok');
                  });
                  return rm;
                })()
              : null
          ]);

          incHost.appendChild(
            el('div', { class: 'feed-row' }, [
              el('div', { class: 'feed-main' }, [
                el('div', { style: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;' }, [
                  el('span', { class: 'feed-title', text: inc.name }),
                  originBadge
                ]),
                el('div', {
                  class: 'mono-meta',
                  text: `${inc.kind} · ${inc.frequency}${inc.frequency !== 'one-time' ? ` (${money(mo)}/mo)` : ''}${inc.member ? ` · ${inc.member}` : ''}${inc.payDay ? ` · Day ${inc.payDay}` : ''}`
                })
              ]),
              actions
            ])
          );
        });
      }
    }

    // Expenses list
    const expHost = $('#profExpList');
    if (expHost) {
      expHost.innerHTML = '';
      if (!S.profile.expenses.length) {
        expHost.appendChild(
          el('p', {
            class: 'mono-meta',
            text: 'No recurring expense rules added yet. Add rent, groceries, utilities, fees, or subscriptions across daily–yearly frequencies.'
          })
        );
      } else {
        S.profile.expenses.forEach(exp => {
          const mo = expenseToMonthly(exp.amount, exp.frequency);
          const tag = el('span', {
            class: `origin-tag ${exp.kind === 'fixed' ? 'is-user' : 'is-est'}`,
            text: `${exp.kind === 'fixed' ? 'Fixed' : 'Variable'}${exp.essential ? ' · Essential' : ''}`
          });
          const actions = el('div', { class: 'feed-right' }, [
            el('span', { class: 'num feed-amt', text: money(exp.amount) }),
            canEdit
              ? (() => {
                  const ed = el('button', { type: 'button', class: 'btn sm ghost', text: 'Edit' });
                  ed.addEventListener('click', () => {
                    S.editExpenseId = exp.id;
                    const set = (id: string, v: string | number | boolean | undefined) => {
                      const n = $(id) as HTMLInputElement | HTMLSelectElement | null;
                      if (!n) return;
                      if (n instanceof HTMLInputElement && n.type === 'checkbox') n.checked = !!v;
                      else n.value = String(v ?? '');
                    };
                    set('#peName', exp.name);
                    set('#peCat', exp.category);
                    set('#peAmt', exp.amount);
                    set('#peFreq', exp.frequency);
                    set('#peKind', exp.kind);
                    set('#peDay', exp.dueDay ?? 5);
                    set('#peEss', exp.essential);
                    renderFinancialProfile(summary);
                  });
                  return ed;
                })()
              : null,
            canEdit
              ? (() => {
                  const rm = el('button', { type: 'button', class: 'btn sm ghost is-brick', text: 'Del' });
                  rm.addEventListener('click', () => {
                    if (!Perm.demand('edit')) return;
                    S.profile.expenses = S.profile.expenses.filter(x => x.id !== exp.id);
                    if (S.editExpenseId === exp.id) S.editExpenseId = null;
                    persistProfile();
                    toast(`Removed expense rule "${exp.name}"`, 'ok');
                  });
                  return rm;
                })()
              : null
          ]);

          expHost.appendChild(
            el('div', { class: 'feed-row' }, [
              el('div', { class: 'feed-main' }, [
                el('div', { style: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;' }, [
                  el('span', { class: 'feed-title', text: exp.name }),
                  tag
                ]),
                el('div', {
                  class: 'mono-meta',
                  text: `${exp.category} · ${exp.frequency} (${money(mo)}/mo normalized)${exp.dueDay ? ` · Day ${exp.dueDay}` : ''}`
                })
              ]),
              actions
            ])
          );
        });
      }
    }

    // Assets & Liabilities
    const assetTotalEl = $('#profAssetTotal');
    if (assetTotalEl) assetTotalEl.textContent = money(summary.totalAssets);
    const assetHost = $('#profAssetList');
    if (assetHost) {
      assetHost.innerHTML = '';
      if (!S.profile.assets.length) {
        assetHost.appendChild(el('p', { class: 'mono-meta', text: 'No assets entered yet.' }));
      } else {
        S.profile.assets.forEach(a => {
          const rm = canEdit
            ? (() => {
                const b = el('button', { type: 'button', class: 'btn sm ghost is-brick', text: 'Del' });
                b.addEventListener('click', () => {
                  if (!Perm.demand('edit')) return;
                  S.profile.assets = S.profile.assets.filter(x => x.id !== a.id);
                  persistProfile();
                  toast(`Removed asset "${a.name}"`, 'ok');
                });
                return b;
              })()
            : null;
          assetHost.appendChild(
            el('div', { class: 'feed-row' }, [
              el('div', { class: 'feed-main' }, [
                el('div', { class: 'feed-title', text: a.name }),
                el('div', { class: 'mono-meta', text: a.kind })
              ]),
              el('div', { class: 'feed-right' }, [
                el('span', { class: 'num feed-amt is-green', text: money(a.value) }),
                rm
              ])
            ])
          );
        });
      }
    }

    const liabTotalEl = $('#profLiabTotal');
    if (liabTotalEl) liabTotalEl.textContent = money(summary.totalLiabilities);
    const liabHost = $('#profLiabList');
    if (liabHost) {
      liabHost.innerHTML = '';
      if (!S.profile.liabilities.length) {
        liabHost.appendChild(el('p', { class: 'mono-meta', text: 'No outstanding liabilities entered yet.' }));
      } else {
        S.profile.liabilities.forEach(l => {
          const rm = canEdit
            ? (() => {
                const b = el('button', { type: 'button', class: 'btn sm ghost is-brick', text: 'Del' });
                b.addEventListener('click', () => {
                  if (!Perm.demand('edit')) return;
                  S.profile.liabilities = S.profile.liabilities.filter(x => x.id !== l.id);
                  persistProfile();
                  toast(`Removed liability "${l.name}"`, 'ok');
                });
                return b;
              })()
            : null;
          liabHost.appendChild(
            el('div', { class: 'feed-row' }, [
              el('div', { class: 'feed-main' }, [
                el('div', { class: 'feed-title', text: l.name }),
                el('div', {
                  class: 'mono-meta',
                  text: `${l.kind}${l.interestRate ? ` · ${l.interestRate.toFixed(1)}% p.a.` : ''}`
                })
              ]),
              el('div', { class: 'feed-right' }, [
                el('span', { class: 'num feed-amt is-brick', text: money(l.balance) }),
                rm
              ])
            ])
          );
        });
      }
    }
  }

  /* ============================================================
     SECTION 03 (OBLIGATIONS): PAYMENTS, OBLIGATIONS & TAX
     ============================================================ */
  function renderObligationsSection(summary: FinancialSummary) {
    const canEdit = Perm.can('edit');
    const todayIso = todayIsoLocal();

    const alertHost = $('#oblAlertsHost');
    if (alertHost) {
      alertHost.innerHTML = '';
      if (S.profile.obligations.length || summary.overdueObligationsCount || summary.upcomingObligationsCount) {
        alertHost.hidden = false;
        alertHost.appendChild(
          el('span', {
            class: `alert-chip ${summary.overdueObligationsCount ? 'is-overdue' : 'is-clear'}`,
            text: `Overdue: ${summary.overdueObligationsCount} (${money(summary.overdueObligationsAmount)})`
          })
        );
        alertHost.appendChild(
          el('span', {
            class: `alert-chip ${summary.dueTodayCount ? 'is-today' : 'is-clear'}`,
            text: `Due Today: ${summary.dueTodayCount}`
          })
        );
        alertHost.appendChild(
          el('span', {
            class: `alert-chip ${summary.upcomingObligationsCount ? 'is-upcoming' : 'is-clear'}`,
            text: `Upcoming: ${summary.upcomingObligationsCount} (${money(summary.upcomingObligationsAmount)})`
          })
        );
      } else {
        alertHost.hidden = true;
      }
    }

    const oblMode = $('#oblModePill');
    const obSubmit = $('#obSubmit') as HTMLButtonElement | null;
    const obCancel = $('#obCancel') as HTMLButtonElement | null;
    if (S.editObligId) {
      if (oblMode) {
        oblMode.textContent = 'Editing obligation';
        oblMode.classList.add('is-editing');
      }
      if (obSubmit) obSubmit.textContent = 'Save obligation';
      if (obCancel) obCancel.hidden = false;
    } else {
      if (oblMode) {
        oblMode.textContent = 'New obligation';
        oblMode.classList.remove('is-editing');
      }
      if (obSubmit) obSubmit.textContent = 'Add obligation';
      if (obCancel) obCancel.hidden = true;
    }

    ['#oblForm', '#taxForm'].forEach(sel => {
      const form = $(sel);
      if (form) {
        Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button')).forEach(
          ctrl => {
            ctrl.disabled = !canEdit;
          }
        );
      }
    });

    const obDueIn = $('#obDueDate') as HTMLInputElement | null;
    if (obDueIn && !obDueIn.value && !S.editObligId) {
      obDueIn.value = todayIso;
    }

    const tbody = $('#oblTableBody');
    if (tbody) {
      tbody.innerHTML = '';
      if (!S.profile.obligations.length) {
        tbody.appendChild(
          el('tr', {}, el('td', { colspan: '5', class: 'mono-meta', text: 'No EMIs, tax obligations, credit cards, or insurance premiums added yet.' }))
        );
      } else {
        const sorted = [...S.profile.obligations].sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
        sorted.forEach(ob => {
          const al = getAlertState(ob.dueDate, ob.status, todayIso);
          const statusCls = al === 'overdue' ? 'is-overdue' : al === 'due-today' ? 'is-today' : al === 'upcoming' ? 'is-upcoming' : 'is-clear';
          const originCls = ob.entrySource === 'estimated' ? 'is-est' : ob.entrySource === 'confirmed' ? 'is-conf' : 'is-user';
          const originLabel = ob.entrySource === 'estimated' ? 'Estimated' : ob.entrySource === 'confirmed' ? 'Confirmed' : 'User-Entered';

          const actCell = el('td', { class: 'is-num tbl-actions' });
          if (canEdit) {
            if (ob.status !== 'Paid') {
              const payBtn = el('button', { type: 'button', class: 'btn sm ghost', text: 'Mark paid' });
              payBtn.addEventListener('click', () => markObligationPaid(ob.id));
              actCell.appendChild(payBtn);
            }
            const edBtn = el('button', { type: 'button', class: 'btn sm ghost', text: 'Edit' });
            edBtn.addEventListener('click', () => {
              S.editObligId = ob.id;
              const set = (id: string, v: string | number | undefined) => {
                const n = $(id) as HTMLInputElement | HTMLSelectElement | null;
                if (n) n.value = String(v ?? '');
              };
              set('#obName', ob.name);
              set('#obKind', ob.kind);
              set('#obTotal', ob.totalAmount);
              set('#obDueAmt', ob.amountDue);
              set('#obDueDate', ob.dueDate);
              set('#obFreq', ob.frequency);
              set('#obRemBal', ob.remainingBalance ?? '');
              set('#obRate', ob.interestRate ?? '');
              set('#obStatus', ob.status);
              set('#obOrigin', ob.entrySource);
              renderObligationsSection(summary);
            });
            const rmBtn = el('button', { type: 'button', class: 'btn sm ghost is-brick', text: 'Del' });
            rmBtn.addEventListener('click', () => {
              if (!Perm.demand('edit')) return;
              S.profile.obligations = S.profile.obligations.filter(x => x.id !== ob.id);
              if (S.editObligId === ob.id) S.editObligId = null;
              persistProfile();
              toast(`Removed obligation "${ob.name}"`, 'ok');
            });
            actCell.appendChild(edBtn);
            actCell.appendChild(rmBtn);
          } else {
            actCell.appendChild(el('span', { class: 'mono-meta', text: 'Read-only' }));
          }

          tbody.appendChild(
            el('tr', {}, [
              el('td', {}, [
                el('div', { class: 'feed-title', text: ob.name }),
                el('div', {
                  class: 'mono-meta',
                  text: `${ob.kind.replace(/-/g, ' ')} · ${ob.frequency}${ob.remainingBalance ? ` · Bal ${money(ob.remainingBalance)}` : ''}${ob.interestRate ? ` · ${ob.interestRate}% APR` : ''}`
                })
              ]),
              el('td', { class: 'num', text: fmtDate(ob.dueDate) || ob.dueDate || '—' }),
              el('td', { class: 'is-num num' }, [
                el('div', { text: money(ob.totalAmount) }),
                el('div', { class: `mono-meta ${ob.amountDue > 0 ? 'is-brick' : 'is-green'}`, text: `Due: ${money(ob.amountDue)}` })
              ]),
              el('td', {}, [
                el('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;' }, [
                  el('span', { class: `alert-chip ${statusCls}`, text: al === 'overdue' && ob.status !== 'Overdue' ? `${ob.status} (Overdue)` : ob.status }),
                  el('span', { class: `origin-tag ${originCls}`, text: originLabel })
                ])
              ]),
              actCell
            ])
          );
        });
      }
    }

    // Sync Tax Estimator Inputs with State
    const tx = S.profile.tax;
    const setTaxVal = (id: string, val: string | number | boolean | null) => {
      const n = $(id) as HTMLInputElement | HTMLSelectElement | null;
      if (!n) return;
      if (n instanceof HTMLInputElement && n.type === 'checkbox') n.checked = !!val;
      else n.value = val === null ? '' : String(val);
    };
    setTaxVal('#txRegime', tx.regime);
    setTaxVal('#txAY', tx.assessmentYear);
    setTaxVal('#txGross', tx.annualGrossIncome);
    setTaxVal('#tx80C', tx.deductions80C);
    setTaxVal('#tx80D', tx.deductions80D);
    setTaxVal('#txHra', tx.hraExemption);
    setTaxVal('#txOtherEx', tx.otherExemptions);
    setTaxVal('#txTds', tx.tdsAlreadyDeducted);
    setTaxVal('#txAdv', tx.advanceTaxPaid);
    setTaxVal('#txGstApp', tx.gstApplicable);
    setTaxVal('#txGstMo', tx.gstMonthlyEstimated);

    const taxPill = $('#taxStatusPill');
    if (taxPill) {
      if (summary.tax.configured) {
        taxPill.textContent = `${summary.tax.regime.toUpperCase()} Regime Active`;
        taxPill.classList.add('is-editing');
      } else {
        taxPill.textContent = 'Not Configured (₹0 Assumed)';
        taxPill.classList.remove('is-editing');
      }
    }

    const taxHost = $('#taxBreakdownHost');
    if (taxHost) {
      taxHost.innerHTML = '';
      if (!summary.tax.configured) {
        taxHost.appendChild(
          el('div', { class: 'chart-empty' }, [
            el('p', { class: 'chart-empty-title', text: 'Tax Liability Not Assumed' }),
            el('p', {
              class: 'chart-empty-sub',
              text: 'Select Old or New tax regime, enter eligible deductions (80C, 80D, HRA) and TDS/Advance Tax paid above, then click "Apply & Estimate Tax".'
            })
          ])
        );
      } else {
        const tb = summary.tax;
        taxHost.appendChild(
          el('div', { class: 'calc-result-card' }, [
            el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;' }, [
              el('span', { class: 'micro-upper', text: `Estimated Remaining Liability (${tb.regime.toUpperCase()})` }),
              el('span', { class: 'origin-tag is-est', text: 'Estimated Tax' })
            ]),
            el('div', { class: 'calc-big num', text: money(tb.remainingTaxPayable) }),
            el('div', { class: 'calc-res-rows' }, [
              el('div', {}, [
                el('span', { class: 'micro-upper', text: 'Taxable Income' }),
                el('strong', { class: 'num', text: money(tb.taxableIncome) })
              ]),
              el('div', {}, [
                el('span', { class: 'micro-upper', text: 'Total Tax + Cess' }),
                el('strong', { class: 'num', text: money(tb.totalTaxLiability) })
              ]),
              el('div', {}, [
                el('span', { class: 'micro-upper', text: 'Monthly Reserve' }),
                el('strong', { class: 'num', text: `${money(tb.monthlyTaxReserve)}/mo` })
              ])
            ]),
            el('p', { class: 'mono-meta', style: 'margin:0;', text: tb.methodologyNote })
          ])
        );
      }
    }
  }

  /* ============================================================
     SECTION 04 (ADVISOR): AI FINANCIAL ADVISOR
     ============================================================ */
  function renderAdvisorSection(summary: FinancialSummary, insights: AdvisorRecommendation[]) {
    const healthHost = $('#advHealthHost');
    if (healthHost) {
      healthHost.innerHTML = '';
      const essentialBase =
        summary.essentialMonthlyExpenses > 0
          ? summary.essentialMonthlyExpenses
          : summary.fixedMonthlyExpenses + summary.monthlyEmiPayments * 0.5;
      const targetEmergency = Math.round(essentialBase * 6);
      const emPct = targetEmergency > 0 ? Math.min(100, (summary.liquidAssets / targetEmergency) * 100) : 0;

      healthHost.appendChild(
        el('div', { class: 'card-head' }, [
          el('h3', { class: 'card-title', text: 'Household Financial Health' }),
          el('span', { class: 'micro-upper', text: 'Diagnostics' })
        ])
      );
      healthHost.appendChild(
        el('div', { class: 'feed-list' }, [
          el('div', { class: 'feed-row' }, [
            el('span', { class: 'mono-meta', text: 'Disposable Income / Mo' }),
            el('strong', { class: `num ${summary.disposableIncomeMonthly >= 0 ? 'is-green' : 'is-brick'}`, text: signed(summary.disposableIncomeMonthly) })
          ]),
          el('div', { class: 'feed-row' }, [
            el('span', { class: 'mono-meta', text: 'Savings Rate (Target ≥20%)' }),
            el('strong', { class: `num ${summary.savingsRatePct >= 20 ? 'is-green' : ''}`, text: `${summary.savingsRatePct.toFixed(1)}%` })
          ]),
          el('div', { class: 'feed-row' }, [
            el('span', { class: 'mono-meta', text: 'Debt-to-Income (Limit ≤35%)' }),
            el('strong', { class: `num ${summary.dtiPct > 35 ? 'is-brick' : 'is-green'}`, text: `${summary.dtiPct.toFixed(1)}%` })
          ])
        ])
      );
      healthHost.appendChild(
        el('div', { class: 'emergency-meter' }, [
          el('div', { class: 'budget-inline-head' }, [
            el('span', { class: 'mono-meta', text: `6-Mo Emergency Target (${money(targetEmergency)})` }),
            el('span', { class: 'mono-meta num', text: `${emPct.toFixed(0)}% funded` })
          ]),
          el('div', { class: `budget-bar-track ${emPct >= 100 ? 'tier-green' : emPct >= 40 ? 'tier-amber' : 'tier-red'}` },
            el('div', { class: 'budget-bar-fill', style: `width:${emPct.toFixed(1)}%` })
          ),
          el('span', { class: 'mono-meta', text: `Liquid assets entered: ${money(summary.liquidAssets)}` })
        ])
      );
    }

    const loanHost = $('#advLoanHost');
    if (loanHost) {
      loanHost.innerHTML = '';
      const strat = compareLoanStrategies(S.profile, S.tx);
      loanHost.appendChild(
        el('div', { class: 'card-head' }, [
          el('h3', { class: 'card-title', text: 'Debt Strategy Simulator' }),
          el('span', { class: 'micro-upper', text: 'Avalanche vs Snowball' })
        ])
      );
      if (!strat) {
        loanHost.appendChild(
          el('p', {
            class: 'mono-meta',
            text: 'No active loans detected. Add loan EMIs or liabilities to compare payoff timelines.'
          })
        );
      } else if (strat.totalBalance <= 0) {
        loanHost.appendChild(
          el('p', {
            class: 'mono-meta',
            text: `${strat.loanCount} loan account(s) tracked in the ledger. Add remaining principal balances & interest rates in 03 Payments & Obligations to run the Avalanche vs Snowball simulator.`
          })
        );
      } else {
        loanHost.appendChild(
          el('div', { class: 'strategy-compare' }, [
            el('div', { class: 'feed-row' }, [
              el('div', {}, [
                el('div', { class: 'feed-title', text: 'Debt Avalanche (Highest APR First)' }),
                el('div', { class: 'mono-meta', text: strat.avalancheOrder.slice(0, 2).join(' → ') })
              ]),
              el('strong', { class: 'num is-green', text: `${strat.avalancheMonths} mo` })
            ]),
            el('div', { class: 'feed-row' }, [
              el('div', {}, [
                el('div', { class: 'feed-title', text: 'Debt Snowball (Smallest Balance First)' }),
                el('div', { class: 'mono-meta', text: strat.snowballOrder.slice(0, 2).join(' → ') })
              ]),
              el('strong', { class: 'num', text: `${strat.snowballMonths} mo` })
            ]),
            el('p', {
              class: 'mono-meta',
              style: 'margin:0;',
              text: `Testing +${money(strat.extraMonthlyTested)}/mo extra repayment across ${money(strat.totalBalance)} total debt: Avalanche saves ${money(strat.interestSavedWithAvalanche)} in total interest.`
            })
          ])
        );
      }
    }

    const allocHost = $('#advAllocHost');
    if (allocHost) {
      allocHost.innerHTML = '';
      allocHost.appendChild(
        el('div', { class: 'card-head' }, [
          el('h3', { class: 'card-title', text: 'Income Allocation Snapshot' }),
          el('span', { class: 'micro-upper', text: 'Monthly Normalized' })
        ])
      );
      const base = Math.max(1, summary.monthlyIncome);
      const fixedPct = Math.round((summary.fixedMonthlyExpenses / base) * 100);
      const varPct = Math.round((summary.variableMonthlyExpenses / base) * 100);
      const emiPct = Math.round((summary.monthlyEmiPayments / base) * 100);
      const savPct = Math.round((summary.monthlySavingsActual / base) * 100);
      allocHost.appendChild(
        el('div', { class: 'feed-list' }, [
          el('div', { class: 'feed-row' }, [
            el('span', { class: 'mono-meta', text: 'Fixed Living Costs' }),
            el('strong', { class: 'num', text: `${fixedPct}% (${money(summary.fixedMonthlyExpenses)})` })
          ]),
          el('div', { class: 'feed-row' }, [
            el('span', { class: 'mono-meta', text: 'Variable Lifestyle' }),
            el('strong', { class: 'num', text: `${varPct}% (${money(summary.variableMonthlyExpenses)})` })
          ]),
          el('div', { class: 'feed-row' }, [
            el('span', { class: 'mono-meta', text: 'Loan EMIs & Debt' }),
            el('strong', { class: `num ${emiPct > 35 ? 'is-brick' : ''}`, text: `${emiPct}% (${money(summary.monthlyEmiPayments)})` })
          ]),
          el('div', { class: 'feed-row' }, [
            el('span', { class: 'mono-meta', text: 'Monthly Savings / SIPs' }),
            el('strong', { class: 'num is-green', text: `${savPct}% (${money(summary.monthlySavingsActual)})` })
          ])
        ])
      );
    }

    const recsHost = $('#advRecsHost');
    if (recsHost) {
      recsHost.innerHTML = '';
      const filteredRecs =
        S.advPriority === 'ALL' ? insights : insights.filter(i => i.priority === S.advPriority);
      if (!filteredRecs.length) {
        recsHost.appendChild(
          el('div', { class: 'card chart-empty' }, [
            el('p', { class: 'chart-empty-title', text: 'No recommendations in this priority filter' }),
            el('p', { class: 'chart-empty-sub', text: 'Switch to "All Advice" or add more financial profile entries.' })
          ])
        );
      } else {
        filteredRecs.forEach(rec => {
          const prioCls = rec.priority === 'High' ? 'is-high' : rec.priority === 'Medium' ? 'is-medium' : 'is-low';
          recsHost.appendChild(
            el('article', { class: `card adv-card ${prioCls}` }, [
              el('div', { class: 'adv-card-head' }, [
                el('div', {}, [
                  el('span', { class: 'micro-upper', text: rec.category }),
                  el('h3', { class: 'card-title', style: 'margin-top:2px;', text: rec.title })
                ]),
                el('span', { class: `prio-badge ${prioCls}`, text: `${rec.priority} Priority` })
              ]),
              el('div', { class: 'adv-card-grid' }, [
                el('div', { class: 'adv-block' }, [
                  el('strong', { text: '1. What was identified' }),
                  el('p', { text: rec.identified })
                ]),
                el('div', { class: 'adv-block' }, [
                  el('strong', { text: '2. Why it matters' }),
                  el('p', { text: rec.whyItMatters })
                ]),
                el('div', { class: 'adv-block' }, [
                  el('strong', { text: '3. Suggested practical action' }),
                  el('p', { text: rec.suggestedAction })
                ]),
                el('div', { class: 'adv-block' }, [
                  el('strong', { text: '4. Estimated financial impact' }),
                  el('p', { class: 'num is-green', style: 'font-weight:600;', text: rec.estimatedImpact })
                ])
              ]),
              el('div', { class: 'mono-meta', style: 'padding-top:8px;border-top:1px solid var(--rule);', text: `Basis: ${rec.basis}` })
            ])
          );
        });
      }
    }

    const methodHost = $('#advMethodHost');
    if (methodHost) {
      methodHost.innerHTML = '';
      const ul = el('ul', { style: 'margin:0;padding-left:18px;display:grid;gap:6px;font-size:13px;color:var(--ink-2);' });
      summary.methodologyNotes.forEach(n => ul.appendChild(el('li', { text: n })));
      methodHost.appendChild(ul);
    }
  }

  /* ============================================================
     CUSTOM DATE RANGE PERSONAL FINANCE REPORT (Inside Spread 10)
     ============================================================ */
  function ensureReportDatesInitialized() {
    if (S.repFromDate && S.repToDate) return;
    const dates = S.tx
      .map(r => (r.date || '').slice(0, 10))
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
    if (dates.length) {
      S.repFromDate = dates[0];
      S.repToDate = dates[dates.length - 1];
    } else {
      const today = todayIsoLocal();
      S.repFromDate = `${today.slice(0, 7)}-01`;
      S.repToDate = today;
    }
  }

  function applyReportPreset(preset: AppState['repPreset']) {
    S.repPreset = preset;
    const dates = S.tx
      .map(r => (r.date || '').slice(0, 10))
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
    const minD = dates[0] || `${todayIsoLocal().slice(0, 7)}-01`;
    const maxD = dates[dates.length - 1] || todayIsoLocal();
    const anchor = new Date(maxD + 'T00:00:00');

    if (preset === 'all') {
      S.repFromDate = minD;
      S.repToDate = maxD;
    } else if (preset === 'month') {
      S.repFromDate = `${maxD.slice(0, 7)}-01`;
      S.repToDate = maxD;
    } else if (preset === '3m') {
      const d = new Date(anchor.getFullYear(), anchor.getMonth() - 2, 1);
      S.repFromDate = d.toISOString().slice(0, 10);
      S.repToDate = maxD;
    } else if (preset === 'year') {
      S.repFromDate = `${anchor.getFullYear()}-01-01`;
      S.repToDate = `${anchor.getFullYear()}-12-31`;
    }
  }

  function getActiveReportData(summary: FinancialSummary, insights: AdvisorRecommendation[]) {
    ensureReportDatesInitialized();
    return buildComprehensiveReportData(
      SessionContext.house?.name || 'Household Ledger',
      S.profile,
      summary,
      insights,
      S.tx,
      S.repFromDate,
      S.repToDate
    );
  }

  function renderComprehensiveReport(summary: FinancialSummary, insights: AdvisorRecommendation[]) {
    ensureReportDatesInitialized();
    const fromIn = $('#repFromDate') as HTMLInputElement | null;
    const toIn = $('#repToDate') as HTMLInputElement | null;
    if (fromIn) fromIn.value = S.repFromDate;
    if (toIn) toIn.value = S.repToDate;

    const host = $('#pfReportHost');
    if (!host) return;
    const rep = getActiveReportData(summary, insights);
    host.innerHTML = '';

    const grid = el('div', { class: 'rep-sheet-grid' }, [
      el('div', { class: 'rep-sheet-box' }, [
        el('span', { class: 'micro-upper', text: '1. Income & Period Comparison' }),
        el('div', { class: 'pf-kpi-val num is-green', text: money(rep.incomeSummary.periodActual) }),
        el('div', {
          class: 'mono-meta',
          text: `${rep.periodRows.length} ledger row(s) (${rep.fromDate} → ${rep.toDate}) · Normalized: ${money(rep.incomeSummary.profileMonthly)}/mo`
        }),
        el('div', {
          class: 'mono-meta',
          text: rep.prevRows.length
            ? `Prior period (${rep.prevFromDate} → ${rep.prevToDate}): ${money(rep.incomeSummary.prevActual)}${rep.incomeSummary.momDeltaPct !== null ? ` (${rep.incomeSummary.momDeltaPct >= 0 ? '+' : ''}${rep.incomeSummary.momDeltaPct.toFixed(1)}%)` : ''}`
            : `No comparison rows in prior window (${rep.prevFromDate} → ${rep.prevToDate}).`
        })
      ]),
      el('div', { class: 'rep-sheet-box' }, [
        el('span', { class: 'micro-upper', text: '2. Fixed vs Variable & Cash Flow' }),
        el('div', { class: `pf-kpi-val num ${rep.cashFlowAndSurplus.periodBalance >= 0 ? 'is-green' : 'is-brick'}`, text: signed(rep.cashFlowAndSurplus.periodBalance) }),
        el('div', {
          class: 'mono-meta',
          text: `Period Outflow: ${money(rep.cashFlowAndSurplus.periodOutflow)} · Disposable: ${signed(rep.cashFlowAndSurplus.disposableMonthly)}/mo`
        }),
        el('div', {
          class: 'mono-meta',
          text: `Fixed ${rep.fixedVsVariable.fixedPct.toFixed(0)}% (${money(rep.fixedVsVariable.fixedMonthly)}/mo) · Variable ${rep.fixedVsVariable.variablePct.toFixed(0)}% (${money(rep.fixedVsVariable.variableMonthly)}/mo)`
        })
      ]),
      el('div', { class: 'rep-sheet-box' }, [
        el('span', { class: 'micro-upper', text: '3. Tax, Loans & DTI Summary' }),
        el('div', { class: 'pf-kpi-val num', text: `${rep.loansAndDebtSummary.dtiPct.toFixed(1)}% DTI` }),
        el('div', {
          class: 'mono-meta',
          text: `Monthly EMI: ${money(rep.loansAndDebtSummary.monthlyEmi)} · Tax Status: ${rep.taxDeductionsSummary.regime}`
        }),
        el('div', {
          class: 'mono-meta',
          text: `Remaining Tax: ${money(rep.taxDeductionsSummary.remainingPayable)} · Reserve: ${money(rep.taxDeductionsSummary.monthlyReserve)}/mo`
        })
      ]),
      el('div', { class: 'rep-sheet-box' }, [
        el('span', { class: 'micro-upper', text: '4. Savings, Upcoming & Net Worth' }),
        el('div', { class: 'pf-kpi-val num is-green', text: money(rep.savingsProgress.periodSaved) }),
        el('div', {
          class: 'mono-meta',
          text: `Savings Rate: ${rep.savingsProgress.savingsRatePct.toFixed(1)}% · Upcoming Unpaid Items: ${rep.upcomingPayments.length}`
        }),
        el('div', {
          class: 'mono-meta',
          text: rep.summary.netWorth !== null
            ? `Net Worth: ${signed(rep.summary.netWorth)}`
            : 'Net Worth: Not configured in 02 Profile'
        })
      ])
    ]);

    host.appendChild(grid);

    if (rep.expenseBreakdown.length) {
      const tbl = el('table', { class: 'data-table', style: 'margin-top:12px;' }, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'Expense Category' }),
          el('th', { class: 'is-num', text: 'Planned (₹)' }),
          el('th', { class: 'is-num', text: 'Actual (₹)' }),
          el('th', { class: 'is-num', text: 'Variance (₹)' }),
          el('th', { class: 'is-num', text: 'Share' })
        ])),
        el('tbody', {}, rep.expenseBreakdown.slice(0, 8).map(c =>
          el('tr', {}, [
            el('td', { text: c.category }),
            el('td', { class: 'is-num num', text: money(c.planned) }),
            el('td', { class: 'is-num num', text: money(c.actual) }),
            el('td', { class: `is-num num ${c.variance < 0 ? 'is-brick' : 'is-green'}`, text: signed(c.variance) }),
            el('td', { class: 'is-num num', text: `${c.sharePct.toFixed(1)}%` })
          ])
        ))
      ]);
      host.appendChild(el('div', { class: 'table-scroll', style: 'margin-top:12px;' }, tbl));
    }

    if (rep.insights.length) {
      host.appendChild(
        el('p', {
          class: 'mono-meta',
          style: 'margin:12px 0 0;',
          text: `Top AI Advisor Insight Included in Export: [${rep.insights[0].priority}] ${rep.insights[0].title} — ${rep.insights[0].estimatedImpact}`
        })
      );
    }
  }

  /* ============================================================
     SECTION 02: INCOME & EXPENSES + TRANSACTION EDITOR
     ============================================================ */
  function renderIncomeExpenses(rows: Transaction[]) {
    const t = totals(rows);
    renderIncomeOutflowBar('ieBarChart', 'ieBarCap', t);
    renderCompositionStack('ieCompChart', 'ieCompCap', rows, S.compMode);
    syncFormState();
  }

  function syncFormState() {
    const canEdit = Perm.can('edit');
    const title = $('#txFormTitle');
    const modePill = $('#txModePill');
    const subBtn = $('#txSubmit') as HTMLButtonElement | null;
    const cancelBtn = $('#txCancel') as HTMLButtonElement | null;
    const delBtn = $('#txDelete') as HTMLButtonElement | null;
    const roNote = $('#txReadOnlyNote');

    if (S.editId !== null) {
      if (title) title.textContent = `Editing record #${S.editId}`;
      if (modePill) {
        modePill.textContent = `Editing #${S.editId}`;
        modePill.classList.add('is-editing');
      }
      if (subBtn) subBtn.textContent = 'Save changes';
      if (cancelBtn) cancelBtn.hidden = false;
      if (delBtn) delBtn.hidden = !canEdit;
    } else {
      if (title) title.textContent = 'Log new household transaction';
      if (modePill) {
        modePill.textContent = `New entry #${S.nextId}`;
        modePill.classList.remove('is-editing');
      }
      if (subBtn) subBtn.textContent = 'Add transaction';
      if (cancelBtn) cancelBtn.hidden = true;
      if (delBtn) delBtn.hidden = true;
    }

    const idIn = $('#fId') as HTMLInputElement | null;
    if (idIn && S.editId === null && !idIn.value) idIn.value = String(S.nextId);

    const form = $('#txForm') as HTMLFormElement | null;
    if (form) {
      Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button')).forEach(ctrl => {
        if (ctrl.id !== 'txClear') ctrl.disabled = !canEdit;
      });
    }
    if (roNote) roNote.hidden = canEdit;
    updateAutoYearMonth();
  }

  function updateAutoYearMonth() {
    const dVal = ($('#fDate') as HTMLInputElement | null)?.value;
    const yrEl = $('#fYearAuto') as HTMLInputElement | null;
    const moEl = $('#fMonthAuto') as HTMLInputElement | null;
    if (!dVal || !yrEl || !moEl) return;
    const d = new Date(dVal + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return;
    yrEl.value = String(d.getFullYear());
    moEl.value = MONTHS[d.getMonth()];
  }

  function loadIntoForm(r: Transaction) {
    S.editId = r.id;
    const setVal = (id: string, val: string | number | undefined) => {
      const el = $(id) as HTMLInputElement | HTMLSelectElement | null;
      if (el) el.value = String(val ?? '');
    };
    setVal('#fId', r.id);
    setVal('#fDate', r.date);
    setVal('#fMemberIn', r.member);
    setVal('#fTypeIn', r.type);
    setVal('#fCatIn', r.category);
    setVal('#fDescIn', r.desc);
    setVal('#fPmIn', r.pm);
    setVal('#fBudgetIn', r.budget);
    setVal('#fSpentIn', r.spent);
    setVal('#fStatusIn', r.status);
    setVal('#fDueIn', r.due || '');
    setVal('#fPaidOnIn', r.paidOn || '');
    syncFormState();
  }

  function clearForm() {
    S.editId = null;
    const form = $('#txForm') as HTMLFormElement | null;
    if (form) form.reset();
    const dEl = $('#fDate') as HTMLInputElement | null;
    if (dEl) dEl.value = new Date().toISOString().slice(0, 10);
    const idEl = $('#fId') as HTMLInputElement | null;
    if (idEl) idEl.value = String(S.nextId);
    const stEl = $('#fStatusIn') as HTMLSelectElement | null;
    if (stEl) stEl.value = 'PAID';
    const tyEl = $('#fTypeIn') as HTMLSelectElement | null;
    if (tyEl) tyEl.value = 'EXPENSE';
    syncFormState();
  }

  function startEdit(id: number, jumpToSection02 = true) {
    const r = S.tx.find(x => x.id === id);
    if (!r) return;
    loadIntoForm(r);
    if (jumpToSection02) {
      document.getElementById('s02')?.scrollIntoView({ behavior: 'smooth' });
    } else {
      openTxDialog(r);
    }
  }

  function markPaid(id: number) {
    if (!Perm.demand('edit')) return;
    const r = S.tx.find(x => x.id === id);
    if (!r) return;
    r.status = 'PAID';
    if (num(r.spent) === 0 && num(r.budget) > 0) r.spent = num(r.budget);
    r.paidOn = new Date().toISOString().slice(0, 10);
    persist();
    renderAll();
    toast(`Marked #${r.id} (${r.desc}) as Paid`, 'ok');
  }

  async function deleteRecord(id: number) {
    if (!Perm.demand('edit')) return;
    const r = S.tx.find(x => x.id === id);
    if (!r) return;
    const ok = await askConfirm(
      `Delete record #${id}?`,
      `Remove "${r.desc}" (${money(num(r.spent) || num(r.budget))}) from the household ledger? This cannot be undone.`,
      'Delete record'
    );
    if (!ok) return;
    S.tx = S.tx.filter(x => x.id !== id);
    if (S.editId === id) clearForm();
    recomputeNextId();
    persist();
    renderAll();
    toast(`Deleted record #${id}`, 'ok');
  }

  function openTxDialog(row?: Transaction | null, preset?: Partial<Transaction>) {
    if (!Perm.demand('edit')) return;
    const dlg = $('#txDialog') as HTMLDialogElement | null;
    if (!dlg) return;
    const title = $('#txDialogTitle');
    const isEdit = !!row;
    if (title) title.textContent = isEdit ? `Edit transaction #${row!.id}` : 'Add household transaction';
    const set = (id: string, val: string | number | undefined) => {
      const el = $(id) as HTMLInputElement | HTMLSelectElement | null;
      if (el) el.value = String(val ?? '');
    };
    const today = new Date().toISOString().slice(0, 10);
    set('#mId', isEdit ? row!.id : S.nextId);
    set('#mDate', isEdit ? row!.date : preset?.date || today);
    set('#mMember', isEdit ? row!.member : preset?.member || 'SYAM');
    set('#mType', isEdit ? row!.type : preset?.type || 'EXPENSE');
    set('#mCat', isEdit ? row!.category : preset?.category || 'EXPENSE');
    set('#mDesc', isEdit ? row!.desc : preset?.desc || '');
    set('#mPm', isEdit ? row!.pm : preset?.pm || 'UPI');
    set('#mBudget', isEdit ? row!.budget : preset?.budget ?? 0);
    set('#mSpent', isEdit ? row!.spent : preset?.spent ?? 0);
    set('#mStatus', isEdit ? row!.status : preset?.status || 'PAID');
    set('#mDue', isEdit ? row!.due || '' : preset?.due || '');
    set('#mPaidOn', isEdit ? row!.paidOn || '' : preset?.paidOn || '');
    dlg.setAttribute('data-editing-id', isEdit ? String(row!.id) : '');
    dlg.showModal();
  }

  function closeTxDialog() {
    const dlg = $('#txDialog') as HTMLDialogElement | null;
    if (dlg && dlg.open) dlg.close();
  }

  /* ============================================================
     SECTION 03: BUDGET INTELLIGENCE
     ============================================================ */
  function renderInlineCardProgress(hostSelector: string, titleLabel: string, spent: number, budget: number) {
    const host = $(hostSelector);
    if (!host) return;
    host.innerHTML = '';

    const hasBudget = budget > 0;
    const pct = hasBudget ? (spent / budget) * 100 : spent > 0 ? 100 : 0;
    const clamped = Math.min(100, Math.max(0, pct));

    let tier = 'tier-green';
    let stateWord = 'Healthy';
    if (!hasBudget && spent === 0) {
      tier = 'tier-neutral';
      stateWord = 'No budget';
    } else if (!hasBudget && spent > 0) {
      tier = 'tier-red';
      stateWord = 'Unbudgeted';
    } else if (pct >= 100) {
      tier = 'tier-red';
      stateWord = spent > budget ? 'Over budget' : 'At limit';
    } else if (pct >= 85) {
      tier = 'tier-orange';
      stateWord = 'High usage';
    } else if (pct >= 70) {
      tier = 'tier-amber';
      stateWord = 'Approaching limit';
    }

    const pctLabel = !hasBudget && spent > 0 ? 'Unbudgeted' : `${pct.toFixed(1)}%`;

    const meta = el('div', { class: 'budget-inline-head' }, [
      el('span', { class: 'mono-meta', text: `${titleLabel}: ${money(spent)} / ${money(budget)}` }),
      el('span', { class: `budget-inline-pct num ${tier}`, text: `${pctLabel} · ${stateWord}` })
    ]);
    const track = el('div', {
      class: `budget-bar-track ${tier}`,
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(Math.round(clamped)),
      'aria-label': `${titleLabel} budget usage ${pctLabel}`
    }, el('div', { class: 'budget-bar-fill', style: `width:${clamped.toFixed(1)}%` }));

    host.appendChild(meta);
    host.appendChild(track);
  }

  function renderMemberInlineProgress(rows: Transaction[]) {
    const memberRows = S.rotMember === 'ALL' ? rows : rows.filter(r => r.member === S.rotMember);
    const mt = totals(memberRows);
    const label = S.rotMember === 'ALL' ? 'All members budget used' : `${S.rotMember} budget used`;
    renderInlineCardProgress('#bRotProg', label, mt.spent, mt.budget);
  }

  function renderBudgetIntelligence(rows: Transaction[]) {
    const t = totals(rows);
    const setT = (id: string, text: string) => {
      const node = $(id);
      if (node) node.textContent = text;
    };
    setT('#bKpiBudget', money(t.budget));
    setT('#bKpiSpent', money(t.spent));
    setT('#bKpiRem', signed(t.variance));
    const pct = t.budget > 0 ? (t.spent / t.budget) * 100 : 0;
    setT('#bKpiPct', `${pct.toFixed(1)}%`);

    const kpiTrack = $('#bKpiBarTrack');
    const kpiFill = $('#bKpiBarFill');
    if (kpiTrack && kpiFill) {
      const clampedKpi = Math.min(100, Math.max(0, pct));
      const tier =
        t.budget <= 0 && t.spent === 0
          ? 'tier-neutral'
          : pct >= 100 || (t.budget <= 0 && t.spent > 0)
            ? 'tier-red'
            : pct >= 85
              ? 'tier-orange'
              : pct >= 70
                ? 'tier-amber'
                : 'tier-green';
      kpiTrack.className = `budget-bar-track ${tier}`;
      kpiTrack.setAttribute('aria-valuenow', String(Math.round(clampedKpi)));
      kpiFill.style.width = `${clampedKpi.toFixed(1)}%`;
    }

    renderBudgetProgressCards('bProgCardsHost', rows, S.bProgFilter, S.dumbSort);
    renderInlineCardProgress('#bDumbProg', 'Filtered outflow budget used', t.spent, t.budget);
    renderMemberInlineProgress(rows);
    renderInlineCardProgress('#hmProg', 'Category spend vs budget', t.spent, t.budget);

    const overHost = $('#bOverList');
    if (overHost) {
      overHost.innerHTML = '';
      const overItems = rows
        .filter(r => r.type.toUpperCase() !== 'INCOME' && num(r.budget) > 0 && num(r.spent) > num(r.budget))
        .sort((a, b) => (b.spent - b.budget) - (a.spent - a.budget));

      if (!overItems.length) {
        overHost.appendChild(el('p', { class: 'mono-meta', text: 'Zero overspending alerts — every budgeted item is within plan.' }));
      } else {
        overItems.slice(0, 6).forEach(r => {
          const diff = r.spent - r.budget;
          overHost.appendChild(
            el('div', { class: 'feed-row' }, [
              el('div', { class: 'feed-main' }, [
                el('div', { class: 'feed-title', text: `${r.desc} (${r.member})` }),
                el('div', { class: 'mono-meta', text: `Planned ${money(r.budget)} · Actual ${money(r.spent)}` })
              ]),
              el('span', { class: 'num feed-amt is-brick', text: `+${money(diff)} over` })
            ])
          );
        });
      }
    }

    renderBudgetDumbbell('bDumbChart', 'bDumbCap', rows, S.dumbSort);
    renderRotatedKpiBars('bRotChart', 'bRotCap', rows, S.rotMember);
    renderSpendingHeatmap('hmHost', 'hmCap', 'hmLiveCount', rows, S.hmAxis, S.hmThresh);
  }

  /* ============================================================
     SECTION 04: SAVINGS & GOALS
     ============================================================ */
  function renderSavingsGoals(rows: Transaction[]) {
    const t = totals(rows);
    const savRows = rows.filter(r => r.type.toUpperCase() === 'SAVING');
    const savTotals = totals(savRows);
    const savRate = t.income > 0 ? (t.saving / t.income) * 100 : 0;

    const setT = (id: string, txt: string) => {
      const node = $(id);
      if (node) node.textContent = txt;
    };
    setT('#svKpiTotal', money(savTotals.spent));
    setT('#svKpiBudget', money(savTotals.budget));
    setT('#svKpiRate', `${savRate.toFixed(1)}%`);
    setT('#svKpiCount', `${savRows.length} entries`);

    renderWaffleAllocation('svWaffleHost', 'svStatHost', 'svWaffleCap', rows, S.svMember);
    renderSavingsTrend('svTrendHost', 'svTrendCap', rows);

    const tbody = $('#svTableBody');
    if (tbody) {
      tbody.innerHTML = '';
      if (!savRows.length) {
        tbody.appendChild(el('tr', {}, el('td', { colspan: '6', class: 'mono-meta', text: 'No savings instruments in current filter.' })));
      } else {
        savRows.forEach(r => {
          const pct = r.budget > 0 ? Math.min(100, Math.round((r.spent / r.budget) * 100)) : 100;
          tbody.appendChild(
            el('tr', {}, [
              el('td', { text: r.desc }),
              el('td', { text: r.member }),
              el('td', { text: r.pm }),
              el('td', { class: 'is-num num', text: money(r.budget) }),
              el('td', { class: 'is-num num', text: money(r.spent) }),
              el('td', { class: 'is-num num', text: `${pct}% (${r.status})` })
            ])
          );
        });
      }
    }
  }

  /* ============================================================
     SECTION 05: LOANS & LIABILITIES
     ============================================================ */
  function renderLoansLiabilities(rows: Transaction[]) {
    const t = totals(rows);
    const loanRows = rows.filter(r => r.type.toUpperCase() === 'LOAN');
    const loanTotals = totals(loanRows);
    const share = t.income > 0 ? (loanTotals.spent / t.income) * 100 : 0;

    const setT = (id: string, txt: string) => {
      const node = $(id);
      if (node) node.textContent = txt;
    };
    setT('#lnKpiPaid', money(loanTotals.spent));
    setT('#lnKpiDue', money(loanTotals.due));
    setT('#lnKpiShare', `${share.toFixed(1)}%`);
    setT('#lnKpiCount', `${loanRows.length} EMIs`);

    renderLoanProgress('lnProgHost', 'lnProgCap', rows);
    renderObligationsTimeline('lnTlTrack', 'lnTlDetail', 'lnTlCap', rows, markPaid);

    const tbody = $('#lnTableBody');
    if (tbody) {
      tbody.innerHTML = '';
      if (!loanRows.length) {
        tbody.appendChild(el('tr', {}, el('td', { colspan: '6', class: 'mono-meta', text: 'No loan records match the active filter.' })));
      } else {
        loanRows.forEach(r => {
          const dueFlag = isDue(r);
          tbody.appendChild(
            el('tr', {}, [
              el('td', { text: r.desc }),
              el('td', { text: r.category }),
              el('td', { text: r.member }),
              el('td', { class: 'is-num num', text: money(r.budget) }),
              el('td', { class: 'is-num num', text: money(r.spent) }),
              el('td', { class: dueFlag ? 'is-brick' : 'is-green', text: r.status })
            ])
          );
        });
      }
    }
  }

  /* ============================================================
     SECTION 06: TRANSACTIONS MASTER TABLE & EXPORTS
     ============================================================ */
  function renderTransactionsTable(rows: Transaction[]) {
    const q = S.tSearch.trim().toLowerCase();
    let list = rows.filter(r => {
      if (S.tStatusFilter === 'PAID' && !isPaid(r)) return false;
      if (S.tStatusFilter === 'TO BE PAID' && !isDue(r)) return false;
      if (!q) return true;
      return (
        String(r.id).includes(q) ||
        r.date.toLowerCase().includes(q) ||
        r.member.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        r.desc.toLowerCase().includes(q) ||
        r.pm.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      const k = S.tSortKey;
      let va: string | number;
      let vb: string | number;
      if (k === 'year') {
        va = yearOf(a);
        vb = yearOf(b);
      } else if (k === 'month') {
        va = monthOf(a);
        vb = monthOf(b);
      } else {
        va = (a[k] ?? '') as string | number;
        vb = (b[k] ?? '') as string | number;
      }
      if (typeof va === 'number' || typeof vb === 'number') {
        const diff = num(va) - num(vb);
        return S.tSortDir === 'asc' ? diff : -diff;
      }
      const cmp = String(va).localeCompare(String(vb));
      return S.tSortDir === 'asc' ? cmp : -cmp;
    });

    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / S.tSize));
    if (S.tPage > pages) S.tPage = pages;
    if (S.tPage < 1) S.tPage = 1;

    const slice = list.slice((S.tPage - 1) * S.tSize, S.tPage * S.tSize);

    const cols: Array<{ key: keyof Transaction | 'year' | 'month'; label: string; num?: boolean }> = [
      { key: 'id', label: 'ID', num: true },
      { key: 'date', label: 'Date' },
      { key: 'member', label: 'Member' },
      { key: 'type', label: 'Type' },
      { key: 'category', label: 'Category' },
      { key: 'desc', label: 'Description' },
      { key: 'pm', label: 'PM' },
      { key: 'budget', label: 'Budget', num: true },
      { key: 'spent', label: 'Actual', num: true },
      { key: 'status', label: 'Status' }
    ];

    const thead = $('#tHead');
    if (thead) {
      thead.innerHTML = '';
      const tr = el('tr', {});
      cols.forEach(c => {
        const active = S.tSortKey === c.key;
        const btn = el('button', {
          type: 'button',
          class: 'sort-btn',
          html: `${esc(c.label)} <span aria-hidden="true">${active ? (S.tSortDir === 'asc' ? '↑' : '↓') : '↕'}</span>`
        });
        btn.addEventListener('click', () => {
          if (S.tSortKey === c.key) S.tSortDir = S.tSortDir === 'asc' ? 'desc' : 'asc';
          else {
            S.tSortKey = c.key;
            S.tSortDir = c.num ? 'desc' : 'asc';
          }
          renderTransactionsTable(rows);
        });
        tr.appendChild(el('th', { class: c.num ? 'is-num' : '', scope: 'col' }, btn));
      });
      tr.appendChild(el('th', { class: 'is-num', scope: 'col', text: 'Actions' }));
      thead.appendChild(tr);
    }

    const tbody = $('#tBody');
    if (tbody) {
      tbody.innerHTML = '';
      if (!slice.length) {
        tbody.appendChild(el('tr', {}, el('td', { colspan: '11', class: 'mono-meta', text: 'No matching transactions.' })));
      } else {
        const canEdit = Perm.can('edit');
        slice.forEach(r => {
          const dueFlag = isDue(r);
          const paidFlag = isPaid(r);
          const statusCls = dueFlag ? 'is-brick' : paidFlag ? 'is-green' : '';

          const actionsCell = el('td', { class: 'is-num tbl-actions' });
          if (canEdit) {
            if (dueFlag) {
              const mp = el('button', { type: 'button', class: 'btn sm ghost', text: 'Mark paid' });
              mp.addEventListener('click', () => markPaid(r.id));
              actionsCell.appendChild(mp);
            }
            const ed = el('button', { type: 'button', class: 'btn sm ghost', text: 'Edit' });
            ed.addEventListener('click', () => startEdit(r.id, false));
            const dl = el('button', { type: 'button', class: 'btn sm ghost is-brick', text: 'Del' });
            dl.addEventListener('click', () => deleteRecord(r.id));
            actionsCell.appendChild(ed);
            actionsCell.appendChild(dl);
          } else {
            actionsCell.appendChild(el('span', { class: 'mono-meta', text: 'Read-only' }));
          }

          tbody.appendChild(
            el('tr', {}, [
              el('td', { class: 'is-num num', text: `#${r.id}` }),
              el('td', { class: 'num', text: fmtDate(r.date) || r.date }),
              el('td', { text: r.member }),
              el('td', { text: r.type }),
              el('td', { text: r.category }),
              el('td', { text: r.desc }),
              el('td', { text: r.pm }),
              el('td', { class: 'is-num num', text: money(r.budget) }),
              el('td', { class: 'is-num num', text: money(r.spent) }),
              el('td', { class: statusCls, text: r.status }),
              actionsCell
            ])
          );
        });
      }
    }

    const info = $('#tInfo');
    const pLabel = $('#tPageLabel');
    const prev = $('#tPrev') as HTMLButtonElement | null;
    const next = $('#tNext') as HTMLButtonElement | null;
    if (info) {
      const start = total === 0 ? 0 : (S.tPage - 1) * S.tSize + 1;
      const end = Math.min(total, S.tPage * S.tSize);
      info.textContent = `Showing ${start}–${end} of ${total} rows`;
    }
    if (pLabel) pLabel.textContent = `Page ${S.tPage} / ${pages}`;
    if (prev) prev.disabled = S.tPage <= 1;
    if (next) next.disabled = S.tPage >= pages;
  }

  /* ============================================================
     SECTION 07: REPORTS & ANALYTICS (Scrolly + OLS + 9 Pivots)
     ============================================================ */
  function buildReportMatrix(rows: Transaction[]): { cols: Array<{ label: string; num?: boolean }>; body: Array<Array<string | number>> } {
    const id = S.reportId;
    if (id === 'detail') {
      const filteredByEntity =
        S.reportEntity === 'ALL' ? rows : rows.filter(r => r.member === S.reportEntity);
      const t = totals(filteredByEntity);
      return {
        cols: [
          { label: 'ID', num: true },
          { label: 'Date' },
          { label: 'Member' },
          { label: 'Type' },
          { label: 'Category' },
          { label: 'Description' },
          { label: 'PM' },
          { label: 'Budget', num: true },
          { label: 'Actual', num: true },
          { label: 'Status' }
        ],
        body: [
          ...filteredByEntity.map(r => [r.id, r.date, r.member, r.type, r.category, r.desc, r.pm, money(r.budget), money(r.spent), r.status]),
          ['TOTAL', '', '', '', '', `${filteredByEntity.length} records`, '', money(t.rawBudget), money(t.rawSpent), '']
        ]
      };
    }

    const keyFnMap: Record<Exclude<ReportId, 'detail'>, (r: Transaction) => string> = {
      monthly: r => `${yearOf(r)} ${monthOf(r)}`.trim(),
      member: r => r.member,
      type: r => r.type,
      category: r => r.category,
      pm: r => r.pm,
      status: r => r.status,
      desc: r => r.desc,
      loan: r => r.category
    };

    const scopeRows = id === 'loan' ? rows.filter(r => r.type.toUpperCase() === 'LOAN') : rows;
    let groups = groupBy(scopeRows, keyFnMap[id]);
    if (S.reportEntity !== 'ALL') groups = groups.filter(g => g.key === S.reportEntity);
    groups.sort((a, b) => b.rawSpent - a.rawSpent);

    const t = totals(groups.flatMap(g => g.rows));
    const repLabel = REPORTS.find(x => x.id === id)?.label || 'Group';

    return {
      cols: [
        { label: repLabel },
        { label: 'Rows', num: true },
        { label: 'Income (₹)', num: true },
        { label: 'Expense (₹)', num: true },
        { label: 'Loan (₹)', num: true },
        { label: 'Saving (₹)', num: true },
        { label: 'Budget (₹)', num: true },
        { label: 'Spent (₹)', num: true },
        { label: 'Variance (₹)', num: true }
      ],
      body: [
        ...groups.map(g => [
          g.key,
          g.count,
          money(g.income),
          money(g.expense),
          money(g.loan),
          money(g.saving),
          money(g.budget),
          money(g.spent),
          signed(g.variance)
        ]),
        [
          'TOTAL',
          t.count,
          money(t.income),
          money(t.expense),
          money(t.loan),
          money(t.saving),
          money(t.budget),
          money(t.spent),
          signed(t.variance)
        ]
      ]
    };
  }

  function renderReportsAnalytics(rows: Transaction[]) {
    renderScrollyColumns(
      'scrollyChart',
      'scrollyLegend',
      'scrollyCap',
      rows,
      S.scrollyStep,
      S.scrollyMode,
      S.scrollySeries,
      key => {
        if (S.scrollySeries.has(key) && S.scrollySeries.size > 1) S.scrollySeries.delete(key);
        else S.scrollySeries.add(key);
        renderReportsAnalytics(rows);
      }
    );

    renderBudgetScatterOLS(
      'scChart',
      'scChips',
      'scCap',
      rows,
      S.scatterMinBudget,
      S.scatterTrend,
      S.scatterTypes,
      key => {
        if (S.scatterTypes.has(key) && S.scatterTypes.size > 1) S.scatterTypes.delete(key);
        else S.scatterTypes.add(key);
        renderReportsAnalytics(rows);
      },
      (slope, r2) => {
        const sEl = $('#scSlope');
        const rEl = $('#scR2');
        if (sEl) sEl.textContent = slope;
        if (rEl) rEl.textContent = r2;
      }
    );

    // 9 Pivot Report tabs & entity filter
    const tabsHost = $('#repTabs');
    if (tabsHost) {
      tabsHost.innerHTML = '';
      REPORTS.forEach(r => {
        const b = el('button', {
          type: 'button',
          class: 'seg-btn',
          'aria-pressed': String(S.reportId === r.id),
          text: r.name
        });
        b.addEventListener('click', () => {
          S.reportId = r.id;
          S.reportEntity = 'ALL';
          renderReportsAnalytics(rows);
        });
        tabsHost.appendChild(b);
      });
    }

    const entSel = $('#repEntitySel') as HTMLSelectElement | null;
    if (entSel) {
      const entityOpts = (() => {
        if (S.reportId === 'monthly') return uniq(rows.map(r => `${yearOf(r)} ${monthOf(r)}`.trim()));
        if (S.reportId === 'member' || S.reportId === 'detail') return uniq(rows.map(r => r.member));
        if (S.reportId === 'type') return uniq(rows.map(r => r.type));
        if (S.reportId === 'category') return uniq(rows.map(r => r.category));
        if (S.reportId === 'pm') return uniq(rows.map(r => r.pm));
        if (S.reportId === 'status') return uniq(rows.map(r => r.status));
        if (S.reportId === 'loan') return uniq(rows.filter(r => r.type.toUpperCase() === 'LOAN').map(r => r.category));
        return uniq(rows.map(r => r.desc));
      })();
      entSel.innerHTML = `<option value="ALL">All (${entityOpts.length})</option>` + entityOpts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
      entSel.value = entityOpts.includes(S.reportEntity) ? S.reportEntity : 'ALL';
      S.reportEntity = entSel.value;
    }

    const host = $('#repTableHost');
    if (host) {
      const mat = buildReportMatrix(rows);
      host.innerHTML = '';
      const tbl = el('table', { class: 'data-table' }, [
        el('thead', {}, el('tr', {}, mat.cols.map(c => el('th', { class: c.num ? 'is-num' : '', text: c.label })))),
        el(
          'tbody',
          {},
          mat.body.map((row, idx) =>
            el(
              'tr',
              { class: idx === mat.body.length - 1 ? 'rep-total-row' : '' },
              row.map((cell, ci) => el('td', { class: mat.cols[ci]?.num ? 'is-num num' : '', text: String(cell) }))
            )
          )
        )
      ]);
      host.appendChild(tbl);
    }
  }

  /* ============================================================
     SECTION 08: HOUSEHOLD MEMBERS & ROLES
     ============================================================ */
  function renderMembersSection() {
    const houseNameEl = $('#pplHouseName');
    const maxNote = $('#pplMaxNote');
    const members = SessionContext.members || [];
    if (houseNameEl && SessionContext.house) houseNameEl.textContent = SessionContext.house.name;
    if (maxNote) maxNote.textContent = `${members.length} / ${MAX_MEMBERS} members`;

    const body = $('#pplBody');
    const canManage = Perm.can('manage');
    const inviteCard = $('#pplInviteCard');
    if (inviteCard) inviteCard.hidden = !canManage;

    if (body) {
      body.innerHTML = '';
      members.forEach((m: Member) => {
        const initials = (m.name || m.email).slice(0, 2).toUpperCase();
        const isOwner = SessionContext.house && m.email === SessionContext.house.owner;
        const roleCell = el('td');
        if (canManage && !isOwner) {
          const sel = el('select', { class: 'sel-sm', 'aria-label': `Role for ${m.email}` }) as HTMLSelectElement;
          (['admin', 'editor', 'viewer'] as Role[]).forEach(rk => {
            const opt = el('option', { value: rk, text: ROLES[rk].name });
            if (m.role === rk) (opt as HTMLOptionElement).selected = true;
            sel.appendChild(opt);
          });
          sel.addEventListener('change', async () => {
            try {
              SessionContext.members = await Backend.setRole(m.email, sel.value as Role);
              renderMembersSection();
              toast(`Updated ${m.email} to ${ROLES[sel.value as Role].name}`, 'ok');
            } catch (err: any) {
              toast(err?.message || 'Could not update role', 'err');
              renderMembersSection();
            }
          });
          roleCell.appendChild(sel);
        } else {
          roleCell.textContent = ROLES[m.role]?.name || m.role;
        }

        const actCell = el('td', { class: 'is-num' });
        if (canManage && !isOwner) {
          const rm = el('button', { type: 'button', class: 'btn sm ghost is-brick', text: 'Remove' });
          rm.addEventListener('click', async () => {
            const ok = await askConfirm('Remove household member?', `Revoke access for ${m.email}?`, 'Remove member');
            if (!ok) return;
            try {
              SessionContext.members = await Backend.removeMember(m.email);
              renderMembersSection();
              toast(`Removed ${m.email}`, 'ok');
            } catch (err: any) {
              toast(err?.message || 'Could not remove member', 'err');
            }
          });
          actCell.appendChild(rm);
        } else {
          actCell.appendChild(el('span', { class: 'mono-meta', text: isOwner ? 'Owner' : '—' }));
        }

        body.appendChild(
          el('tr', {}, [
            el('td', {}, [
              el('span', { class: 'avatar-chip', text: initials }),
              document.createTextNode(m.name || m.email.split('@')[0])
            ]),
            el('td', { class: 'mono-meta', text: m.email }),
            roleCell,
            el('td', { class: m.status === 'active' ? 'is-green' : '', text: m.status === 'active' ? 'Active' : 'Invited' }),
            actCell
          ])
        );
      });
    }
  }

  /* ============================================================
     SECTION 09: DATA MANAGEMENT (Import / Backup / Reset)
     ============================================================ */
  function scanSheet(matrix: any[][]) {
    if (!Array.isArray(matrix) || !matrix.length) return { headerRow: 0, headers: [] as string[], score: 0 };
    const keywords = ['date', 'member', 'type', 'category', 'desc', 'description', 'budget', 'spent', 'actual', 'amount', 'status', 'pm', 'payment'];
    let bestIdx = 0;
    let bestScore = -1;
    const limit = Math.min(25, matrix.length);
    for (let i = 0; i < limit; i++) {
      const row = matrix[i] || [];
      let score = 0;
      row.forEach(cell => {
        const s = String(cell || '').trim().toLowerCase();
        if (s && keywords.some(k => s.includes(k))) score++;
      });
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    const headers = (matrix[bestIdx] || []).map(h => String(h || '').trim());
    return { headerRow: bestIdx, headers, score: bestScore };
  }

  function excelSerialToIso(v: unknown): string {
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      const utc = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
      return utc.toISOString().slice(0, 10);
    }
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
      return v.toISOString().slice(0, 10);
    }
    const s = String(v || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() > 1990) {
      return parsed.toISOString().slice(0, 10);
    }
    return new Date().toISOString().slice(0, 10);
  }

  function normaliseRows(matrix: any[][], headerIdx: number): Transaction[] {
    const rawHeaders = (matrix[headerIdx] || []).map(h => String(h || '').trim().toLowerCase());
    const findCol = (...patterns: string[]) =>
      rawHeaders.findIndex(h => patterns.some(p => h === p || h.includes(p)));

    const idxDate = findCol('date', 'trans date');
    const idxMember = findCol('member', 'person', 'who');
    const idxType = findCol('type', 'flow');
    const idxCat = findCol('category', 'cat');
    const idxDesc = findCol('description', 'desc', 'particular', 'item', 'narration');
    const idxPm = findCol('payment method', 'pm', 'mode', 'method');
    const idxBudget = findCol('budget', 'planned');
    const idxSpent = findCol('actually spent', 'spent', 'actual', 'amount');
    const idxStatus = findCol('status');
    const idxDue = findCol('due');
    const idxPaid = findCol('paid on', 'paid date');

    const out: Transaction[] = [];
    for (let r = headerIdx + 1; r < matrix.length; r++) {
      const row = matrix[r] || [];
      const nonEmpty = row.some(c => c !== null && c !== undefined && String(c).trim() !== '');
      if (!nonEmpty) continue;
      const desc = idxDesc >= 0 ? String(row[idxDesc] ?? '').trim() : '';
      const budget = idxBudget >= 0 ? num(row[idxBudget]) : 0;
      const spent = idxSpent >= 0 ? num(row[idxSpent]) : 0;
      if (!desc && budget === 0 && spent === 0) continue;
      if (desc.toUpperCase() === 'TOTAL' || desc.toUpperCase() === 'GRAND TOTAL') continue;

      const tyRaw = (idxType >= 0 ? String(row[idxType] ?? '') : '').trim().toUpperCase();
      const ty = tyRaw === 'INCOME' || tyRaw === 'EXPENSE' || tyRaw === 'LOAN' || tyRaw === 'SAVING' ? tyRaw : 'EXPENSE';

      out.push({
        id: out.length + 1,
        date: idxDate >= 0 ? excelSerialToIso(row[idxDate]) : new Date().toISOString().slice(0, 10),
        member: (idxMember >= 0 ? String(row[idxMember] ?? '') : '').trim().toUpperCase() || 'SYAM',
        type: ty,
        category: (idxCat >= 0 ? String(row[idxCat] ?? '') : '').trim().toUpperCase() || ty,
        desc: desc.toUpperCase() || 'IMPORTED ENTRY',
        pm: (idxPm >= 0 ? String(row[idxPm] ?? '') : '').trim().toUpperCase() || 'UPI',
        budget,
        spent,
        status: (idxStatus >= 0 ? String(row[idxStatus] ?? '') : '').trim() || (spent > 0 ? 'PAID' : 'TO BE PAID'),
        due: idxDue >= 0 && row[idxDue] ? excelSerialToIso(row[idxDue]) : undefined,
        paidOn: idxPaid >= 0 && row[idxPaid] ? excelSerialToIso(row[idxPaid]) : undefined
      });
    }
    return out;
  }

  async function handleImportFile(file: File) {
    if (!Perm.demand('import')) return;
    const statusEl = $('#impStatus');
    const previewEl = $('#impPreview');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      let bestSheet = wb.SheetNames[0];
      let bestScan = { headerRow: 0, headers: [] as string[], score: -1 };
      let bestMatrix: any[][] = [];

      wb.SheetNames.forEach(name => {
        const ws = wb.Sheets[name];
        const mat = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' });
        const sc = scanSheet(mat);
        if (sc.score > bestScan.score) {
          bestScan = sc;
          bestSheet = name;
          bestMatrix = mat;
        }
      });

      const parsed = normaliseRows(bestMatrix, bestScan.headerRow);
      if (!parsed.length) {
        if (statusEl) statusEl.textContent = `No transaction rows detected in ${file.name} (sheet "${bestSheet}").`;
        toast('Could not detect valid rows in that spreadsheet', 'err');
        return;
      }

      if (S.importMode === 'replace') {
        const ok = await askConfirm(
          'Replace entire household ledger?',
          `Replace all ${S.tx.length} current transactions with ${parsed.length} rows from "${file.name}"?`,
          'Replace ledger'
        );
        if (!ok) return;
        S.tx = parsed.map((r, i) => ({ ...r, id: i + 1 }));
      } else {
        let next = S.nextId;
        const added = parsed.map(r => ({ ...r, id: next++ }));
        S.tx = [...S.tx, ...added];
      }

      recomputeNextId();
      persist();
      renderAll();

      if (statusEl) statusEl.textContent = `Imported ${parsed.length} rows from "${file.name}" (sheet: ${bestSheet}, mode: ${S.importMode}).`;
      if (previewEl) {
        previewEl.innerHTML = '';
        parsed.slice(0, 5).forEach(r => {
          previewEl.appendChild(
            el('div', { class: 'feed-row' }, [
              el('span', { text: `${r.date} · ${r.member} · ${r.desc}` }),
              el('span', { class: 'num', text: money(r.spent || r.budget) })
            ])
          );
        });
      }
      toast(`Imported ${parsed.length} transactions`, 'ok');
    } catch (err: any) {
      if (statusEl) statusEl.textContent = `Import error: ${err?.message || 'Unsupported file'}`;
      toast('Failed to read spreadsheet', 'err');
    }
  }

  /* ============================================================
     SECTION 10: SETTINGS (Inline Theme Cards + Server Sync)
     ============================================================ */
  function renderSettingsSection() {
    const grid = $('#inlineThemeGrid');
    if (grid) {
      const cur = themeApi.getCurrent();
      grid.innerHTML = '';
      THEMES.forEach(t => {
        const btn = el(
          'button',
          {
            type: 'button',
            class: `inline-theme-card${t.id === cur ? ' is-active' : ''}`,
            'data-inline-theme': t.id,
            'aria-pressed': String(t.id === cur)
          },
          [
            el('span', { class: 'theme-swatch', 'data-swatch': t.id, 'aria-hidden': 'true' }, [
              el('span', { class: 'sw-band' }),
              el('span', { class: 'sw-mid' }, [el('span', { class: 'sw-line' }), el('span', { class: 'sw-bars' }, [el('i'), el('i'), el('i')])]),
              el('span', { class: 'sw-ramp' }, [el('i'), el('i'), el('i'), el('i'), el('i'), el('i')])
            ]),
            el('span', { class: 'inline-theme-meta' }, [
              el('strong', { text: t.name + (t.badge ? ` (${t.badge})` : '') }),
              el('span', { class: 'mono-meta', text: t.desc })
            ])
          ]
        );
        btn.addEventListener('click', () => themeApi.applyTheme(t.id as ThemeId));
        grid.appendChild(btn);
      });
    }

    const conn = $('#connState');
    const connDet = $('#connDetail');
    const srvInput = $('#srvUrl') as HTMLInputElement | null;
    if (srvInput && !srvInput.value) srvInput.value = Net.savedBase();
    if (conn) {
      conn.textContent =
        Net.mode === 'firebase'
          ? 'Firebase Auth + Firestore E2EE'
          : Net.online
            ? 'Node Household Server'
            : 'Browser Local Storage';
    }
    if (connDet) {
      connDet.textContent =
        Net.mode === 'firebase'
          ? `${Net.base} · AES-GCM-256 encrypted ledger`
          : Net.online
            ? `${Net.base} (${Net.storage || 'JSON'})`
            : 'Data stays encrypted-hashed in this browser. Export JSON backups regularly.';
    }
  }

  /* ============================================================
     MASTER RENDER & EVENT WIRING
     ============================================================ */
  function renderAll() {
    recomputeNextId();
    renderHeaderMeta();
    populateFilterDropdowns();
    const rows = filtered();
    const summary = computeFinancialSummary(S.profile, S.tx);
    const insights = generateAdvisorInsights(summary, S.profile, S.tx);

    renderOverview(rows);
    renderOverviewAnalysis(summary);
    renderFinancialProfile(summary);
    renderObligationsSection(summary);
    renderAdvisorSection(summary, insights);
    renderIncomeExpenses(rows);
    renderBudgetIntelligence(rows);
    renderSavingsGoals(rows);
    renderLoansLiabilities(rows);
    renderTransactionsTable(rows);
    renderReportsAnalytics(rows);
    renderComprehensiveReport(summary, insights);
    renderMembersSection();
    renderSettingsSection();
    document.dispatchEvent(new CustomEvent('hem:txchange'));
  }

  function wireEvents() {
    // Global Filter Bar
    const filterMap: Array<[string, keyof FilterState]> = [
      ['#fYear', 'year'],
      ['#fMonth', 'month'],
      ['#fMember', 'member'],
      ['#fType', 'type'],
      ['#fCategory', 'category'],
      ['#fPm', 'pm'],
      ['#fStatus', 'status']
    ];
    filterMap.forEach(([id, key]) => {
      $(id)?.addEventListener('change', e => {
        S.filters[key] = (e.target as HTMLSelectElement).value;
        S.tPage = 1;
        renderAll();
      });
    });

    $('#fReset')?.addEventListener('click', () => {
      S.filters = { year: 'ALL', month: 'ALL', member: 'ALL', type: 'ALL', category: 'ALL', pm: 'ALL', status: 'ALL' };
      S.tPage = 1;
      renderAll();
    });

    // Quick Add buttons
    $('#quickAddBtn')?.addEventListener('click', () => openTxDialog(null));
    $('#tAddBtn')?.addEventListener('click', () => openTxDialog(null));
    $('#txDialogClose')?.addEventListener('click', closeTxDialog);
    $('#mCancel')?.addEventListener('click', closeTxDialog);

    // Quick Transaction Modal submit
    $('#txDialogForm')?.addEventListener('submit', e => {
      e.preventDefault();
      if (!Perm.demand('edit')) return;
      const dlg = $('#txDialog') as HTMLDialogElement | null;
      const editingId = Number(dlg?.getAttribute('data-editing-id') || 0);
      const getVal = (id: string) => ($(id) as HTMLInputElement | HTMLSelectElement | null)?.value.trim() || '';

      const rec: Transaction = {
        id: editingId || Number(getVal('#mId')) || S.nextId,
        date: getVal('#mDate') || new Date().toISOString().slice(0, 10),
        member: getVal('#mMember').toUpperCase() || 'SYAM',
        type: getVal('#mType').toUpperCase() || 'EXPENSE',
        category: getVal('#mCat').toUpperCase() || 'EXPENSE',
        desc: getVal('#mDesc').toUpperCase() || 'TRANSACTION',
        pm: getVal('#mPm').toUpperCase() || 'UPI',
        budget: num(getVal('#mBudget')),
        spent: num(getVal('#mSpent')),
        status: getVal('#mStatus') || 'PAID',
        due: getVal('#mDue') || undefined,
        paidOn: getVal('#mPaidOn') || undefined
      };

      if (editingId) {
        const idx = S.tx.findIndex(x => x.id === editingId);
        if (idx >= 0) S.tx[idx] = rec;
        toast(`Updated record #${rec.id}`, 'ok');
      } else {
        if (S.tx.some(x => x.id === rec.id)) rec.id = S.nextId;
        S.tx.push(rec);
        toast(`Added record #${rec.id} (${rec.desc})`, 'ok');
      }
      closeTxDialog();
      recomputeNextId();
      persist();
      renderAll();
    });

    // Section 01 segmented toggles
    $$('#ovUnitSeg [data-unit]').forEach(btn => {
      btn.addEventListener('click', () => {
        S.unitMode = (btn.getAttribute('data-unit') || 'type') as AppState['unitMode'];
        $$('#ovUnitSeg [data-unit]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        renderUnitMatrix('ovUnitChart', 'ovUnitCap', filtered(), S.unitMode, () => openTxDialog(null));
      });
    });

    $$('#ovSparkSeg [data-spark]').forEach(btn => {
      btn.addEventListener('click', () => {
        S.ovSparkMode = (btn.getAttribute('data-spark') || 'all') as AppState['ovSparkMode'];
        $$('#ovSparkSeg [data-spark]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        renderCategorySparklines('ovSparkHost', 'ovSparkWindow', S.tx, S.filters, S.ovSparkMode, () => openTxDialog(null));
      });
    });

    // Section 02 My Financial Profile handlers
    $('#profImportBtn')?.addEventListener('click', () => {
      if (!Perm.demand('edit')) return;
      const derived = deriveProfileFromLedger(S.tx);
      const incNames = new Set(S.profile.incomes.map(i => i.name.toUpperCase()));
      const expNames = new Set(S.profile.expenses.map(e => e.name.toUpperCase()));
      const oblNames = new Set(S.profile.obligations.map(o => o.name.toUpperCase()));

      let added = 0;
      derived.incomes.forEach(i => {
        if (!incNames.has(i.name.toUpperCase())) {
          S.profile.incomes.push(i);
          added++;
        }
      });
      derived.expenses.forEach(e => {
        if (!expNames.has(e.name.toUpperCase())) {
          S.profile.expenses.push(e);
          added++;
        }
      });
      derived.obligations.forEach(o => {
        if (!oblNames.has(o.name.toUpperCase())) {
          S.profile.obligations.push(o);
          added++;
        }
      });
      if (added === 0) {
        toast('All ledger income, expense, and EMI streams are already imported.', '');
        return;
      }
      persistProfile();
      toast(`Imported ${added} streams from active ledger into Profile & Obligations`, 'ok');
    });

    const resetIncomeForm = () => {
      S.editIncomeId = null;
      ($('#profIncForm') as HTMLFormElement | null)?.reset();
      const d = $('#piPayDay') as HTMLInputElement | null;
      if (d) d.value = '1';
      renderAll();
    };
    $('#piCancel')?.addEventListener('click', resetIncomeForm);
    $('#profIncForm')?.addEventListener('submit', e => {
      e.preventDefault();
      if (!Perm.demand('edit')) return;
      const val = (id: string) => ($(id) as HTMLInputElement | HTMLSelectElement | null)?.value.trim() || '';
      const name = val('#piName');
      const amount = num(val('#piAmt'));
      if (!name || amount <= 0) {
        toast('Enter an income source name and positive ₹ amount', 'err');
        return;
      }
      const item = {
        id: S.editIncomeId || uid('inc'),
        name,
        kind: (val('#piKind') || 'monthly-salary') as IncomeKind,
        amount,
        frequency: (val('#piFreq') || 'monthly') as IncomeFrequency,
        payDay: Math.max(1, Math.min(31, Number(val('#piPayDay')) || 1)),
        member: val('#piMember').toUpperCase() || undefined,
        date: val('#piDate') || undefined,
        isEstimate: !!($('#piEst') as HTMLInputElement | null)?.checked
      };
      if (S.editIncomeId) {
        const idx = S.profile.incomes.findIndex(x => x.id === S.editIncomeId);
        if (idx >= 0) S.profile.incomes[idx] = item;
        toast(`Updated income source "${name}"`, 'ok');
      } else {
        S.profile.incomes.push(item);
        toast(`Added income source "${name}"`, 'ok');
      }
      S.editIncomeId = null;
      ($('#profIncForm') as HTMLFormElement | null)?.reset();
      const d = $('#piPayDay') as HTMLInputElement | null;
      if (d) d.value = '1';
      persistProfile();
    });

    const resetExpenseForm = () => {
      S.editExpenseId = null;
      ($('#profExpForm') as HTMLFormElement | null)?.reset();
      const d = $('#peDay') as HTMLInputElement | null;
      if (d) d.value = '5';
      const ess = $('#peEss') as HTMLInputElement | null;
      if (ess) ess.checked = true;
      renderAll();
    };
    $('#peCancel')?.addEventListener('click', resetExpenseForm);
    $('#profExpForm')?.addEventListener('submit', e => {
      e.preventDefault();
      if (!Perm.demand('edit')) return;
      const val = (id: string) => ($(id) as HTMLInputElement | HTMLSelectElement | null)?.value.trim() || '';
      const name = val('#peName');
      const amount = num(val('#peAmt'));
      if (!name || amount <= 0) {
        toast('Enter an expense name and positive ₹ amount', 'err');
        return;
      }
      const item = {
        id: S.editExpenseId || uid('exp'),
        name,
        category: (val('#peCat') || 'Other') as ExpenseCategoryKind,
        kind: (val('#peKind') === 'variable' ? 'variable' : 'fixed') as 'fixed' | 'variable',
        amount,
        frequency: (val('#peFreq') || 'monthly') as ExpenseFrequency,
        dueDay: Math.max(1, Math.min(31, Number(val('#peDay')) || 5)),
        essential: !!($('#peEss') as HTMLInputElement | null)?.checked
      };
      if (S.editExpenseId) {
        const idx = S.profile.expenses.findIndex(x => x.id === S.editExpenseId);
        if (idx >= 0) S.profile.expenses[idx] = item;
        toast(`Updated expense rule "${name}"`, 'ok');
      } else {
        S.profile.expenses.push(item);
        toast(`Added expense rule "${name}"`, 'ok');
      }
      S.editExpenseId = null;
      ($('#profExpForm') as HTMLFormElement | null)?.reset();
      const d = $('#peDay') as HTMLInputElement | null;
      if (d) d.value = '5';
      const ess = $('#peEss') as HTMLInputElement | null;
      if (ess) ess.checked = true;
      persistProfile();
    });

    $('#profAssetForm')?.addEventListener('submit', e => {
      e.preventDefault();
      if (!Perm.demand('edit')) return;
      const val = (id: string) => ($(id) as HTMLInputElement | HTMLSelectElement | null)?.value.trim() || '';
      const name = val('#paName');
      const value = num(val('#paVal'));
      if (!name || value < 0) {
        toast('Enter an asset name and value', 'err');
        return;
      }
      S.profile.assets.push({
        id: uid('ast'),
        name,
        kind: (val('#paKind') || 'Cash & Bank') as AssetKind,
        value
      });
      ($('#profAssetForm') as HTMLFormElement | null)?.reset();
      persistProfile();
      toast(`Added asset "${name}"`, 'ok');
    });

    $('#profLiabForm')?.addEventListener('submit', e => {
      e.preventDefault();
      if (!Perm.demand('edit')) return;
      const val = (id: string) => ($(id) as HTMLInputElement | HTMLSelectElement | null)?.value.trim() || '';
      const name = val('#plName');
      const balance = num(val('#plBal'));
      if (!name || balance <= 0) {
        toast('Enter a liability name and balance', 'err');
        return;
      }
      const rateRaw = val('#plRate');
      S.profile.liabilities.push({
        id: uid('lib'),
        name,
        kind: (val('#plKind') || 'Home Loan') as LiabilityKind,
        balance,
        interestRate: rateRaw ? num(rateRaw) : undefined
      });
      ($('#profLiabForm') as HTMLFormElement | null)?.reset();
      persistProfile();
      toast(`Added liability "${name}"`, 'ok');
    });

    // Section 03 Payments, Obligations & Tax handlers
    const resetObligForm = () => {
      S.editObligId = null;
      ($('#oblForm') as HTMLFormElement | null)?.reset();
      const dIn = $('#obDueDate') as HTMLInputElement | null;
      if (dIn) dIn.value = todayIsoLocal();
      renderAll();
    };
    $('#obCancel')?.addEventListener('click', resetObligForm);
    $('#oblForm')?.addEventListener('submit', e => {
      e.preventDefault();
      if (!Perm.demand('edit')) return;
      const val = (id: string) => ($(id) as HTMLInputElement | HTMLSelectElement | null)?.value.trim() || '';
      const name = val('#obName');
      const totalAmount = num(val('#obTotal'));
      const amountDue = val('#obDueAmt') === '' ? totalAmount : num(val('#obDueAmt'));
      if (!name || totalAmount < 0) {
        toast('Enter an obligation title and valid amount', 'err');
        return;
      }
      const remRaw = val('#obRemBal');
      const rateRaw = val('#obRate');
      const item: ObligationItem = {
        id: S.editObligId || uid('obl'),
        name,
        kind: (val('#obKind') || 'home-loan-emi') as ObligationKind,
        totalAmount,
        amountDue,
        dueDate: val('#obDueDate') || todayIsoLocal(),
        frequency: (val('#obFreq') || 'monthly') as ObligationItem['frequency'],
        remainingBalance: remRaw ? num(remRaw) : undefined,
        interestRate: rateRaw ? num(rateRaw) : undefined,
        status: (val('#obStatus') || 'Upcoming') as ObligationStatus,
        entrySource: (val('#obOrigin') || 'user-entered') as EntryOrigin
      };
      if (S.editObligId) {
        const idx = S.profile.obligations.findIndex(x => x.id === S.editObligId);
        if (idx >= 0) S.profile.obligations[idx] = item;
        toast(`Updated obligation "${name}"`, 'ok');
      } else {
        S.profile.obligations.push(item);
        toast(`Added obligation "${name}"`, 'ok');
      }
      S.editObligId = null;
      ($('#oblForm') as HTMLFormElement | null)?.reset();
      persistProfile();
    });

    $('#taxForm')?.addEventListener('submit', e => {
      e.preventDefault();
      if (!Perm.demand('edit')) return;
      const val = (id: string) => ($(id) as HTMLInputElement | HTMLSelectElement | null)?.value.trim() || '';
      const grossRaw = val('#txGross');
      S.profile.tax = {
        configured: true,
        regime: (val('#txRegime') === 'old' ? 'old' : 'new') as TaxRegime,
        assessmentYear: val('#txAY') || 'FY 2025-26 (AY 2026-27)',
        annualGrossIncome: grossRaw !== '' ? num(grossRaw) : null,
        deductions80C: num(val('#tx80C')),
        deductions80D: num(val('#tx80D')),
        hraExemption: num(val('#txHra')),
        otherExemptions: num(val('#txOtherEx')),
        tdsAlreadyDeducted: num(val('#txTds')),
        advanceTaxPaid: num(val('#txAdv')),
        gstApplicable: !!($('#txGstApp') as HTMLInputElement | null)?.checked,
        gstMonthlyEstimated: num(val('#txGstMo'))
      };
      persistProfile();
      toast(`Applied ${S.profile.tax.regime.toUpperCase()} tax regime estimate`, 'ok');
    });

    $('#taxResetBtn')?.addEventListener('click', () => {
      if (!Perm.demand('edit')) return;
      S.profile.tax.configured = false;
      persistProfile();
      toast('Tax estimator disabled (₹0 tax assumed)', 'ok');
    });

    // Section 04 AI Advisor filter
    $$('#advPrioSeg [data-aprio]').forEach(btn => {
      btn.addEventListener('click', () => {
        S.advPriority = (btn.getAttribute('data-aprio') || 'ALL') as AppState['advPriority'];
        $$('#advPrioSeg [data-aprio]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        const summary = computeFinancialSummary(S.profile, S.tx);
        const insights = generateAdvisorInsights(summary, S.profile, S.tx);
        renderAdvisorSection(summary, insights);
      });
    });

    // Section 02 composition toggle & Form
    $$('#ieCompSeg [data-comp]').forEach(btn => {
      btn.addEventListener('click', () => {
        S.compMode = (btn.getAttribute('data-comp') || 'outflow') as 'outflow' | 'pm';
        $$('#ieCompSeg [data-comp]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        renderCompositionStack('ieCompChart', 'ieCompCap', filtered(), S.compMode);
      });
    });

    $('#fDate')?.addEventListener('change', updateAutoYearMonth);
    $('#txClear')?.addEventListener('click', clearForm);
    $('#txCancel')?.addEventListener('click', clearForm);
    $('#txDelete')?.addEventListener('click', () => {
      if (S.editId !== null) deleteRecord(S.editId);
    });

    $('#txForm')?.addEventListener('submit', e => {
      e.preventDefault();
      if (!Perm.demand('edit')) return;
      const getVal = (id: string) => ($(id) as HTMLInputElement | HTMLSelectElement | null)?.value.trim() || '';
      const rawId = Number(getVal('#fId')) || S.nextId;
      const rec: Transaction = {
        id: S.editId !== null ? S.editId : rawId,
        date: getVal('#fDate') || new Date().toISOString().slice(0, 10),
        member: getVal('#fMemberIn').toUpperCase() || 'SYAM',
        type: getVal('#fTypeIn').toUpperCase() || 'EXPENSE',
        category: getVal('#fCatIn').toUpperCase() || 'EXPENSE',
        desc: getVal('#fDescIn').toUpperCase() || 'HOUSEHOLD ENTRY',
        pm: getVal('#fPmIn').toUpperCase() || 'UPI',
        budget: num(getVal('#fBudgetIn')),
        spent: num(getVal('#fSpentIn')),
        status: getVal('#fStatusIn') || 'PAID',
        due: getVal('#fDueIn') || undefined,
        paidOn: getVal('#fPaidOnIn') || undefined
      };

      if (S.editId !== null) {
        const idx = S.tx.findIndex(x => x.id === S.editId);
        if (idx >= 0) S.tx[idx] = rec;
        toast(`Saved changes to #${rec.id}`, 'ok');
      } else {
        if (S.tx.some(x => x.id === rec.id)) rec.id = S.nextId;
        S.tx.push(rec);
        toast(`Added transaction #${rec.id}`, 'ok');
      }
      clearForm();
      recomputeNextId();
      persist();
      renderAll();
    });

    // Find by ID
    $('#findIdBtn')?.addEventListener('click', () => {
      const idVal = Number(($('#findIdInput') as HTMLInputElement | null)?.value || 0);
      const resHost = $('#findIdResult');
      if (!resHost) return;
      const found = S.tx.find(r => r.id === idVal);
      if (!found) {
        resHost.innerHTML = `<p class="mono-meta">No record found with ID #${idVal}.</p>`;
        return;
      }
      resHost.innerHTML = '';
      const loadBtn = el('button', { type: 'button', class: 'btn sm', text: 'Load into editor' });
      loadBtn.addEventListener('click', () => loadIntoForm(found));
      resHost.appendChild(
        el('div', { class: 'feed-row' }, [
          el('div', { class: 'feed-main' }, [
            el('div', { class: 'feed-title', text: `#${found.id} · ${found.desc} (${found.type})` }),
            el('div', { class: 'mono-meta', text: `${found.date} · ${found.member} · Budget ${money(found.budget)} · Actual ${money(found.spent)} · ${found.status}` })
          ]),
          Perm.can('edit') ? loadBtn : null
        ])
      );
    });

    // Section 03 controls
    $$('#bProgFilterSeg [data-bprog]').forEach(btn => {
      btn.addEventListener('click', () => {
        S.bProgFilter = (btn.getAttribute('data-bprog') || 'all') as AppState['bProgFilter'];
        $$('#bProgFilterSeg [data-bprog]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        renderBudgetProgressCards('bProgCardsHost', filtered(), S.bProgFilter, S.dumbSort);
      });
    });

    $$('#bDumbSeg [data-dumb]').forEach(btn => {
      btn.addEventListener('click', () => {
        S.dumbSort = (btn.getAttribute('data-dumb') || 'spent') as AppState['dumbSort'];
        $$('#bDumbSeg [data-dumb]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        const rows = filtered();
        renderBudgetDumbbell('bDumbChart', 'bDumbCap', rows, S.dumbSort);
        renderBudgetProgressCards('bProgCardsHost', rows, S.bProgFilter, S.dumbSort);
      });
    });

    $('#bRotMemberSel')?.addEventListener('change', e => {
      S.rotMember = (e.target as HTMLSelectElement).value;
      const rows = filtered();
      renderRotatedKpiBars('bRotChart', 'bRotCap', rows, S.rotMember);
      renderMemberInlineProgress(rows);
    });

    $$('#hmAxisSeg [data-hma]').forEach(btn => {
      btn.addEventListener('click', () => {
        S.hmAxis = (btn.getAttribute('data-hma') || 'member') as 'member' | 'month';
        $$('#hmAxisSeg [data-hma]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        renderSpendingHeatmap('hmHost', 'hmCap', 'hmLiveCount', filtered(), S.hmAxis, S.hmThresh);
      });
    });

    $('#hmThreshRange')?.addEventListener('input', e => {
      S.hmThresh = Number((e.target as HTMLInputElement).value || 0);
      const read = $('#hmThreshRead');
      if (read) read.textContent = `${S.hmThresh}%`;
      renderSpendingHeatmap('hmHost', 'hmCap', 'hmLiveCount', filtered(), S.hmAxis, S.hmThresh);
    });

    // Section 04 controls
    $('#svMemberSel')?.addEventListener('change', e => {
      S.svMember = (e.target as HTMLSelectElement).value;
      renderWaffleAllocation('svWaffleHost', 'svStatHost', 'svWaffleCap', filtered(), S.svMember);
    });

    // Section 06 Transactions Table & Exports
    $('#tSearch')?.addEventListener('input', e => {
      S.tSearch = (e.target as HTMLInputElement).value;
      S.tPage = 1;
      renderTransactionsTable(filtered());
    });

    $$('#tStatusChips [data-tstatus]').forEach(btn => {
      btn.addEventListener('click', () => {
        S.tStatusFilter = (btn.getAttribute('data-tstatus') || 'ALL') as AppState['tStatusFilter'];
        $$('#tStatusChips [data-tstatus]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        S.tPage = 1;
        renderTransactionsTable(filtered());
      });
    });

    $('#tSize')?.addEventListener('change', e => {
      S.tSize = Number((e.target as HTMLSelectElement).value || 20);
      S.tPage = 1;
      renderTransactionsTable(filtered());
    });

    $('#tPrev')?.addEventListener('click', () => {
      if (S.tPage > 1) {
        S.tPage--;
        renderTransactionsTable(filtered());
      }
    });

    $('#tNext')?.addEventListener('click', () => {
      S.tPage++;
      renderTransactionsTable(filtered());
    });

    $('#tExpCsv')?.addEventListener('click', () => {
      const rows = filtered();
      const mat: Array<Array<string | number>> = [
        ['ID', 'DATE', 'YEAR', 'MONTH', 'MEMBER', 'TYPE', 'CATEGORY', 'DESCRIPTION', 'PAYMENT METHOD', 'BUDGET', 'ACTUALLY SPENT', 'STATUS', 'DUE DATE', 'PAID DATE'],
        ...rows.map(r => [r.id, r.date, yearOf(r), monthOf(r), r.member, r.type, r.category, r.desc, r.pm, r.budget, r.spent, r.status, r.due || '', r.paidOn || ''])
      ];
      download(`hem-transactions-${new Date().toISOString().slice(0, 10)}.csv`, new Blob(['\ufeff' + toCsv(mat)], { type: 'text/csv;charset=utf-8' }));
      toast('Exported CSV ledger', 'ok');
    });

    $('#tExpXlsx')?.addEventListener('click', () => {
      const rows = filtered();
      const sheetRows = rows.map(r => ({
        ID: r.id,
        Date: r.date,
        Year: yearOf(r),
        Month: monthOf(r),
        Member: r.member,
        Type: r.type,
        Category: r.category,
        Description: r.desc,
        'Payment Method': r.pm,
        Budget: r.budget,
        'Actually Spent': r.spent,
        Status: r.status,
        'Due Date': r.due || '',
        'Paid Date': r.paidOn || ''
      }));
      const ws = XLSX.utils.json_to_sheet(sheetRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
      XLSX.writeFile(wb, `hem-transactions-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast('Exported Excel workbook (.xlsx)', 'ok');
    });

    // Section 07 Scrollytelling & Scatter & Reports
    $$('#scrollySteps .scrolly-step').forEach(step => {
      const activate = () => {
        S.scrollyStep = Number(step.getAttribute('data-step') || 0);
        $$('#scrollySteps .scrolly-step').forEach(s => s.classList.toggle('is-active', s === step));
        renderReportsAnalytics(filtered());
      };
      step.addEventListener('click', activate);
      step.addEventListener('keydown', e => {
        if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
          e.preventDefault();
          activate();
        }
      });
    });

    $$('#scrollyModeSeg [data-smode]').forEach(btn => {
      btn.addEventListener('click', () => {
        S.scrollyMode = (btn.getAttribute('data-smode') || 'abs') as 'abs' | 'share';
        $$('#scrollyModeSeg [data-smode]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        renderReportsAnalytics(filtered());
      });
    });

    $('#scMinBudget')?.addEventListener('input', e => {
      S.scatterMinBudget = Number((e.target as HTMLInputElement).value || 0);
      const rEl = $('#scMinBudgetRead');
      if (rEl) rEl.textContent = money(S.scatterMinBudget);
      renderReportsAnalytics(filtered());
    });

    $('#scTrendToggle')?.addEventListener('change', e => {
      S.scatterTrend = !!(e.target as HTMLInputElement).checked;
      renderReportsAnalytics(filtered());
    });

    $('#repEntitySel')?.addEventListener('change', e => {
      S.reportEntity = (e.target as HTMLSelectElement).value;
      renderReportsAnalytics(filtered());
    });

    $('#repExpCsv')?.addEventListener('click', () => {
      const mat = buildReportMatrix(filtered());
      const csvRows: Array<Array<string | number>> = [mat.cols.map(c => c.label), ...mat.body];
      download(`hem-report-${S.reportId}-${new Date().toISOString().slice(0, 10)}.csv`, new Blob(['\ufeff' + toCsv(csvRows)], { type: 'text/csv;charset=utf-8' }));
      toast(`Exported ${S.reportId} report CSV`, 'ok');
    });

    // Custom Date Range Personal Finance Report (PDF & Excel)
    $('#repFromDate')?.addEventListener('change', e => {
      S.repFromDate = (e.target as HTMLInputElement).value;
      const summary = computeFinancialSummary(S.profile, S.tx);
      const insights = generateAdvisorInsights(summary, S.profile, S.tx);
      renderComprehensiveReport(summary, insights);
    });
    $('#repToDate')?.addEventListener('change', e => {
      S.repToDate = (e.target as HTMLInputElement).value;
      const summary = computeFinancialSummary(S.profile, S.tx);
      const insights = generateAdvisorInsights(summary, S.profile, S.tx);
      renderComprehensiveReport(summary, insights);
    });
    $$('#repPresetSeg [data-rpreset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = (btn.getAttribute('data-rpreset') || 'all') as AppState['repPreset'];
        applyReportPreset(p);
        $$('#repPresetSeg [data-rpreset]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        const summary = computeFinancialSummary(S.profile, S.tx);
        const insights = generateAdvisorInsights(summary, S.profile, S.tx);
        renderComprehensiveReport(summary, insights);
      });
    });
    $('#repExpPdf')?.addEventListener('click', () => {
      const summary = computeFinancialSummary(S.profile, S.tx);
      const insights = generateAdvisorInsights(summary, S.profile, S.tx);
      const rep = getActiveReportData(summary, insights);
      exportFinancialReportPdf(rep);
      toast('Downloaded comprehensive PDF financial report', 'ok');
    });
    $('#repExpXlsx')?.addEventListener('click', () => {
      const summary = computeFinancialSummary(S.profile, S.tx);
      const insights = generateAdvisorInsights(summary, S.profile, S.tx);
      const rep = getActiveReportData(summary, insights);
      exportFinancialReportExcel(rep);
      toast('Downloaded 6-sheet Excel financial report (.xlsx)', 'ok');
    });

    // Section 08 Members Invite & Password
    $('#invBtn')?.addEventListener('click', async () => {
      if (!Perm.demand('manage')) return;
      const email = ($('#invEmail') as HTMLInputElement | null)?.value.trim() || '';
      const role = (($('#invRole') as HTMLSelectElement | null)?.value || 'editor') as Role;
      if (!email || !email.includes('@')) {
        toast('Enter a valid email to invite', 'err');
        return;
      }
      try {
        const res = await Backend.addMember(email, role);
        SessionContext.members = res.members;
        const emailIn = $('#invEmail') as HTMLInputElement | null;
        if (emailIn) emailIn.value = '';
        const box = $('#invCodeBox');
        const val = $('#invCodeVal');
        if (res.code && box && val) {
          val.textContent = res.code;
          box.hidden = false;
        }
        renderMembersSection();
        toast(`Invited ${email} as ${ROLES[role].name}`, 'ok');
      } catch (err: any) {
        toast(err?.message || 'Invite failed', 'err');
      }
    });

    $('#invCodeCopy')?.addEventListener('click', () => {
      const code = $('#invCodeVal')?.textContent || '';
      if (code) navigator.clipboard?.writeText(code).then(() => toast('Join code copied', 'ok'));
    });

    $('#pwForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const oldPw = ($('#pwOld') as HTMLInputElement | null)?.value || '';
      const newPw = ($('#pwNew') as HTMLInputElement | null)?.value || '';
      const newPw2 = ($('#pwNew2') as HTMLInputElement | null)?.value || '';
      if (newPw.length < 6) {
        toast('New password must be at least 6 characters', 'err');
        return;
      }
      if (newPw !== newPw2) {
        toast('New passwords do not match', 'err');
        return;
      }
      try {
        await Backend.changePassword(oldPw, newPw);
        ($('#pwForm') as HTMLFormElement | null)?.reset();
        toast('Password updated successfully', 'ok');
      } catch (err: any) {
        toast(err?.message || 'Could not update password', 'err');
      }
    });

    // Section 09 Data Management (Import, Backup, Reset)
    $$('#impModeSeg [data-impmode]').forEach(btn => {
      btn.addEventListener('click', () => {
        S.importMode = (btn.getAttribute('data-impmode') || 'merge') as 'merge' | 'replace';
        $$('#impModeSeg [data-impmode]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      });
    });

    const impDrop = $('#impDrop');
    const impFile = $('#impFile') as HTMLInputElement | null;
    $('#impPickBtn')?.addEventListener('click', () => impFile?.click());
    impFile?.addEventListener('change', () => {
      if (impFile.files && impFile.files[0]) handleImportFile(impFile.files[0]);
      impFile.value = '';
    });
    impDrop?.addEventListener('dragover', e => {
      e.preventDefault();
      impDrop.classList.add('is-drag');
    });
    impDrop?.addEventListener('dragleave', () => impDrop.classList.remove('is-drag'));
    impDrop?.addEventListener('drop', e => {
      e.preventDefault();
      impDrop.classList.remove('is-drag');
      const file = (e as DragEvent).dataTransfer?.files?.[0];
      if (file) handleImportFile(file);
    });

    $('#bakExportJson')?.addEventListener('click', () => {
      const payload = {
        app: 'H ∈ M Household Expense Manager',
        exportedAt: new Date().toISOString(),
        household: SessionContext.house,
        transactions: S.tx,
        profile: S.profile
      };
      download(`hem-backup-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      toast('Downloaded JSON backup (Ledger + Profile)', 'ok');
    });

    const bakFile = $('#bakImportFile') as HTMLInputElement | null;
    $('#bakImportJsonBtn')?.addEventListener('click', () => {
      if (Perm.demand('import')) bakFile?.click();
    });
    bakFile?.addEventListener('change', async () => {
      const file = bakFile.files?.[0];
      bakFile.value = '';
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const rows = Array.isArray(parsed) ? parsed : parsed?.transactions;
        if (!Array.isArray(rows)) throw new Error('Invalid backup JSON format');
        const ok = await askConfirm('Restore JSON backup?', `Replace current ledger with ${rows.length} records from backup?`, 'Restore backup');
        if (!ok) return;
        S.tx = rows;
        if (parsed && !Array.isArray(parsed) && parsed.profile) {
          S.profile = normalizeProfile(parsed.profile);
          saveProfile(SessionContext.hid, S.profile);
        }
        S.repFromDate = '';
        S.repToDate = '';
        recomputeNextId();
        persist();
        renderAll();
        toast(`Restored ${rows.length} records`, 'ok');
      } catch (err: any) {
        toast(err?.message || 'Backup restore failed', 'err');
      }
    });

    // Double-confirm Reset All Data
    $('#bakResetBtn')?.addEventListener('click', () => {
      if (!Perm.demand('manage')) return;
      const row = $('#bakResetConfirmRow');
      if (row) row.hidden = false;
    });
    $('#bakResetCancelBtn')?.addEventListener('click', () => {
      const row = $('#bakResetConfirmRow');
      if (row) row.hidden = true;
    });
    $('#bakResetConfirmBtn')?.addEventListener('click', () => {
      if (!Perm.demand('manage')) return;
      S.tx = SEED.slice();
      S.repFromDate = '';
      S.repToDate = '';
      recomputeNextId();
      persist();
      renderAll();
      const row = $('#bakResetConfirmRow');
      if (row) row.hidden = true;
      toast('Ledger reset to default household template (49 entries)', 'ok');
    });

    // Section 10 Settings
    $('#srvSaveBtn')?.addEventListener('click', async () => {
      const val = ($('#srvUrl') as HTMLInputElement | null)?.value.trim() || '';
      Net.setBase(val);
      const ok = await Net.detect();
      renderSettingsSection();
      renderHeaderMeta();
      toast(ok ? `Connected to ${Net.base}` : 'Saved URL; server not reachable right now', ok ? 'ok' : 'err');
    });

    $('#srvTestBtn')?.addEventListener('click', async () => {
      const ok = await Net.detect();
      renderSettingsSection();
      renderHeaderMeta();
      toast(ok ? `Connected (${Net.mode})` : 'No remote server detected; local mode active', ok ? 'ok' : '');
    });

    $('#signOutBtn')?.addEventListener('click', onSignOut);

    // Theme changes require chart re-render to ensure smooth CSS variable updates
    document.addEventListener('hem:themechange', () => {
      renderAll();
    });
  }

  return { renderAll, openTxDialog, closeTxDialog, markPaid, markObligationPaid, syncFormState, wireEvents };
}
