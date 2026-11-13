import { MONTH_NAMES } from './constants';
import { getAlertState, isLoanObligation, isTaxObligation, todayIsoLocal } from './intelligence';
import { Perm } from './storage';
import type { CalendarUnifiedEvent, FinancialProfile, Transaction } from './types';
import { $, compactMoney, download, el, fmtDate, isDue, money, num, toast } from './utils';

export interface CalendarApi {
  open: (dateStr?: string) => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  refresh: () => void;
}

interface CalendarOptions {
  getRows: () => Transaction[];
  getProfile: () => FinancialProfile;
  onAddForDate: (date: string) => void;
  onEditRow: (row: Transaction) => void;
  onMarkPaid: (id: number) => void;
  onMarkObligationPaid?: (id: string) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isoDate(y: number, m0: number, d: number): string {
  return `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
}

function clampDay(y: number, m0: number, day: number): string {
  const maxD = new Date(y, m0 + 1, 0).getDate();
  const safe = Math.max(1, Math.min(maxD, Math.round(day) || 1));
  return isoDate(y, m0, safe);
}

function parseYm(dateStr: string): { y: number; m0: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateStr || '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const m0 = Number(m[2]) - 1;
  if (m0 < 0 || m0 > 11) return null;
  return { y, m0 };
}

function escapeIcs(s: string): string {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function buildIcs(events: CalendarUnifiedEvent[]): { content: string; count: number } {
  const targets = events.filter(e => e.alertState !== 'info' || e.kind === 'income' || e.kind === 'loan').slice(0, 60);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//H E M//Household Expense Manager//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:H E M Household Bills, EMIs & Tax Schedule'
  ];

  targets.forEach(ev => {
    const dt = (ev.date || '').replace(/-/g, '');
    if (!/^\d{8}$/.test(dt)) return;
    const dObj = new Date(
      Number(dt.slice(0, 4)),
      Number(dt.slice(4, 6)) - 1,
      Number(dt.slice(6, 8)) + 1
    );
    const nextDt = `${dObj.getFullYear()}${pad2(dObj.getMonth() + 1)}${pad2(dObj.getDate())}`;
    const prefix =
      ev.alertState === 'overdue'
        ? 'OVERDUE: '
        : ev.alertState === 'due-today'
          ? 'DUE TODAY: '
          : ev.alertState === 'upcoming'
            ? 'UPCOMING: '
            : '';
    const summary = `${prefix}${ev.title} (${money(ev.amount)})`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:hem-cal-${ev.id}@hem-household.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dt}`,
      `DTEND;VALUE=DATE:${nextDt}`,
      `SUMMARY:${escapeIcs(summary)}`,
      `DESCRIPTION:${escapeIcs(`${ev.category} | ${ev.detail}`)}`,
      `STATUS:${ev.alertState === 'paid' ? 'CONFIRMED' : 'TENTATIVE'}`,
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return { content: lines.join('\r\n'), count: targets.length };
}

function buildUnifiedEventsForMonth(
  y: number,
  m0: number,
  rows: Transaction[],
  profile: FinancialProfile,
  todayIso: string
): CalendarUnifiedEvent[] {
  const events: CalendarUnifiedEvent[] = [];
  const ymPrefix = `${y}-${pad2(m0 + 1)}`;

  // 1. Transactions from Ledger
  rows.forEach(r => {
    const ed = isDue(r) && r.due && /^\d{4}-\d{2}-\d{2}$/.test(r.due) ? r.due : r.date || '';
    const inMonth = ed.startsWith(ymPrefix) || (r.due && r.due.startsWith(ymPrefix));
    if (!inMonth) return;

    const ty = (r.type || '').toUpperCase();
    const kind: CalendarUnifiedEvent['kind'] =
      ty === 'INCOME'
        ? 'income'
        : ty === 'LOAN'
          ? 'loan'
          : ty === 'SAVING'
            ? 'saving'
            : 'expense';

    const evDate = ed.startsWith(ymPrefix) ? ed : r.due || ed;
    const alertState =
      ty === 'INCOME'
        ? 'info'
        : isDue(r)
          ? getAlertState(evDate, 'Upcoming', todayIso)
          : 'paid';

    events.push({
      id: `tx-${r.id}`,
      date: evDate,
      title: r.desc,
      category: `${r.member} · ${r.category}`,
      kind,
      amount: num(r.spent) || num(r.budget),
      alertState,
      source: 'ledger',
      detail: `#${r.id} · ${r.type} · ${r.pm} · ${r.status}`,
      txRow: r
    });
  });

  // 2. Profile Income Credit Dates (Salary, Rent, Interest, Bonus, One-Time)
  profile.incomes.forEach(inc => {
    let dt = '';
    if (inc.frequency === 'monthly') {
      dt = clampDay(y, m0, inc.payDay || 1);
    } else if (inc.frequency === 'quarterly' && m0 % 3 === 0) {
      dt = clampDay(y, m0, inc.payDay || 1);
    } else if (inc.frequency === 'annual') {
      const targetM0 = inc.date && /^\d{4}-\d{2}/.test(inc.date) ? Number(inc.date.slice(5, 7)) - 1 : 0;
      if (m0 === targetM0) dt = clampDay(y, m0, Number(inc.date?.slice(8, 10)) || inc.payDay || 1);
    } else if (inc.frequency === 'one-time' && inc.date?.startsWith(ymPrefix)) {
      dt = inc.date;
    }
    if (!dt) return;
    events.push({
      id: `pinc-${inc.id}-${ymPrefix}`,
      date: dt,
      title: inc.name,
      category: inc.kind.replace(/-/g, ' '),
      kind: 'income',
      amount: num(inc.amount),
      alertState: 'info',
      source: 'profile-income',
      detail: `${inc.frequency} credit · ${inc.isEstimate ? 'Estimated' : 'Confirmed'}${inc.member ? ` · ${inc.member}` : ''}`
    });
  });

  // 3. Profile Recurring Expense Dates (Rent, Subscriptions, Utilities, etc.)
  profile.expenses.forEach(exp => {
    let dt = '';
    if (exp.frequency === 'monthly' || exp.frequency === 'weekly' || exp.frequency === 'daily') {
      dt = clampDay(y, m0, exp.dueDay || 5);
    } else if (exp.frequency === 'quarterly' && m0 % 3 === 0) {
      dt = clampDay(y, m0, exp.dueDay || 5);
    } else if (exp.frequency === 'yearly' && m0 === 0) {
      dt = clampDay(y, m0, exp.dueDay || 5);
    }
    if (!dt) return;
    events.push({
      id: `pexp-${exp.id}-${ymPrefix}`,
      date: dt,
      title: exp.name,
      category: exp.category,
      kind: 'expense',
      amount: num(exp.amount),
      alertState: dt < todayIso ? 'paid' : dt === todayIso ? 'due-today' : 'upcoming',
      source: 'profile-expense',
      detail: `${exp.frequency} · ${exp.kind} · ${exp.essential ? 'Essential' : 'Lifestyle'}`
    });
  });

  // 4. Payments & Obligations (EMIs, Tax Deadlines, Insurance Renewals, Credit Card Bills)
  profile.obligations.forEach(ob => {
    let dt = '';
    if (ob.dueDate && ob.dueDate.startsWith(ymPrefix)) {
      dt = ob.dueDate;
    } else if (ob.frequency === 'monthly') {
      const dayNum = ob.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(ob.dueDate) ? Number(ob.dueDate.slice(8, 10)) : 5;
      dt = clampDay(y, m0, dayNum);
    } else if (ob.frequency === 'quarterly' && m0 % 3 === 0) {
      const dayNum = ob.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(ob.dueDate) ? Number(ob.dueDate.slice(8, 10)) : 15;
      dt = clampDay(y, m0, dayNum);
    } else if (ob.frequency === 'yearly' && ob.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(ob.dueDate)) {
      const targetM0 = Number(ob.dueDate.slice(5, 7)) - 1;
      if (m0 === targetM0) dt = clampDay(y, m0, Number(ob.dueDate.slice(8, 10)));
    }
    if (!dt) return;

    const alertState = getAlertState(dt, ob.status, todayIso);
    const kind: CalendarUnifiedEvent['kind'] = isLoanObligation(ob.kind)
      ? 'loan'
      : isTaxObligation(ob.kind) || ob.kind === 'insurance-premium'
        ? 'tax-insurance'
        : ob.kind === 'credit-card'
          ? 'credit-card'
          : 'expense';

    events.push({
      id: `obl-${ob.id}`,
      date: dt,
      title: ob.name,
      category: ob.kind.replace(/-/g, ' '),
      kind,
      amount: num(ob.amountDue) || num(ob.totalAmount),
      alertState,
      source: 'obligation',
      detail: `${ob.frequency} · Status: ${ob.status} · Source: ${ob.entrySource}${ob.remainingBalance ? ` · Bal ${money(ob.remainingBalance)}` : ''}`
    });
  });

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

export function initHouseholdCalendar(opts: CalendarOptions): CalendarApi {
  const dlg = document.getElementById('calDialog') as HTMLDialogElement | null;
  const bandBtn = document.getElementById('calBandBtn') as HTMLButtonElement | null;
  const drawerBtn = document.getElementById('calDrawerBtn') as HTMLButtonElement | null;
  const settingsBtn = document.getElementById('openCalFromSettings') as HTMLButtonElement | null;
  const overviewBtn = document.getElementById('ovOpenCalBtn') as HTMLButtonElement | null;
  const obligBtn = document.getElementById('oblOpenCalBtn') as HTMLButtonElement | null;

  const todayObj = new Date();
  const todayIso = todayIsoLocal();

  let viewYear = todayObj.getFullYear();
  let viewMonth = todayObj.getMonth();
  let selectedDate = todayIso;
  let kindFilter: 'all' | 'alerts' | 'income' | 'loan' | 'tax-insurance' = 'all';
  let initializedView = false;

  function pickDefaultDateFromData(rows: Transaction[], profile: FinancialProfile) {
    const dated = [
      ...rows.map(r => r.due || r.date),
      ...profile.obligations.map(o => o.dueDate)
    ]
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d || ''))
      .sort();
    if (!dated.length) return;
    // Prefer today if any obligations exist near current month, else latest dated entry
    const curYm = todayIso.slice(0, 7);
    const hasCurrentMonth = dated.some(d => d.startsWith(curYm));
    const target = hasCurrentMonth ? todayIso : dated[dated.length - 1];
    const parsed = parseYm(target);
    if (parsed) {
      viewYear = parsed.y;
      viewMonth = parsed.m0;
      selectedDate = target;
    }
  }

  function toneClass(ev: CalendarUnifiedEvent): string {
    if (ev.alertState === 'overdue') return 'is-overdue';
    if (ev.alertState === 'due-today' || ev.alertState === 'upcoming') return 'is-due';
    if (ev.kind === 'income') return 'is-income';
    if (ev.kind === 'loan') return 'is-loan';
    if (ev.kind === 'saving') return 'is-saving';
    if (ev.kind === 'tax-insurance') return 'is-tax';
    return 'is-expense';
  }

  function render() {
    if (!dlg) return;
    const rows = opts.getRows();
    const profile = opts.getProfile();
    const ymPrefix = `${viewYear}-${pad2(viewMonth + 1)}`;

    const allEvents = buildUnifiedEventsForMonth(viewYear, viewMonth, rows, profile, todayIso);
    const visibleEvents = allEvents.filter(ev => {
      if (kindFilter === 'alerts') return ev.alertState === 'overdue' || ev.alertState === 'due-today' || ev.alertState === 'upcoming';
      if (kindFilter === 'income') return ev.kind === 'income';
      if (kindFilter === 'loan') return ev.kind === 'loan' || ev.kind === 'credit-card';
      if (kindFilter === 'tax-insurance') return ev.kind === 'tax-insurance';
      return true;
    });

    const dayMap = new Map<string, CalendarUnifiedEvent[]>();
    visibleEvents.forEach(ev => {
      const arr = dayMap.get(ev.date);
      if (arr) arr.push(ev);
      else dayMap.set(ev.date, [ev]);
    });

    const inflowSum = allEvents.filter(e => e.kind === 'income').reduce((s, e) => s + e.amount, 0);
    const outflowSum = allEvents.filter(e => e.kind !== 'income').reduce((s, e) => s + e.amount, 0);
    const overdueList = allEvents.filter(e => e.alertState === 'overdue');
    const dueTodayList = allEvents.filter(e => e.alertState === 'due-today');
    const upcomingList = allEvents.filter(e => e.alertState === 'upcoming');

    const firstDow = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();
    const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;

    dlg.innerHTML = '';

    const closeBtn = el('button', { type: 'button', class: 'btn sm ghost', text: 'Close ✕' });
    closeBtn.addEventListener('click', close);

    const exportBtn = el('button', {
      type: 'button',
      class: 'btn sm ghost',
      text: 'Export Schedule (.ics)'
    });
    exportBtn.addEventListener('click', () => {
      const { content, count } = buildIcs(allEvents);
      if (!count) {
        toast('No dated events in this month to export', 'err');
        return;
      }
      download(
        `hem-schedule-${ymPrefix}.ics`,
        new Blob([content], { type: 'text/calendar;charset=utf-8' })
      );
      toast(`Exported ${count} event${count === 1 ? '' : 's'} to .ics`, 'ok');
    });

    const head = el('div', { class: 'cal-head' }, [
      el('div', {}, [
        el('span', { class: 'micro-upper', text: 'Unified Financial Schedule · Salaries, EMIs, Taxes & Renewals' }),
        el('h2', { id: 'calDialogTitle', class: 'cal-title', text: `${FULL_MONTHS[viewMonth]} ${viewYear}` })
      ]),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;' }, [exportBtn, closeBtn])
    ]);

    // Smart Alert Strip
    const alertStrip = el('div', { class: 'cal-alert-strip' }, [
      el('span', {
        class: `alert-chip ${overdueList.length ? 'is-overdue' : 'is-clear'}`,
        text: overdueList.length
          ? `Overdue: ${overdueList.length} (${money(overdueList.reduce((s, e) => s + e.amount, 0))})`
          : '0 Overdue'
      }),
      el('span', {
        class: `alert-chip ${dueTodayList.length ? 'is-today' : 'is-clear'}`,
        text: dueTodayList.length
          ? `Due Today: ${dueTodayList.length} (${money(dueTodayList.reduce((s, e) => s + e.amount, 0))})`
          : '0 Due Today'
      }),
      el('span', {
        class: `alert-chip ${upcomingList.length ? 'is-upcoming' : 'is-clear'}`,
        text: `Upcoming: ${upcomingList.length} (${money(upcomingList.reduce((s, e) => s + e.amount, 0))})`
      })
    ]);

    // Toolbar
    const prevBtn = el('button', { type: 'button', class: 'btn sm ghost', text: '‹ Prev' });
    prevBtn.addEventListener('click', () => {
      viewMonth--;
      if (viewMonth < 0) {
        viewMonth = 11;
        viewYear--;
      }
      selectedDate = isoDate(viewYear, viewMonth, 1);
      render();
    });

    const todayBtn = el('button', { type: 'button', class: 'btn sm ghost', text: 'Today' });
    todayBtn.addEventListener('click', () => {
      viewYear = todayObj.getFullYear();
      viewMonth = todayObj.getMonth();
      selectedDate = todayIso;
      render();
    });

    const latestBtn = el('button', { type: 'button', class: 'btn sm ghost', text: 'Latest Active' });
    latestBtn.addEventListener('click', () => {
      pickDefaultDateFromData(rows, profile);
      render();
    });

    const nextBtn = el('button', { type: 'button', class: 'btn sm ghost', text: 'Next ›' });
    nextBtn.addEventListener('click', () => {
      viewMonth++;
      if (viewMonth > 11) {
        viewMonth = 0;
        viewYear++;
      }
      selectedDate = isoDate(viewYear, viewMonth, 1);
      render();
    });

    const filterGroup = el('div', { class: 'seg-group', role: 'group', 'aria-label': 'Filter calendar events' });
    (
      [
        ['all', 'All'],
        ['alerts', 'Due / Alerts'],
        ['income', 'Incomes'],
        ['loan', 'EMIs & Cards'],
        ['tax-insurance', 'Tax & Ins.']
      ] as const
    ).forEach(([id, label]) => {
      const b = el('button', {
        type: 'button',
        class: 'seg-btn',
        'aria-pressed': String(kindFilter === id),
        text: label
      });
      b.addEventListener('click', () => {
        kindFilter = id;
        render();
      });
      filterGroup.appendChild(b);
    });

    const summary = el('div', { class: 'cal-summary' }, [
      el('span', { class: 'cal-stat' }, [
        document.createTextNode('Month Credits '),
        el('strong', { class: 'num is-green', text: money(inflowSum) })
      ]),
      el('span', { class: 'cal-stat' }, [
        document.createTextNode('Scheduled Outflows '),
        el('strong', { class: 'num', text: money(outflowSum) })
      ])
    ]);

    const toolbar = el('div', { class: 'cal-toolbar' }, [
      el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;' }, [prevBtn, todayBtn, latestBtn, nextBtn]),
      filterGroup,
      summary
    ]);

    const weekdaysRow = el(
      'div',
      { class: 'cal-weekdays', 'aria-hidden': 'true' },
      WEEKDAYS.map(w => el('div', { class: 'cal-weekday', text: w }))
    );

    const grid = el('div', { class: 'cal-grid', role: 'grid', 'aria-label': `${FULL_MONTHS[viewMonth]} ${viewYear}` });

    for (let i = 0; i < totalCells; i++) {
      let cellY = viewYear;
      let cellM = viewMonth;
      let cellD = i - firstDow + 1;
      let isOutside = false;

      if (cellD < 1) {
        isOutside = true;
        cellM--;
        if (cellM < 0) {
          cellM = 11;
          cellY--;
        }
        cellD = prevMonthDays + cellD;
      } else if (cellD > daysInMonth) {
        isOutside = true;
        cellD -= daysInMonth;
        cellM++;
        if (cellM > 11) {
          cellM = 0;
          cellY++;
        }
      }

      const cellIso = isoDate(cellY, cellM, cellD);
      const dayEvents = dayMap.get(cellIso) || [];
      const isToday = cellIso === todayIso;
      const isSelected = cellIso === selectedDate;

      const cellBtn = el('button', {
        type: 'button',
        class: `cal-cell${isOutside ? ' is-outside' : ''}${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}`,
        'aria-pressed': String(isSelected),
        'aria-label': `${cellD} ${MONTH_NAMES[cellM]} ${cellY}, ${dayEvents.length} events`
      });

      const dayTop = el('div', { class: 'cal-cell-top' }, [
        el('span', { class: 'cal-day-num num', text: String(cellD) }),
        dayEvents.length
          ? el('span', { class: 'cal-day-cnt num', text: String(dayEvents.length) })
          : null
      ]);
      cellBtn.appendChild(dayTop);

      if (dayEvents.length) {
        const chips = el('div', { class: 'cal-chips' });
        dayEvents.slice(0, 3).forEach(ev => {
          chips.appendChild(
            el('span', {
              class: `cal-chip ${toneClass(ev)}`,
              title: `${ev.title}: ${money(ev.amount)} (${ev.detail})`,
              text: `${ev.title.slice(0, 11)} · ${compactMoney(ev.amount)}`
            })
          );
        });
        if (dayEvents.length > 3) {
          chips.appendChild(
            el('span', {
              class: 'cal-chip-more mono-meta',
              text: `+${dayEvents.length - 3} more`
            })
          );
        }
        cellBtn.appendChild(chips);
      }

      cellBtn.addEventListener('click', () => {
        selectedDate = cellIso;
        if (isOutside) {
          viewYear = cellY;
          viewMonth = cellM;
        }
        render();
      });

      grid.appendChild(cellBtn);
    }

    const selParsed = parseYm(selectedDate);
    const selDayEvents = visibleEvents.filter(ev => ev.date === selectedDate);
    const selLabel = selParsed ? fmtDate(selectedDate) || selectedDate : selectedDate;

    const addForDayBtn = el('button', {
      type: 'button',
      class: 'btn sm',
      text: `+ Add on ${selLabel}`
    });
    if (!Perm.can('edit')) addForDayBtn.disabled = true;
    addForDayBtn.addEventListener('click', () => {
      const targetDate = selectedDate;
      close();
      opts.onAddForDate(targetDate);
    });

    const agendaHead = el('div', { class: 'cal-agenda-head' }, [
      el('div', {}, [
        el('span', { class: 'micro-upper', text: 'Selected Day Agenda' }),
        el('h3', { class: 'cal-agenda-title', text: selLabel })
      ]),
      addForDayBtn
    ]);

    const agendaList = el('div', { class: 'cal-agenda-list' });
    if (!selDayEvents.length) {
      agendaList.appendChild(
        el('p', {
          class: 'mono-meta',
          text: `No salary credits, recurring expenses, EMIs, or bills scheduled on ${selLabel}.`
        })
      );
    } else {
      selDayEvents.forEach(ev => {
        const isInc = ev.kind === 'income';
        const actions = el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;' });

        if (ev.txRow && isDue(ev.txRow) && Perm.can('edit')) {
          const payBtn = el('button', { type: 'button', class: 'btn sm', text: 'Mark paid' });
          payBtn.addEventListener('click', () => {
            opts.onMarkPaid(ev.txRow!.id);
            render();
          });
          actions.appendChild(payBtn);
        }

        if (
          ev.source === 'obligation' &&
          ev.alertState !== 'paid' &&
          opts.onMarkObligationPaid &&
          Perm.can('edit')
        ) {
          const obId = ev.id.replace(/^obl-/, '');
          const payObBtn = el('button', { type: 'button', class: 'btn sm', text: 'Mark paid' });
          payObBtn.addEventListener('click', () => {
            opts.onMarkObligationPaid!(obId);
            render();
          });
          actions.appendChild(payObBtn);
        }

        if (ev.txRow && Perm.can('edit')) {
          const editBtn = el('button', { type: 'button', class: 'btn sm ghost', text: 'Edit' });
          editBtn.addEventListener('click', () => {
            close();
            opts.onEditRow(ev.txRow!);
          });
          actions.appendChild(editBtn);
        }

        const badge =
          ev.alertState === 'overdue'
            ? el('span', { class: 'alert-chip is-overdue', text: 'Overdue' })
            : ev.alertState === 'due-today'
              ? el('span', { class: 'alert-chip is-today', text: 'Due Today' })
              : ev.alertState === 'upcoming'
                ? el('span', { class: 'alert-chip is-upcoming', text: 'Upcoming' })
                : null;

        agendaList.appendChild(
          el('div', { class: `cal-agenda-item ${toneClass(ev)}` }, [
            el('div', { style: 'min-width:0;' }, [
              el('div', { style: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;' }, [
                el('span', { class: 'feed-title', text: ev.title }),
                badge
              ]),
              el('div', {
                class: 'mono-meta',
                text: `${ev.category} · ${ev.detail}`
              })
            ]),
            el('div', { style: 'display:flex;align-items:center;gap:10px;flex-shrink:0;' }, [
              el('span', {
                class: `num feed-amt ${isInc ? 'is-green' : ev.alertState === 'overdue' ? 'is-brick' : ''}`,
                text: `${isInc ? '+' : ''}${money(ev.amount)}`
              }),
              actions
            ])
          ])
        );
      });
    }

    const legend = el('div', { class: 'cal-legend' }, [
      el('span', { class: 'cal-legend-item' }, [el('i', { class: 'cal-dot is-income' }), document.createTextNode('Income / Salary')]),
      el('span', { class: 'cal-legend-item' }, [el('i', { class: 'cal-dot is-expense' }), document.createTextNode('Expense / Sub')]),
      el('span', { class: 'cal-legend-item' }, [el('i', { class: 'cal-dot is-loan' }), document.createTextNode('EMI / Card')]),
      el('span', { class: 'cal-legend-item' }, [el('i', { class: 'cal-dot is-tax' }), document.createTextNode('Tax / Insurance')]),
      el('span', { class: 'cal-legend-item' }, [el('i', { class: 'cal-dot is-due' }), document.createTextNode('Upcoming / Due Today')]),
      el('span', { class: 'cal-legend-item' }, [el('i', { class: 'cal-dot is-overdue' }), document.createTextNode('Overdue')])
    ]);

    const bodyLayout = el('div', { class: 'cal-layout' }, [
      el('div', { class: 'cal-main' }, [weekdaysRow, grid, legend]),
      el('div', { class: 'cal-agenda' }, [agendaHead, agendaList])
    ]);

    dlg.appendChild(head);
    dlg.appendChild(alertStrip);
    dlg.appendChild(toolbar);
    dlg.appendChild(bodyLayout);
  }

  function syncExpanded(openState: boolean) {
    if (bandBtn) bandBtn.setAttribute('aria-expanded', String(openState));
  }

  function open(dateStr?: string) {
    if (!dlg) return;
    if (!initializedView) {
      pickDefaultDateFromData(opts.getRows(), opts.getProfile());
      initializedView = true;
    }
    if (dateStr) {
      const p = parseYm(dateStr);
      if (p) {
        viewYear = p.y;
        viewMonth = p.m0;
        selectedDate = dateStr;
      }
    }
    render();
    if (!dlg.open) dlg.showModal();
    syncExpanded(true);
  }

  function close() {
    if (!dlg) return;
    if (dlg.open) dlg.close();
    syncExpanded(false);
  }

  function toggle() {
    if (dlg?.open) close();
    else open();
  }

  function refresh() {
    if (dlg?.open) render();
  }

  [bandBtn, drawerBtn, settingsBtn, overviewBtn, obligBtn].forEach(trigger => {
    trigger?.addEventListener('click', () => open());
  });

  dlg?.addEventListener('close', () => syncExpanded(false));
  dlg?.addEventListener('click', e => {
    if (e.target === dlg) close();
  });

  return {
    open,
    close,
    toggle,
    isOpen: () => !!dlg?.open,
    refresh
  };
}
