import * as XLSX from 'xlsx';
import { compareLoanStrategies, isLoanObligation, isTaxObligation } from './intelligence';
import type {
  AdvisorRecommendation,
  FinancialProfile,
  FinancialSummary,
  Transaction
} from './types';
import { download, groupBy, isDue, money, num, signed, totals } from './utils';

export interface ComprehensiveReportData {
  householdName: string;
  generatedAt: string;
  fromDate: string;
  toDate: string;
  prevFromDate: string;
  prevToDate: string;
  periodRows: Transaction[];
  prevRows: Transaction[];
  incomeSummary: {
    periodActual: number;
    prevActual: number;
    momDeltaPct: number | null;
    profileMonthly: number;
    profileAnnual: number;
    sources: Array<{ name: string; kind: string; frequency: string; amount: number; source: string }>;
  };
  expenseBreakdown: Array<{ category: string; planned: number; actual: number; variance: number; sharePct: number }>;
  fixedVsVariable: {
    fixedMonthly: number;
    variableMonthly: number;
    essentialMonthly: number;
    fixedPct: number;
    variablePct: number;
  };
  taxDeductionsSummary: {
    configured: boolean;
    regime: string;
    grossIncome: number;
    totalTaxLiability: number;
    alreadyPaid: number;
    remainingPayable: number;
    monthlyReserve: number;
    note: string;
  };
  loansAndDebtSummary: {
    monthlyEmi: number;
    dtiPct: number;
    totalBalance: number;
    ledgerPaid: number;
    ledgerDue: number;
    strategyNote: string;
  };
  upcomingPayments: Array<{ name: string; dueDate: string; amountDue: number; status: string; source: string }>;
  savingsProgress: {
    periodSaved: number;
    periodTarget: number;
    savingsRatePct: number;
    instruments: Array<{ name: string; member: string; target: number; saved: number }>;
  };
  cashFlowAndSurplus: {
    periodInflow: number;
    periodOutflow: number;
    periodBalance: number;
    prevBalance: number;
    profileMonthlyCashFlow: number;
    disposableMonthly: number;
  };
  insights: AdvisorRecommendation[];
  summary: FinancialSummary;
  profile: FinancialProfile;
}

function shiftIsoDays(iso: string, deltaDays: number): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export function buildComprehensiveReportData(
  householdName: string,
  profile: FinancialProfile,
  summary: FinancialSummary,
  insights: AdvisorRecommendation[],
  allRows: Transaction[],
  fromDate: string,
  toDate: string
): ComprehensiveReportData {
  const fIso = fromDate || '1900-01-01';
  const tIso = toDate || '2999-12-31';

  const periodRows = allRows.filter(r => {
    const d = (r.date || '').slice(0, 10);
    return (!fIso || d >= fIso) && (!tIso || d <= tIso);
  });

  // Compute equal-length preceding comparison period
  const startMs = new Date(fIso + 'T00:00:00').getTime();
  const endMs = new Date(tIso + 'T00:00:00').getTime();
  const spanDays = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? Math.max(1, Math.round((endMs - startMs) / 86400000) + 1)
    : 30;
  const prevToDate = shiftIsoDays(fIso, -1);
  const prevFromDate = shiftIsoDays(prevToDate, -(spanDays - 1));

  const prevRows = allRows.filter(r => {
    const d = (r.date || '').slice(0, 10);
    return d >= prevFromDate && d <= prevToDate;
  });

  const pt = totals(periodRows);
  const prt = totals(prevRows);

  const momDeltaPct =
    prevRows.length > 0 && prt.income > 0 ? ((pt.income - prt.income) / prt.income) * 100 : null;

  const expRows = periodRows.filter(r => r.type.toUpperCase() === 'EXPENSE');
  const expGroups = groupBy(expRows, r => r.category).sort((a, b) => b.spent - a.spent);
  const expTotal = Math.max(1, pt.expense);
  const expenseBreakdown = expGroups.map(g => ({
    category: g.key,
    planned: g.budget,
    actual: g.spent,
    variance: g.variance,
    sharePct: (g.spent / expTotal) * 100
  }));

  const fvTotal = Math.max(1, summary.totalMonthlyExpenses);
  const fixedPct = (summary.fixedMonthlyExpenses / fvTotal) * 100;
  const variablePct = (summary.variableMonthlyExpenses / fvTotal) * 100;

  const loanStrat = compareLoanStrategies(profile, periodRows);
  const upcomingPayments: ComprehensiveReportData['upcomingPayments'] = [];
  profile.obligations
    .filter(o => o.status !== 'Paid')
    .forEach(o => {
      upcomingPayments.push({
        name: o.name,
        dueDate: o.dueDate || '—',
        amountDue: num(o.amountDue) || num(o.totalAmount),
        status: o.status,
        source: o.entrySource
      });
    });
  if (!upcomingPayments.length) {
    periodRows.filter(isDue).forEach(r => {
      upcomingPayments.push({
        name: `${r.desc} (${r.member})`,
        dueDate: r.due || r.date,
        amountDue: num(r.budget),
        status: r.status,
        source: 'confirmed'
      });
    });
  }

  const savRows = periodRows.filter(r => r.type.toUpperCase() === 'SAVING');
  const savT = totals(savRows);

  return {
    householdName,
    generatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    fromDate: fIso,
    toDate: tIso,
    prevFromDate,
    prevToDate,
    periodRows,
    prevRows,
    incomeSummary: {
      periodActual: pt.income,
      prevActual: prt.income,
      momDeltaPct,
      profileMonthly: summary.monthlyIncome,
      profileAnnual: summary.annualIncome,
      sources: profile.incomes.map(i => ({
        name: i.name,
        kind: i.kind,
        frequency: i.frequency,
        amount: i.amount,
        source: i.isEstimate ? 'Estimated' : 'Confirmed'
      }))
    },
    expenseBreakdown,
    fixedVsVariable: {
      fixedMonthly: summary.fixedMonthlyExpenses,
      variableMonthly: summary.variableMonthlyExpenses,
      essentialMonthly: summary.essentialMonthlyExpenses,
      fixedPct,
      variablePct
    },
    taxDeductionsSummary: {
      configured: summary.tax.configured,
      regime: summary.tax.configured ? `${summary.tax.regime.toUpperCase()} (${profile.tax.assessmentYear})` : 'Not Configured',
      grossIncome: summary.tax.grossIncome,
      totalTaxLiability: summary.tax.totalTaxLiability,
      alreadyPaid: summary.tax.alreadyPaidTdsAdvance,
      remainingPayable: summary.tax.remainingTaxPayable,
      monthlyReserve: summary.tax.monthlyTaxReserve,
      note: summary.tax.methodologyNote
    },
    loansAndDebtSummary: {
      monthlyEmi: summary.monthlyEmiPayments,
      dtiPct: summary.dtiPct,
      totalBalance: summary.totalLiabilities,
      ledgerPaid: pt.loan,
      ledgerDue: totals(periodRows.filter(r => r.type.toUpperCase() === 'LOAN')).due,
      strategyNote: loanStrat && loanStrat.totalBalance > 0
        ? `Avalanche order: ${loanStrat.avalancheOrder.join(' -> ')} (saves ${money(loanStrat.interestSavedWithAvalanche)})`
        : 'Add remaining loan balances & interest rates in 03 Obligations to simulate Avalanche vs Snowball.'
    },
    upcomingPayments,
    savingsProgress: {
      periodSaved: savT.spent,
      periodTarget: savT.budget,
      savingsRatePct: pt.income > 0 ? (savT.spent / pt.income) * 100 : summary.savingsRatePct,
      instruments: savRows.map(r => ({
        name: r.desc,
        member: r.member,
        target: r.budget,
        saved: r.spent
      }))
    },
    cashFlowAndSurplus: {
      periodInflow: pt.income,
      periodOutflow: pt.outflow,
      periodBalance: pt.balance,
      prevBalance: prt.balance,
      profileMonthlyCashFlow: summary.monthlyCashFlow,
      disposableMonthly: summary.disposableIncomeMonthly
    },
    insights,
    summary,
    profile
  };
}

/* ============================================================
   MULTI-SHEET EXCEL WORKBOOK EXPORT (.xlsx)
   ============================================================ */
export function exportFinancialReportExcel(report: ComprehensiveReportData): void {
  const wb = XLSX.utils.book_new();

  const summaryRows = [
    ['H ∈ M Household Financial Report', report.householdName],
    ['Date Range', `${report.fromDate} to ${report.toDate}`],
    ['Comparison Range', `${report.prevFromDate} to ${report.prevToDate} (${report.prevRows.length} prior records)`],
    ['Generated At', report.generatedAt],
    [''],
    ['Metric', 'Value (₹ / %)'],
    ['Period Actual Income', report.incomeSummary.periodActual],
    ['Period Actual Outflow', report.cashFlowAndSurplus.periodOutflow],
    ['Period Net Balance', report.cashFlowAndSurplus.periodBalance],
    ['Normalized Monthly Income', Math.round(report.summary.monthlyIncome)],
    ['Normalized Annual Income', Math.round(report.summary.annualIncome)],
    ['Monthly Fixed Expenses', Math.round(report.fixedVsVariable.fixedMonthly)],
    ['Monthly Variable Expenses', Math.round(report.fixedVsVariable.variableMonthly)],
    ['Monthly EMI & Loan Payments', Math.round(report.loansAndDebtSummary.monthlyEmi)],
    ['Debt-to-Income Ratio (%)', Number(report.loansAndDebtSummary.dtiPct.toFixed(1))],
    ['Savings Rate (%)', Number(report.savingsProgress.savingsRatePct.toFixed(1))],
    ['Monthly Disposable Income', Math.round(report.cashFlowAndSurplus.disposableMonthly)],
    ['Monthly Net Cash Flow', Math.round(report.cashFlowAndSurplus.profileMonthlyCashFlow)],
    ['Tax Status', report.taxDeductionsSummary.regime],
    ['Remaining Tax Payable', Math.round(report.taxDeductionsSummary.remainingPayable)],
    ['Net Worth (if provided)', report.summary.netWorth !== null ? Math.round(report.summary.netWorth) : 'Not Entered']
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Executive Summary');

  const expRows = [
    ['Category', 'Planned (₹)', 'Actual (₹)', 'Variance (₹)', 'Share (%)'],
    ...report.expenseBreakdown.map(e => [e.category, e.planned, e.actual, e.variance, Number(e.sharePct.toFixed(1))])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expRows), 'Expense Breakdown');

  const oblRows = [
    ['Obligation / Bill', 'Kind', 'Frequency', 'Total (₹)', 'Due (₹)', 'Due Date', 'Status', 'Source'],
    ...report.profile.obligations.map(o => [
      o.name,
      isLoanObligation(o.kind) ? 'Loan/Liability' : isTaxObligation(o.kind) ? 'Tax' : 'Bill/Insurance',
      o.frequency,
      o.totalAmount,
      o.amountDue,
      o.dueDate,
      o.status,
      o.entrySource
    ])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(oblRows), 'Obligations & Tax');

  const projRows = [
    ['Month', 'Income (₹)', 'Fixed Exp (₹)', 'Variable Exp (₹)', 'EMIs (₹)', 'Tax/Renewals (₹)', 'Total Outflow (₹)', 'Net Cash Flow (₹)'],
    ...report.summary.projections.map(p => [
      p.label,
      p.income,
      p.fixedExpenses,
      p.variableExpenses,
      p.emisAndDebt,
      p.taxesAndRenewals,
      p.totalOutflow,
      p.netCashFlow
    ])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(projRows), '12-Month Forecast');

  const advRows = [
    ['Priority', 'Category', 'Recommendation', 'What Was Identified', 'Why It Matters', 'Suggested Action', 'Estimated Impact', 'Calculation Basis'],
    ...report.insights.map(i => [
      i.priority,
      i.category,
      i.title,
      i.identified,
      i.whyItMatters,
      i.suggestedAction,
      i.estimatedImpact,
      i.basis
    ])
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(advRows), 'AI Advisor Insights');

  const txRows = report.periodRows.map(r => ({
    ID: r.id,
    Date: r.date,
    Member: r.member,
    Type: r.type,
    Category: r.category,
    Description: r.desc,
    'Payment Method': r.pm,
    Budget: r.budget,
    'Actually Spent': r.spent,
    Status: r.status
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txRows), 'Transactions');

  XLSX.writeFile(wb, `hem-financial-report-${report.fromDate}-to-${report.toDate}.xlsx`);
}

/* ============================================================
   VALID MULTI-PAGE BINARY PDF GENERATOR (ZERO window.open)
   Uses Rs. ASCII normalization for crisp Helvetica WinAnsi PDF text
   ============================================================ */
function pdfSafeText(s: string): string {
  return String(s || '')
    .replace(/₹/g, 'Rs.')
    .replace(/∈/g, 'e')
    .replace(/−/g, '-')
    .replace(/–|—/g, '-')
    .replace(/·/g, '|')
    .replace(/[^\x20-\x7E]/g, ' ');
}

function pdfEscape(s: string): string {
  return pdfSafeText(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapLines(text: string, maxChars: number): string[] {
  const words = pdfSafeText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

interface PdfLine {
  text: string;
  size: number;
  bold?: boolean;
  gapBefore?: number;
}

function buildPdfBytes(lines: PdfLine[]): Uint8Array {
  const pageW = 595;
  const pageH = 842;
  const marginX = 44;
  const topY = pageH - 48;
  const bottomY = 48;

  const pages: string[][] = [[]];
  let y = topY;

  for (const item of lines) {
    const step = item.size + 5 + (item.gapBefore || 0);
    if (y - step < bottomY) {
      pages.push([]);
      y = topY;
    } else if (item.gapBefore) {
      y -= item.gapBefore;
    }
    const fontKey = item.bold ? '/F2' : '/F1';
    const cmd = `BT ${fontKey} ${item.size} Tf ${marginX} ${y.toFixed(1)} Td (${pdfEscape(item.text)}) Tj ET`;
    pages[pages.length - 1].push(cmd);
    y -= item.size + 4.5;
  }

  // Build PDF 1.4 objects
  // 1: Catalog, 2: Pages, 3: Font Helvetica, 4: Font Helvetica-Bold, then pairs of (Page, Content)
  const objects: string[] = [];
  const pageObjNums: number[] = [];

  pages.forEach((_, idx) => {
    pageObjNums.push(5 + idx * 2);
  });

  objects.push('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n');
  objects.push(`2 0 obj << /Type /Pages /Kids [${pageObjNums.map(n => `${n} 0 R`).join(' ')}] /Count ${pages.length} >> endobj\n`);
  objects.push('3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n');
  objects.push('4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj\n');

  pages.forEach((cmds, idx) => {
    const pageId = 5 + idx * 2;
    const contentId = pageId + 1;
    const streamData = cmds.join('\n');
    objects.push(
      `${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >> endobj\n`
    );
    objects.push(
      `${contentId} 0 obj << /Length ${streamData.length} >> stream\n${streamData}\nendstream endobj\n`
    );
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

export function exportFinancialReportPdf(report: ComprehensiveReportData): void {
  const lines: PdfLine[] = [];
  const addHeading = (text: string) => lines.push({ text, size: 12, bold: true, gapBefore: 10 });
  const addBody = (text: string, bold = false) => {
    wrapLines(text, 88).forEach(w => lines.push({ text: w, size: 9.5, bold }));
  };

  lines.push({ text: `H E M HOUSEHOLD EXPENSE MANAGER - FINANCIAL REPORT`, size: 14, bold: true });
  lines.push({
    text: `Household: ${report.householdName}  |  Period: ${report.fromDate} to ${report.toDate}  |  Generated: ${report.generatedAt}`,
    size: 9
  });

  addHeading('1. EXECUTIVE FINANCIAL OVERVIEW & CASH FLOW');
  addBody(`Period Actual Income: ${money(report.incomeSummary.periodActual)} | Period Outflow: ${money(report.cashFlowAndSurplus.periodOutflow)} | Net Balance: ${signed(report.cashFlowAndSurplus.periodBalance)}`, true);
  addBody(`Normalized Monthly Income: ${money(report.summary.monthlyIncome)} (Annualized: ${money(report.summary.annualIncome)})`);
  addBody(`Monthly Cash Flow: ${signed(report.cashFlowAndSurplus.profileMonthlyCashFlow)} | Monthly Disposable Income: ${signed(report.cashFlowAndSurplus.disposableMonthly)}`);
  addBody(`Period-over-Period Comparison (${report.prevFromDate} to ${report.prevToDate}): ${report.prevRows.length ? `Prior Balance ${signed(report.cashFlowAndSurplus.prevBalance)}, Income Change ${report.incomeSummary.momDeltaPct !== null ? report.incomeSummary.momDeltaPct.toFixed(1) + '%' : 'N/A'}` : 'No records in comparison range.'}`);

  addHeading('2. FIXED VS VARIABLE EXPENSES & CATEGORY BREAKDOWN');
  addBody(`Fixed Monthly: ${money(report.fixedVsVariable.fixedMonthly)} (${report.fixedVsVariable.fixedPct.toFixed(1)}%) | Variable Monthly: ${money(report.fixedVsVariable.variableMonthly)} (${report.fixedVsVariable.variablePct.toFixed(1)}%) | Essential Baseline: ${money(report.fixedVsVariable.essentialMonthly)}/mo`);
  report.expenseBreakdown.slice(0, 10).forEach(c => {
    addBody(`- ${c.category}: Planned ${money(c.planned)}, Actual ${money(c.actual)}, Variance ${signed(c.variance)} (${c.sharePct.toFixed(1)}%)`);
  });

  addHeading('3. TAX & DEDUCTIONS SUMMARY');
  addBody(`Regime Status: ${report.taxDeductionsSummary.regime} | Total Tax Liability: ${money(report.taxDeductionsSummary.totalTaxLiability)} | Paid (TDS/Advance): ${money(report.taxDeductionsSummary.alreadyPaid)} | Remaining: ${money(report.taxDeductionsSummary.remainingPayable)}`);
  addBody(report.taxDeductionsSummary.note);

  addHeading('4. LOANS, DEBT-TO-INCOME & REPAYMENT STRATEGY');
  addBody(`Monthly EMI Obligations: ${money(report.loansAndDebtSummary.monthlyEmi)} | DTI Ratio: ${report.loansAndDebtSummary.dtiPct.toFixed(1)}% | Ledger Loan Paid: ${money(report.loansAndDebtSummary.ledgerPaid)}`);
  addBody(`Strategy: ${report.loansAndDebtSummary.strategyNote}`);

  addHeading('5. UPCOMING & OVERDUE PAYMENT SCHEDULE');
  if (!report.upcomingPayments.length) {
    addBody('No unpaid or upcoming obligations pending.');
  } else {
    report.upcomingPayments.slice(0, 12).forEach(u => {
      addBody(`- ${u.dueDate} | ${u.name} | ${money(u.amountDue)} | Status: ${u.status} (${u.source})`);
    });
  }

  addHeading('6. SAVINGS PROGRESS & NET WORTH');
  addBody(`Period Savings: ${money(report.savingsProgress.periodSaved)} (Target: ${money(report.savingsProgress.periodTarget)}) | Savings Rate: ${report.savingsProgress.savingsRatePct.toFixed(1)}%`);
  addBody(report.summary.netWorth !== null
    ? `Net Worth: ${signed(report.summary.netWorth)} (Assets ${money(report.summary.totalAssets)} - Liabilities ${money(report.summary.totalLiabilities)})`
    : 'Net Worth: Enter Assets and Liabilities in 02 My Financial Profile to compute.');

  addHeading('7. AI FINANCIAL ADVISOR ACTION PLAN');
  report.insights.forEach((ins, idx) => {
    addBody(`${idx + 1}. [${ins.priority.toUpperCase()}] ${ins.title} (${ins.category})`, true);
    addBody(`Identified: ${ins.identified}`);
    addBody(`Action: ${ins.suggestedAction} | Impact: ${ins.estimatedImpact}`);
  });

  const pdfBytes = buildPdfBytes(lines);
  download(
    `hem-financial-report-${report.fromDate}-to-${report.toDate}.pdf`,
    new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' })
  );
}
