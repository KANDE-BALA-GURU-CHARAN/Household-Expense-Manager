import { MONTH_NAMES } from './constants';
import { uid } from './profileStore';
import type {
  AdvisorRecommendation,
  ExpenseCategoryKind,
  ExpenseFrequency,
  FinancialProfile,
  FinancialSummary,
  IncomeFrequency,
  IncomeSource,
  LoanStrategyResult,
  MonthlyProjection,
  ObligationItem,
  ObligationKind,
  RecurringExpense,
  TaxBreakdown,
  TaxSettings,
  Transaction
} from './types';
import { isDue, money, num, totals } from './utils';

/* ============================================================
   FREQUENCY NORMALIZATION
   ============================================================ */
export function incomeToMonthly(amount: number, freq: IncomeFrequency): number {
  const a = Math.max(0, num(amount));
  switch (freq) {
    case 'monthly':
      return a;
    case 'quarterly':
      return a / 3;
    case 'annual':
      return a / 12;
    case 'one-time':
      return 0;
  }
}

export function incomeToAnnual(amount: number, freq: IncomeFrequency): number {
  const a = Math.max(0, num(amount));
  switch (freq) {
    case 'monthly':
      return a * 12;
    case 'quarterly':
      return a * 4;
    case 'annual':
      return a;
    case 'one-time':
      return a;
  }
}

export function expenseToMonthly(amount: number, freq: ExpenseFrequency): number {
  const a = Math.max(0, num(amount));
  switch (freq) {
    case 'daily':
      return a * 30;
    case 'weekly':
      return (a * 52) / 12;
    case 'monthly':
      return a;
    case 'quarterly':
      return a / 3;
    case 'yearly':
      return a / 12;
  }
}

export function expenseToAnnual(amount: number, freq: ExpenseFrequency): number {
  const a = Math.max(0, num(amount));
  switch (freq) {
    case 'daily':
      return a * 365;
    case 'weekly':
      return a * 52;
    case 'monthly':
      return a * 12;
    case 'quarterly':
      return a * 4;
    case 'yearly':
      return a;
  }
}

export function obligationToMonthly(amount: number, freq: ObligationItem['frequency']): number {
  const a = Math.max(0, num(amount));
  switch (freq) {
    case 'monthly':
      return a;
    case 'quarterly':
      return a / 3;
    case 'yearly':
      return a / 12;
    case 'one-time':
      return 0;
  }
}

export function isLoanObligation(kind: ObligationKind): boolean {
  return (
    kind === 'home-loan-emi' ||
    kind === 'personal-loan-emi' ||
    kind === 'vehicle-loan-emi' ||
    kind === 'education-loan-emi' ||
    kind === 'other-liability'
  );
}

export function isTaxObligation(kind: ObligationKind): boolean {
  return kind === 'income-tax' || kind === 'advance-tax' || kind === 'tds' || kind === 'gst';
}

/* ============================================================
   ALERT STATE CLASSIFICATION (OVERDUE / DUE TODAY / UPCOMING)
   ============================================================ */
export function todayIsoLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getAlertState(
  dueDate: string | undefined,
  status: string,
  refTodayIso = todayIsoLocal()
): 'overdue' | 'due-today' | 'upcoming' | 'paid' {
  const normStatus = String(status || '').trim().toLowerCase();
  if (normStatus === 'paid' || normStatus === 'not necessary') return 'paid';
  if (normStatus === 'overdue') return 'overdue';
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return 'upcoming';
  if (dueDate < refTodayIso) return 'overdue';
  if (dueDate === refTodayIso) return 'due-today';
  return 'upcoming';
}

/* ============================================================
   CONDITIONAL INDIAN TAX ESTIMATOR (FY 2025-26)
   Never assumes liability when tax.configured === false
   ============================================================ */
function slabTaxNewRegime(taxable: number): number {
  if (taxable <= 400000) return 0;
  const brackets: Array<[number, number, number]> = [
    [400000, 800000, 0.05],
    [800000, 1200000, 0.1],
    [1200000, 1600000, 0.15],
    [1600000, 2000000, 0.2],
    [2000000, 2400000, 0.25],
    [2400000, Number.POSITIVE_INFINITY, 0.3]
  ];
  let tax = 0;
  for (const [lo, hi, rate] of brackets) {
    if (taxable > lo) {
      tax += (Math.min(taxable, hi) - lo) * rate;
    }
  }
  // Sec 87A rebate up to Rs 12L taxable income in FY 2025-26 + marginal relief
  if (taxable <= 1200000) return 0;
  if (taxable <= 1275000) {
    tax = Math.min(tax, taxable - 1200000);
  }
  return Math.max(0, tax);
}

function slabTaxOldRegime(taxable: number): number {
  if (taxable <= 500000) return 0;
  let tax = 0;
  if (taxable > 250000) tax += (Math.min(taxable, 500000) - 250000) * 0.05;
  if (taxable > 500000) tax += (Math.min(taxable, 1000000) - 500000) * 0.2;
  if (taxable > 1000000) tax += (taxable - 1000000) * 0.3;
  return Math.max(0, tax);
}

export function estimateIndianTax(tax: TaxSettings, fallbackAnnualGross: number): TaxBreakdown {
  if (!tax.configured) {
    return {
      configured: false,
      regime: tax.regime,
      grossIncome: 0,
      standardDeduction: 0,
      eligibleDeductions: 0,
      taxableIncome: 0,
      slabTax: 0,
      cess: 0,
      totalIncomeTax: 0,
      annualGst: 0,
      totalTaxLiability: 0,
      alreadyPaidTdsAdvance: 0,
      remainingTaxPayable: 0,
      monthlyTaxReserve: 0,
      effectiveRatePct: 0,
      methodologyNote:
        'Tax details not configured yet. Select a regime and enter deductions in 03 Payments & Obligations to compute tax.'
    };
  }

  const grossIncome =
    tax.annualGrossIncome !== null && tax.annualGrossIncome >= 0
      ? num(tax.annualGrossIncome)
      : Math.max(0, fallbackAnnualGross);

  const isNew = tax.regime === 'new';
  const standardDeduction = grossIncome > 0 ? (isNew ? 75000 : 50000) : 0;
  const eligibleDeductions = isNew
    ? 0
    : Math.min(150000, Math.max(0, num(tax.deductions80C))) +
      Math.max(0, num(tax.deductions80D)) +
      Math.max(0, num(tax.hraExemption)) +
      Math.max(0, num(tax.otherExemptions));

  const taxableIncome = Math.max(0, grossIncome - standardDeduction - eligibleDeductions);
  const slabTax = isNew ? slabTaxNewRegime(taxableIncome) : slabTaxOldRegime(taxableIncome);
  const cess = slabTax * 0.04;
  const totalIncomeTax = Math.round(slabTax + cess);
  const annualGst = tax.gstApplicable ? Math.round(Math.max(0, num(tax.gstMonthlyEstimated)) * 12) : 0;
  const totalTaxLiability = totalIncomeTax + annualGst;
  const alreadyPaidTdsAdvance = Math.max(0, num(tax.tdsAlreadyDeducted)) + Math.max(0, num(tax.advanceTaxPaid));
  const remainingTaxPayable = Math.max(0, totalTaxLiability - alreadyPaidTdsAdvance);
  const monthlyTaxReserve = Math.round(remainingTaxPayable / 12);
  const effectiveRatePct = grossIncome > 0 ? (totalIncomeTax / grossIncome) * 100 : 0;

  return {
    configured: true,
    regime: tax.regime,
    grossIncome,
    standardDeduction,
    eligibleDeductions,
    taxableIncome,
    slabTax: Math.round(slabTax),
    cess: Math.round(cess),
    totalIncomeTax,
    annualGst,
    totalTaxLiability,
    alreadyPaidTdsAdvance,
    remainingTaxPayable,
    monthlyTaxReserve,
    effectiveRatePct,
    methodologyNote: `${isNew ? 'New' : 'Old'} Regime (${tax.assessmentYear}): Gross ${money(grossIncome)} − Std Ded ${money(standardDeduction)}${!isNew ? ` − Deductions ${money(eligibleDeductions)}` : ''} = Taxable ${money(taxableIncome)} + 4% Cess${annualGst > 0 ? ` + Annual GST ${money(annualGst)}` : ''}.`
  };
}

/* ============================================================
   COMPREHENSIVE FINANCIAL SUMMARY + 12-MONTH PROJECTIONS
   ============================================================ */
function countDistinctMonths(rows: Transaction[]): number {
  const set = new Set<string>();
  rows.forEach(r => {
    const ym = (r.date || '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(ym)) set.add(ym);
  });
  return Math.max(1, set.size);
}

function isRoutineCategory(cat: string, desc: string): boolean {
  const s = `${cat} ${desc}`.toUpperCase();
  if (s.includes('OCCASIONAL') || s.includes('SHOPPING') || s.includes('FESTIVAL') || s.includes('TOUR')) {
    return false;
  }
  return true;
}

function isEssentialCategory(cat: string, desc: string): boolean {
  const s = `${cat} ${desc}`.toUpperCase();
  const nonEss = ['SHOPPING', 'TOUR', 'ENTERTAINMENT', 'FLOWERS', 'SUBSCRIPTION', 'ONLINE'];
  return !nonEss.some(k => s.includes(k));
}

export function computeFinancialSummary(
  profile: FinancialProfile,
  txRows: Transaction[]
): FinancialSummary {
  const lt = totals(txRows);
  const activeMonths = countDistinctMonths(txRows);

  const profileIncomeConfigured = profile.incomes.length > 0;
  const profileExpenseConfigured = profile.expenses.length > 0;

  // 1. Income (Profile authoritative if entered; otherwise actual monthly ledger average)
  let monthlyIncome = 0;
  let annualIncome = 0;
  let confirmedMonthlyIncome = 0;
  let estimatedMonthlyIncome = 0;

  if (profileIncomeConfigured) {
    profile.incomes.forEach(inc => {
      const mAmt = incomeToMonthly(inc.amount, inc.frequency);
      const aAmt = incomeToAnnual(inc.amount, inc.frequency);
      monthlyIncome += mAmt;
      annualIncome += aAmt;
      if (inc.isEstimate) estimatedMonthlyIncome += mAmt;
      else confirmedMonthlyIncome += mAmt;
    });
  } else {
    monthlyIncome = lt.income / activeMonths;
    annualIncome = monthlyIncome * 12;
    confirmedMonthlyIncome = monthlyIncome;
  }

  // 2. Expenses (Fixed vs Variable)
  let fixedMonthlyExpenses = 0;
  let variableMonthlyExpenses = 0;
  let essentialMonthlyExpenses = 0;
  let annualExpenses = 0;

  if (profileExpenseConfigured) {
    profile.expenses.forEach(exp => {
      const mAmt = expenseToMonthly(exp.amount, exp.frequency);
      const aAmt = expenseToAnnual(exp.amount, exp.frequency);
      annualExpenses += aAmt;
      if (exp.kind === 'fixed') fixedMonthlyExpenses += mAmt;
      else variableMonthlyExpenses += mAmt;
      if (exp.essential) essentialMonthlyExpenses += mAmt;
    });
  } else {
    const expRows = txRows.filter(r => r.type.toUpperCase() === 'EXPENSE');
    expRows.forEach(r => {
      const amt = (num(r.spent) || num(r.budget)) / activeMonths;
      if (isRoutineCategory(r.category, r.desc)) fixedMonthlyExpenses += amt;
      else variableMonthlyExpenses += amt;
      if (isEssentialCategory(r.category, r.desc)) essentialMonthlyExpenses += amt;
    });
    annualExpenses = (fixedMonthlyExpenses + variableMonthlyExpenses) * 12;
  }
  const totalMonthlyExpenses = fixedMonthlyExpenses + variableMonthlyExpenses;

  // 3. EMIs & Loan Payments
  const loanObls = profile.obligations.filter(o => isLoanObligation(o.kind));
  let monthlyEmiPayments = 0;
  let annualEmiPayments = 0;
  if (loanObls.length > 0) {
    loanObls.forEach(o => {
      const mAmt = obligationToMonthly(o.totalAmount, o.frequency);
      monthlyEmiPayments += mAmt;
      annualEmiPayments +=
        o.frequency === 'monthly'
          ? o.totalAmount * 12
          : o.frequency === 'quarterly'
            ? o.totalAmount * 4
            : o.totalAmount;
    });
  } else {
    monthlyEmiPayments = lt.loan / activeMonths;
    annualEmiPayments = monthlyEmiPayments * 12;
  }

  // Non-loan recurring obligations (insurance / credit card monthly normalized)
  const nonLoanObls = profile.obligations.filter(o => !isLoanObligation(o.kind) && !isTaxObligation(o.kind));
  const nonLoanMonthlyObls = nonLoanObls.reduce((s, o) => s + obligationToMonthly(o.amountDue || o.totalAmount, o.frequency), 0);

  // 4. Upcoming & Overdue payment obligations
  const today = todayIsoLocal();
  let upcomingObligationsAmount = 0;
  let overdueObligationsAmount = 0;
  let upcomingObligationsCount = 0;
  let overdueObligationsCount = 0;
  let dueTodayCount = 0;

  profile.obligations.forEach(o => {
    const st = getAlertState(o.dueDate, o.status, today);
    const dueVal = Math.max(0, num(o.amountDue));
    if (st === 'overdue') {
      overdueObligationsCount++;
      overdueObligationsAmount += dueVal;
    } else if (st === 'due-today') {
      dueTodayCount++;
      upcomingObligationsCount++;
      upcomingObligationsAmount += dueVal;
    } else if (st === 'upcoming') {
      upcomingObligationsCount++;
      upcomingObligationsAmount += dueVal;
    }
  });

  // Include ledger TO BE PAID bills only if obligations register hasn't captured any items
  if (profile.obligations.length === 0) {
    txRows.filter(isDue).forEach(r => {
      const st = getAlertState(r.due || r.date, r.status, today);
      const amt = Math.max(0, num(r.budget));
      if (st === 'overdue') {
        overdueObligationsCount++;
        overdueObligationsAmount += amt;
      } else {
        if (st === 'due-today') dueTodayCount++;
        upcomingObligationsCount++;
        upcomingObligationsAmount += amt;
      }
    });
  }

  // 5. Tax Estimator (strictly conditional on tax.configured)
  const tax = estimateIndianTax(profile.tax, annualIncome);
  const monthlyTaxReserve = tax.configured ? tax.monthlyTaxReserve : 0;

  // 6. Savings, Disposable Income, Cash Flow, Ratios
  const monthlySavingsActual = lt.saving / activeMonths;
  const disposableIncomeMonthly =
    monthlyIncome - fixedMonthlyExpenses - monthlyEmiPayments - monthlyTaxReserve;
  const monthlyCashFlow =
    monthlyIncome -
    totalMonthlyExpenses -
    monthlyEmiPayments -
    monthlyTaxReserve -
    monthlySavingsActual -
    nonLoanMonthlyObls;

  const dtiPct = monthlyIncome > 0 ? (monthlyEmiPayments / monthlyIncome) * 100 : 0;
  const savingsRatePct = monthlyIncome > 0 ? (monthlySavingsActual / monthlyIncome) * 100 : 0;

  // 7. Assets, Liabilities & Net Worth (explicitly computed only when provided)
  const totalAssets = profile.assets.reduce((s, a) => s + Math.max(0, num(a.value)), 0);
  const liquidAssets = profile.assets
    .filter(a => a.kind === 'Cash & Bank' || a.kind === 'Mutual Funds & Equity' || a.kind === 'Fixed Deposits & RD')
    .reduce((s, a) => s + Math.max(0, num(a.value)), 0);

  const explicitLiabilities = profile.liabilities.reduce((s, l) => s + Math.max(0, num(l.balance)), 0);
  const oblgLiabilities = profile.obligations.reduce((s, o) => s + Math.max(0, num(o.remainingBalance)), 0);
  const totalLiabilities = profile.liabilities.length > 0 ? explicitLiabilities : oblgLiabilities;
  const hasAssetsOrLiabilities = profile.assets.length > 0 || totalLiabilities > 0;
  const netWorth = hasAssetsOrLiabilities ? totalAssets - totalLiabilities : null;

  // 8. 12-Month Projections honoring exact billing schedules
  const projections = build12MonthProjections(profile, txRows, {
    monthlyIncomeFallback: profileIncomeConfigured ? 0 : lt.income / activeMonths,
    fixedFallback: profileExpenseConfigured ? 0 : fixedMonthlyExpenses,
    variableFallback: profileExpenseConfigured ? 0 : variableMonthlyExpenses,
    emiFallback: loanObls.length > 0 ? 0 : monthlyEmiPayments,
    taxMonthlyReserve: monthlyTaxReserve
  });

  const methodologyNotes: string[] = [
    profileIncomeConfigured
      ? `Income normalized from ${profile.incomes.length} Financial Profile source(s) (monthly×1, quarterly÷3, annual÷12; one-time counted in annual total only).`
      : `Income derived from ${activeMonths} active ledger month(s) (${money(lt.income)} actual) because no recurring Income Sources are added in 02 Profile yet.`,
    profileExpenseConfigured
      ? `Expenses split across ${profile.expenses.length} Profile rule(s) (daily×30, weekly×52÷12, monthly×1, quarterly÷3, yearly÷12).`
      : `Expenses grouped from ledger EXPENSE entries (${money(lt.expense)} across ${activeMonths} mo) without double-counting.`,
    loanObls.length > 0
      ? `EMIs calculated from ${loanObls.length} loan obligation(s) in 03 Payments & Obligations.`
      : `EMIs reflect ${money(lt.loan)} recorded in ledger LOAN rows.`,
    tax.configured
      ? tax.methodologyNote
      : 'Tax liability is NOT assumed (₹0 reserved) until you configure your Tax Regime & Deductions in 03 Payments & Obligations.'
  ];

  return {
    monthlyIncome,
    annualIncome,
    confirmedMonthlyIncome,
    estimatedMonthlyIncome,
    fixedMonthlyExpenses,
    variableMonthlyExpenses,
    essentialMonthlyExpenses,
    totalMonthlyExpenses,
    annualExpenses,
    monthlyEmiPayments,
    annualEmiPayments,
    upcomingObligationsAmount,
    overdueObligationsAmount,
    upcomingObligationsCount,
    overdueObligationsCount,
    dueTodayCount,
    monthlySavingsActual,
    disposableIncomeMonthly,
    monthlyCashFlow,
    dtiPct,
    savingsRatePct,
    totalAssets,
    totalLiabilities,
    netWorth,
    hasAssetsOrLiabilities,
    liquidAssets,
    tax,
    ledgerActualIncome: lt.income,
    ledgerActualOutflow: lt.outflow,
    ledgerActualExpense: lt.expense,
    ledgerActualLoan: lt.loan,
    ledgerActualSaving: lt.saving,
    profileIncomeConfigured,
    profileExpenseConfigured,
    projections,
    methodologyNotes
  };
}

function build12MonthProjections(
  profile: FinancialProfile,
  _txRows: Transaction[],
  fb: {
    monthlyIncomeFallback: number;
    fixedFallback: number;
    variableFallback: number;
    emiFallback: number;
    taxMonthlyReserve: number;
  }
): MonthlyProjection[] {
  const now = new Date();
  const baseY = now.getFullYear();
  const baseM0 = now.getMonth();
  const out: MonthlyProjection[] = [];

  for (let i = 0; i < 12; i++) {
    const d = new Date(baseY, baseM0 + i, 1);
    const y = d.getFullYear();
    const m0 = d.getMonth();
    const ym = `${y}-${String(m0 + 1).padStart(2, '0')}`;
    const label = `${MONTH_NAMES[m0]} ${String(y).slice(2)}`;

    let income = fb.monthlyIncomeFallback;
    profile.incomes.forEach(inc => {
      const amt = Math.max(0, num(inc.amount));
      if (inc.frequency === 'monthly') income += amt;
      else if (inc.frequency === 'quarterly' && i % 3 === 0) income += amt;
      else if (inc.frequency === 'annual') {
        const targetM0 = inc.date && /^\d{4}-\d{2}/.test(inc.date) ? Number(inc.date.slice(5, 7)) - 1 : baseM0;
        if (m0 === targetM0) income += amt;
      } else if (inc.frequency === 'one-time' && inc.date?.startsWith(ym)) {
        income += amt;
      }
    });

    let fixedExpenses = fb.fixedFallback;
    let variableExpenses = fb.variableFallback;
    profile.expenses.forEach(exp => {
      const amt = Math.max(0, num(exp.amount));
      let hitAmt = 0;
      if (exp.frequency === 'daily') hitAmt = amt * 30;
      else if (exp.frequency === 'weekly') hitAmt = (amt * 52) / 12;
      else if (exp.frequency === 'monthly') hitAmt = amt;
      else if (exp.frequency === 'quarterly' && i % 3 === 0) hitAmt = amt;
      else if (exp.frequency === 'yearly' && i === 11) hitAmt = amt;
      if (exp.kind === 'fixed') fixedExpenses += hitAmt;
      else variableExpenses += hitAmt;
    });

    let emisAndDebt = fb.emiFallback;
    let taxesAndRenewals = fb.taxMonthlyReserve;

    profile.obligations.forEach(ob => {
      if (ob.status === 'Paid' && ob.frequency === 'one-time') return;
      const amt = Math.max(0, num(ob.amountDue) || num(ob.totalAmount));
      let hitsThisMonth = false;
      if (ob.frequency === 'monthly') hitsThisMonth = true;
      else if (ob.frequency === 'quarterly' && i % 3 === 0) hitsThisMonth = true;
      else if (ob.frequency === 'yearly') {
        const targetM0 = ob.dueDate && /^\d{4}-\d{2}/.test(ob.dueDate) ? Number(ob.dueDate.slice(5, 7)) - 1 : baseM0;
        hitsThisMonth = m0 === targetM0;
      } else if (ob.frequency === 'one-time') {
        hitsThisMonth = ob.dueDate ? ob.dueDate.startsWith(ym) : i === 0;
      }
      if (!hitsThisMonth) return;

      if (isLoanObligation(ob.kind) || ob.kind === 'credit-card') emisAndDebt += amt;
      else taxesAndRenewals += amt;
    });

    const totalOutflow = fixedExpenses + variableExpenses + emisAndDebt + taxesAndRenewals;
    out.push({
      ym,
      label,
      income: Math.round(income),
      fixedExpenses: Math.round(fixedExpenses),
      variableExpenses: Math.round(variableExpenses),
      emisAndDebt: Math.round(emisAndDebt),
      taxesAndRenewals: Math.round(taxesAndRenewals),
      totalOutflow: Math.round(totalOutflow),
      netCashFlow: Math.round(income - totalOutflow)
    });
  }

  return out;
}

/* ============================================================
   AVALANCHE VS SNOWBALL DEBT REPAYMENT SIMULATOR
   ============================================================ */
interface SimLoan {
  name: string;
  balance: number;
  apr: number;
  minPay: number;
}

function simulatePayoff(loans: SimLoan[], extraMonthly: number, strategy: 'avalanche' | 'snowball') {
  const queue = loans.map(l => ({ ...l }));
  let months = 0;
  let totalInterest = 0;

  while (queue.some(l => l.balance > 0.5) && months < 360) {
    months++;
    // Accrue monthly interest
    queue.forEach(l => {
      if (l.balance > 0) {
        const interest = (l.balance * (l.apr / 100)) / 12;
        totalInterest += interest;
        l.balance += interest;
      }
    });

    // Pay minimum on each active loan
    let freedPool = extraMonthly;
    queue.forEach(l => {
      if (l.balance <= 0) {
        freedPool += l.minPay;
        return;
      }
      const pay = Math.min(l.balance, l.minPay);
      l.balance -= pay;
      if (l.balance <= 0.5) {
        freedPool += Math.max(0, l.minPay - pay);
        l.balance = 0;
      }
    });

    // Apply extra + snowball/avalanche freed pool
    const active = queue.filter(l => l.balance > 0);
    active.sort((a, b) => (strategy === 'avalanche' ? b.apr - a.apr : a.balance - b.balance));
    for (const target of active) {
      if (freedPool <= 0) break;
      const extraPay = Math.min(target.balance, freedPool);
      target.balance -= extraPay;
      freedPool -= extraPay;
      if (target.balance < 0.5) target.balance = 0;
    }
  }

  return { months, totalInterest: Math.round(totalInterest) };
}

export function compareLoanStrategies(
  profile: FinancialProfile,
  txRows: Transaction[]
): LoanStrategyResult | null {
  const simLoans: SimLoan[] = [];

  profile.obligations
    .filter(o => isLoanObligation(o.kind) || o.kind === 'credit-card')
    .forEach(o => {
      const bal = Math.max(0, num(o.remainingBalance));
      const emi = Math.max(100, obligationToMonthly(o.totalAmount, o.frequency));
      const rate = o.interestRate && o.interestRate > 0 ? o.interestRate : o.kind === 'credit-card' ? 36 : 11.5;
      if (bal > 0) {
        simLoans.push({ name: o.name, balance: bal, apr: rate, minPay: Math.min(bal, Math.max(emi, bal * (rate / 1200) + 100)) });
      }
    });

  // Also include explicit liabilities if obligations had no remaining balances
  if (!simLoans.length && profile.liabilities.length) {
    profile.liabilities.forEach(l => {
      if (l.balance > 0) {
        const rate = l.interestRate && l.interestRate > 0 ? l.interestRate : l.kind === 'Credit Card Balance' ? 36 : 11;
        simLoans.push({
          name: l.name,
          balance: l.balance,
          apr: rate,
          minPay: Math.max(500, Math.round(l.balance * 0.025))
        });
      }
    });
  }

  // Fallback notice: if ledger loans exist without remaining balances entered yet
  if (!simLoans.length) {
    const ledgerLoans = txRows.filter(r => r.type.toUpperCase() === 'LOAN' && (num(r.budget) > 0 || num(r.spent) > 0));
    if (!ledgerLoans.length) return null;
    return {
      loanCount: ledgerLoans.length,
      totalBalance: 0,
      weightedApr: 0,
      avalancheOrder: [],
      snowballOrder: [],
      avalancheMonths: 0,
      snowballMonths: 0,
      avalancheInterest: 0,
      snowballInterest: 0,
      interestSavedWithAvalanche: 0,
      extraMonthlyTested: 0
    };
  }

  const totalBalance = simLoans.reduce((s, l) => s + l.balance, 0);
  const weightedApr =
    totalBalance > 0 ? simLoans.reduce((s, l) => s + l.balance * l.apr, 0) / totalBalance : 0;
  const totalMin = simLoans.reduce((s, l) => s + l.minPay, 0);
  const extraMonthlyTested = Math.max(2000, Math.round(totalMin * 0.12));

  const avSorted = [...simLoans].sort((a, b) => b.apr - a.apr).map(l => `${l.name} (${l.apr.toFixed(1)}%)`);
  const sbSorted = [...simLoans].sort((a, b) => a.balance - b.balance).map(l => `${l.name} (${money(l.balance)})`);

  const av = simulatePayoff(simLoans, extraMonthlyTested, 'avalanche');
  const sb = simulatePayoff(simLoans, extraMonthlyTested, 'snowball');

  return {
    loanCount: simLoans.length,
    totalBalance,
    weightedApr,
    avalancheOrder: avSorted,
    snowballOrder: sbSorted,
    avalancheMonths: av.months,
    snowballMonths: sb.months,
    avalancheInterest: av.totalInterest,
    snowballInterest: sb.totalInterest,
    interestSavedWithAvalanche: Math.max(0, sb.totalInterest - av.totalInterest),
    extraMonthlyTested
  };
}

/* ============================================================
   AI FINANCIAL ADVISOR ENGINE (5-PART STRUCTURED INSIGHTS)
   ============================================================ */
export function generateAdvisorInsights(
  summary: FinancialSummary,
  profile: FinancialProfile,
  txRows: Transaction[]
): AdvisorRecommendation[] {
  const recs: AdvisorRecommendation[] = [];
  const lt = totals(txRows);

  // 1. Overdue or Upcoming Payments vs Disposable / Liquid Funds
  const immediateDue = summary.overdueObligationsAmount + summary.upcomingObligationsAmount;
  const availableBuffer = Math.max(0, summary.monthlyCashFlow) + summary.liquidAssets;
  if (summary.overdueObligationsCount > 0 || (immediateDue > 0 && immediateDue > availableBuffer)) {
    recs.push({
      id: 'adv-overdue-cash-crunch',
      title: 'Upcoming / Overdue Bills Exceed Current Cash Buffer',
      category: 'Cash Flow & Obligations',
      priority: 'High',
      identified: `${summary.overdueObligationsCount} overdue and ${summary.upcomingObligationsCount} upcoming payment(s) total ${money(immediateDue)}, while current monthly cash flow + entered liquid assets stand at ${money(availableBuffer)}.`,
      whyItMatters: 'Late EMI, credit card, or tax payments trigger 24%–42% penal APR and credit-score damage.',
      suggestedAction: 'Prioritize overdue settlements today, pause non-essential discretionary buys this cycle, and ring-fence a dedicated bill reserve.',
      estimatedImpact: `Prevents ~${money(Math.round(immediateDue * 0.03))}/mo in late fees & interest`,
      basis: `Obligations due (${money(immediateDue)}) compared against Monthly Cash Flow (${money(summary.monthlyCashFlow)}) + Liquid Assets (${money(summary.liquidAssets)}).`
    });
  }

  // 2. Months with Negative Projected Cash Flow
  const deficitMonths = summary.projections.filter(p => p.netCashFlow < 0);
  if (deficitMonths.length > 0) {
    const worst = [...deficitMonths].sort((a, b) => a.netCashFlow - b.netCashFlow)[0];
    const totalGap = deficitMonths.reduce((s, p) => s + Math.abs(p.netCashFlow), 0);
    recs.push({
      id: 'adv-negative-cashflow',
      title: `${deficitMonths.length} Projected Month(s) Show Negative Cash Flow`,
      category: 'Cash Flow Forecast',
      priority: 'High',
      identified: `Projected deficits appear in ${deficitMonths.slice(0, 3).map(m => m.label).join(', ')} (worst: ${worst.label} at ${money(worst.netCashFlow)}).`,
      whyItMatters: 'Seasonal/quarterly/annual renewals or high fixed EMIs force reliance on credit cards or savings withdrawals during deficit months.',
      suggestedAction: `Build a sinking fund of ${money(Math.ceil(totalGap / 12))}/mo starting this month to smooth irregular outflows across the year.`,
      estimatedImpact: `Eliminates ${money(totalGap)} annual cash shortfall`,
      basis: `12-month schedule combining recurring incomes (${money(summary.monthlyIncome)}/mo) vs fixed, variable, quarterly/annual bills & EMIs.`
    });
  }

  // 3. Debt-to-Income & Loan Optimization (Avalanche vs Snowball)
  const loanStrategy = compareLoanStrategies(profile, txRows);
  if (summary.dtiPct > 35) {
    const targetEmi = Math.round(summary.monthlyIncome * 0.35);
    const excessEmi = Math.max(0, Math.round(summary.monthlyEmiPayments - targetEmi));
    recs.push({
      id: 'adv-high-dti',
      title: 'High Debt-to-Income Burden Above 35% Benchmark',
      category: 'Debt & EMIs',
      priority: 'High',
      identified: `Debt obligations consume ${summary.dtiPct.toFixed(1)}% of monthly income (${money(summary.monthlyEmiPayments)} / ${money(summary.monthlyIncome)}).`,
      whyItMatters: 'Keeping total EMIs above 35% leaves minimal shock-absorption for medical or income disruptions.',
      suggestedAction: loanStrategy && loanStrategy.avalancheOrder.length
        ? `Apply Debt Avalanche targeting ${loanStrategy.avalancheOrder[0]} first with an extra ${money(loanStrategy.extraMonthlyTested)}/mo, or consolidate high-APR personal/card debt.`
        : 'Avoid taking new EMIs, add remaining loan balances & APRs in 03 Obligations, and channel bonuses toward highest-interest debt.',
      estimatedImpact:
        loanStrategy && loanStrategy.interestSavedWithAvalanche > 0
          ? `Saves ${money(loanStrategy.interestSavedWithAvalanche)} extra interest vs Snowball`
          : `Frees ${money(excessEmi)}/mo toward healthy cash flow`,
      basis: `Monthly EMIs (${money(summary.monthlyEmiPayments)}) ÷ Monthly Income (${money(summary.monthlyIncome)}) = ${summary.dtiPct.toFixed(1)}%.`
    });
  } else if (loanStrategy && loanStrategy.totalBalance > 0 && loanStrategy.loanCount >= 2) {
    recs.push({
      id: 'adv-loan-strategy',
      title: 'Accelerate Debt Freedom Using Avalanche Ordering',
      category: 'Debt & EMIs',
      priority: 'Medium',
      identified: `${loanStrategy.loanCount} active debt balances total ${money(loanStrategy.totalBalance)} at ${loanStrategy.weightedApr.toFixed(1)}% weighted APR.`,
      whyItMatters: 'Paying high-APR loans before lower-APR debt cuts compounding interest without raising total cash outlay.',
      suggestedAction: `Direct any extra ${money(loanStrategy.extraMonthlyTested)}/mo toward ${loanStrategy.avalancheOrder[0]} while paying minimums on others.`,
      estimatedImpact: `Debt-free in ${loanStrategy.avalancheMonths} months · saves ${money(loanStrategy.interestSavedWithAvalanche)}`,
      basis: `Month-by-month simulation comparing Avalanche (highest APR first) vs Snowball (smallest balance first).`
    });
  }

  // 4. Budget Overruns & High / Variable Expense Optimization
  const overBudgetRows = txRows
    .filter(r => r.type.toUpperCase() !== 'INCOME' && num(r.budget) > 0 && num(r.spent) > num(r.budget))
    .sort((a, b) => (b.spent - b.budget) - (a.spent - a.budget));

  if (overBudgetRows.length > 0) {
    const topOver = overBudgetRows.slice(0, 3);
    const totalOverrun = overBudgetRows.reduce((s, r) => s + (r.spent - r.budget), 0);
    recs.push({
      id: 'adv-budget-overrun',
      title: 'Unusually High Spending Above Planned Categories',
      category: 'Spending Control',
      priority: totalOverrun > summary.monthlyIncome * 0.08 ? 'High' : 'Medium',
      identified: `${overBudgetRows.length} category item(s) exceeded budget led by ${topOver.map(r => `${r.desc} (+${money(r.spent - r.budget)})`).join(', ')}.`,
      whyItMatters: 'Repeated micro-overruns silently erode end-of-month surplus and force savings cutbacks.',
      suggestedAction: `Set a soft weekly alert for ${topOver[0].desc} and trim discretionary categories by 10–15% next cycle—no cuts to essentials needed.`,
      estimatedImpact: `Recovers up to ${money(Math.round(totalOverrun))}/mo`,
      basis: `Ledger sum of (Actual − Budget) across ${overBudgetRows.length} over-budget rows.`
    });
  }

  // 5. Realistic Monthly Savings Target & Non-Restrictive Savings Opportunities
  const variableSaveOpp = Math.round(summary.variableMonthlyExpenses * 0.12);
  const idealTarget = summary.monthlyIncome > 0 ? Math.round(summary.monthlyIncome * 0.2) : 0;
  const realisticTarget = Math.max(
    Math.round(summary.monthlySavingsActual),
    Math.min(idealTarget, Math.round(summary.monthlySavingsActual + Math.max(0, summary.monthlyCashFlow * 0.5) + variableSaveOpp))
  );

  if (summary.monthlyIncome > 0 && summary.savingsRatePct < 20) {
    recs.push({
      id: 'adv-savings-velocity',
      title: 'Raise Household Savings Rate Without Cutting Essentials',
      category: 'Savings & Wealth',
      priority: summary.savingsRatePct < 10 ? 'High' : 'Medium',
      identified: `Current savings rate is ${summary.savingsRatePct.toFixed(1)}% (${money(summary.monthlySavingsActual)}/mo) vs the recommended 20% benchmark (${money(idealTarget)}/mo).`,
      whyItMatters: 'Automating at least 15–20% of income compounds long-term wealth while reducing future borrowing.',
      suggestedAction: `Redirect a realistic ${money(realisticTarget)}/mo total via SIP/RD on salary day and trim ~12% of variable/non-essential spend (${money(variableSaveOpp)}/mo).`,
      estimatedImpact: `+${money(Math.max(0, (realisticTarget - summary.monthlySavingsActual) * 12))}/yr additional wealth built`,
      basis: `Savings Rate = ${money(summary.monthlySavingsActual)} ÷ ${money(summary.monthlyIncome)}; variable spend 12% efficiency = ${money(variableSaveOpp)}.`
    });
  }

  // 6. Emergency Fund Target (6x Essential Monthly Expenses)
  const essentialBase =
    summary.essentialMonthlyExpenses > 0
      ? summary.essentialMonthlyExpenses
      : summary.fixedMonthlyExpenses + summary.monthlyEmiPayments * 0.5;
  const targetEmergency = Math.round(essentialBase * 6);
  const emergencyGap = Math.max(0, targetEmergency - summary.liquidAssets);

  if (targetEmergency > 0 && (emergencyGap > 0 || !summary.hasAssetsOrLiabilities)) {
    recs.push({
      id: 'adv-emergency-fund',
      title: 'Emergency Fund Coverage Against 6 Months of Essentials',
      category: 'Resilience Reserve',
      priority: summary.liquidAssets < essentialBase * 2 ? 'High' : 'Medium',
      identified: summary.hasAssetsOrLiabilities
        ? `Entered liquid assets (${money(summary.liquidAssets)}) cover ${(essentialBase > 0 ? summary.liquidAssets / essentialBase : 0).toFixed(1)} months of essentials (${money(essentialBase)}/mo), short of the 6-month target (${money(targetEmergency)}).`
        : `Based on essential monthly costs (${money(essentialBase)}/mo), a 6-month household buffer requires ${money(targetEmergency)}. Add Cash/FD/Liquid MF assets in 02 Profile to track exact coverage.`,
      whyItMatters: 'A liquid reserve prevents liquidating long-term investments or taking high-interest emergency loans.',
      suggestedAction: `Park ${money(Math.min(Math.max(2000, Math.round(emergencyGap / 12)), Math.max(2000, Math.round(summary.monthlyIncome * 0.08))))}/mo in a sweep-in FD or liquid fund until reaching ${money(targetEmergency)}.`,
      estimatedImpact: `Closes ${money(emergencyGap || targetEmergency)} resilience gap`,
      basis: `6 × Essential Monthly Outflow (${money(essentialBase)}) = ${money(targetEmergency)}.`
    });
  }

  // 7. Tax & Recurring Reserve Guidance
  if (!summary.tax.configured) {
    recs.push({
      id: 'adv-tax-unconfigured',
      title: 'Configure Tax Regime Before Year-End Surprises',
      category: 'Tax & Compliance',
      priority: 'Medium',
      identified: 'Tax details (Old vs New Regime, 80C/80D/HRA, TDS deducted) have not been configured yet.',
      whyItMatters: 'H ∈ M refuses to assume tax liability blindly—configuring your regime prevents unexpected March advance-tax cash crunches.',
      suggestedAction: 'Open 03 Payments & Obligations → Tax Liability Estimator, enter TDS & deductions, and compare Old vs New regimes.',
      estimatedImpact: 'Enables accurate monthly tax reserve & deadline alerts',
      basis: 'Tax configuration flag is currently false (zero assumed tax).'
    });
  } else if (summary.tax.remainingTaxPayable > 0) {
    recs.push({
      id: 'adv-tax-reserve',
      title: 'Ring-Fence Monthly Tax & Annual Renewal Reserve',
      category: 'Tax & Compliance',
      priority: summary.tax.monthlyTaxReserve > summary.monthlyCashFlow ? 'High' : 'Low',
      identified: `Remaining annual tax liability after TDS/advance tax is ${money(summary.tax.remainingTaxPayable)} (${summary.tax.regime.toUpperCase()} regime, effective rate ${summary.tax.effectiveRatePct.toFixed(1)}%).`,
      whyItMatters: 'Setting aside tax monthly avoids end-of-quarter advance tax stress.',
      suggestedAction: `Transfer ${money(summary.tax.monthlyTaxReserve)}/mo into a separate tax-reserve bucket before quarterly due dates (Jun 15, Sep 15, Dec 15, Mar 15).`,
      estimatedImpact: `100% penalty-free compliance on ${money(summary.tax.remainingTaxPayable)}`,
      basis: summary.tax.methodologyNote
    });
  }

  // 8. Positive Reinforcement / Ideal Distribution if healthy
  if (recs.length === 0 || (summary.monthlyCashFlow > 0 && summary.savingsRatePct >= 20 && summary.dtiPct <= 30)) {
    recs.push({
      id: 'adv-healthy-allocation',
      title: 'Household Surplus Ready for Goal-Linked Deployment',
      category: 'Budget Strategy',
      priority: 'Low',
      identified: `Monthly surplus is positive (${money(summary.monthlyCashFlow)}/mo) with a ${summary.savingsRatePct.toFixed(1)}% savings rate and ${lt.count} tracked records.`,
      whyItMatters: 'Idle surplus in low-yield savings loses purchasing power to inflation.',
      suggestedAction: 'Allocate ~50% of surplus to goal-linked equity/index SIPs and ~50% toward prepaying highest-APR loan principal or topping up FDs.',
      estimatedImpact: `+${money(Math.round(Math.max(0, summary.monthlyCashFlow) * 12))} yearly compounding base`,
      basis: `Net Monthly Cash Flow (${money(summary.monthlyCashFlow)}) after all expenses, EMIs, savings & configured taxes.`
    });
  }

  return recs;
}

/* ============================================================
   OPTIONAL LEDGER -> PROFILE IMPORT (STRICTLY FROM REAL TX)
   ============================================================ */
export function deriveProfileFromLedger(txRows: Transaction[]): {
  incomes: IncomeSource[];
  expenses: RecurringExpense[];
  obligations: ObligationItem[];
} {
  const incomes: IncomeSource[] = [];
  const expenses: RecurringExpense[] = [];
  const obligations: ObligationItem[] = [];

  const incSeen = new Set<string>();
  const expSeen = new Set<string>();
  const oblSeen = new Set<string>();

  txRows.forEach(r => {
    const ty = r.type.toUpperCase();
    const amt = num(r.spent) || num(r.budget);
    const key = `${r.member}:${r.category}:${r.desc}`.toUpperCase();

    if (ty === 'INCOME' && amt > 0 && !incSeen.has(key)) {
      incSeen.add(key);
      const isSal = r.desc.toUpperCase().includes('SALARY');
      incomes.push({
        id: uid('inc'),
        name: `${r.desc} (${r.member})`,
        kind: isSal ? 'monthly-salary' : 'investment-interest',
        amount: amt,
        frequency: 'monthly',
        payDay: Number((r.date || '').slice(8, 10)) || 1,
        member: r.member,
        isEstimate: false,
        notes: `Imported from ledger #${r.id}`
      });
    } else if (ty === 'EXPENSE' && (num(r.budget) > 0 || num(r.spent) > 0) && !expSeen.has(key)) {
      expSeen.add(key);
      const d = r.desc.toUpperCase();
      let cat: ExpenseCategoryKind = 'Other';
      if (d.includes('RENT') || d.includes('MAINTENANCE')) cat = 'Rent / Maintenance';
      else if (d.includes('GROCER') || d.includes('RICE') || d.includes('MILK') || d.includes('VEG') || d.includes('FRUIT') || d.includes('GHEE') || d.includes('GAS')) cat = 'Groceries & Food';
      else if (d.includes('CURRENT') || d.includes('BILL') || d.includes('NET') || d.includes('CABLE') || d.includes('WATER')) cat = 'Utilities (Elec/Water/Net)';
      else if (d.includes('PETROL') || d.includes('FUEL') || d.includes('CAR') || d.includes('VEHICLE')) cat = 'Transport & Fuel';
      else if (d.includes('MEDICAL') || d.includes('HOSPITAL')) cat = 'Medical';
      else if (d.includes('SHOP') || d.includes('SHOE') || d.includes('CLOTH') || d.includes('TOUR')) cat = 'Shopping & Entertainment';

      const isVar = r.category.toUpperCase().includes('OCCASIONAL') || cat === 'Shopping & Entertainment';
      expenses.push({
        id: uid('exp'),
        name: r.desc,
        category: cat,
        kind: isVar ? 'variable' : 'fixed',
        amount: num(r.budget) || num(r.spent),
        frequency: 'monthly',
        dueDay: Number((r.due || r.date || '').slice(8, 10)) || 5,
        essential: !isVar,
        notes: `Imported from ledger #${r.id}`
      });
    } else if ((ty === 'LOAN' || isDue(r)) && (num(r.budget) > 0 || num(r.spent) > 0) && !oblSeen.has(key)) {
      oblSeen.add(key);
      const d = `${r.category} ${r.desc}`.toUpperCase();
      let kind: ObligationKind = 'other-liability';
      if (d.includes('HOUS') || d.includes('HOME')) kind = 'home-loan-emi';
      else if (d.includes('PERSONAL') || d.includes('JUMBO') || d.includes('INSTA')) kind = 'personal-loan-emi';
      else if (d.includes('CARD') || d.includes('AXIS')) kind = 'credit-card';
      else if (d.includes('INSURANCE')) kind = 'insurance-premium';

      const totalAmt = num(r.budget) || num(r.spent);
      const paid = r.status.toUpperCase() === 'PAID';
      obligations.push({
        id: uid('obl'),
        name: `${r.desc} (${r.member})`,
        kind,
        totalAmount: totalAmt,
        amountDue: paid ? 0 : totalAmt,
        dueDate: r.due || r.date || todayIsoLocal(),
        frequency: 'monthly',
        status: paid ? 'Paid' : 'Upcoming',
        entrySource: 'confirmed',
        notes: `Imported from ledger #${r.id}`
      });
    }
  });

  return { incomes, expenses, obligations };
}
