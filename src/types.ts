export type Role = 'admin' | 'editor' | 'viewer';

export type ThemeId =
  | 'hem-ledger'
  | 'google-calendar'
  | 'lavender-press'
  | 'newsprint'
  | 'night-edition'
  | 'gazette-mono'
  | 'swiss-poster'
  | 'forest-ochre'
  | 'riso-pastel';

export interface ThemeDef {
  id: ThemeId;
  name: string;
  desc: string;
  badge?: string;
}

export interface Transaction {
  id: number;
  date: string;
  member: string;
  type: string;
  category: string;
  desc: string;
  pm: string;
  budget: number;
  spent: number;
  status: string;
  due?: string;
  paidOn?: string;
}

export interface Totals {
  income: number;
  expense: number;
  loan: number;
  saving: number;
  budget: number;
  spent: number;
  paid: number;
  due: number;
  count: number;
  incomeBudget: number;
  outflow: number;
  balance: number;
  variance: number;
  rawBudget: number;
  rawSpent: number;
}

export interface GroupedTotals extends Totals {
  key: string;
  rows: Transaction[];
}

export interface FilterState {
  year: string;
  month: string;
  member: string;
  type: string;
  category: string;
  pm: string;
  status: string;
}

export interface Member {
  email: string;
  role: Role;
  status: 'active' | 'invited';
  name: string;
  uid?: string;
  addedAt?: number;
}

export interface Household {
  id: string;
  name: string;
  owner: string;
  created?: number;
  members?: Member[];
}

export interface UserProfile {
  email: string;
  name: string;
  role: Role;
  household: {
    id: string;
    name: string;
    owner: string;
  };
  members: Member[];
  recoveryKey?: string;
}

export type ReportId =
  | 'monthly'
  | 'member'
  | 'type'
  | 'category'
  | 'pm'
  | 'status'
  | 'desc'
  | 'loan'
  | 'detail';

export interface SectionDef {
  id: string;
  num: string;
  short: string;
  title: string;
  folioL: string;
  folioR: string;
}

export interface TooltipData {
  cat?: string;
  val?: string;
  sub?: string;
}

/* ============================================================
   PERSONAL FINANCE INTELLIGENCE TYPES
   ============================================================ */
export type IncomeKind =
  | 'monthly-salary'
  | 'annual-salary'
  | 'business'
  | 'freelance'
  | 'rental'
  | 'investment-interest'
  | 'bonus'
  | 'one-time';

export type IncomeFrequency = 'monthly' | 'quarterly' | 'annual' | 'one-time';

export interface IncomeSource {
  id: string;
  name: string;
  kind: IncomeKind;
  amount: number;
  frequency: IncomeFrequency;
  payDay?: number;
  date?: string;
  member?: string;
  isEstimate?: boolean;
  notes?: string;
}

export type ExpenseCategoryKind =
  | 'Rent / Maintenance'
  | 'Groceries & Food'
  | 'Utilities (Elec/Water/Net)'
  | 'Transport & Fuel'
  | 'Education Fees'
  | 'Medical'
  | 'Shopping & Entertainment'
  | 'Subscriptions'
  | 'Family Expenses'
  | 'Other';

export type ExpenseFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurringExpense {
  id: string;
  name: string;
  category: ExpenseCategoryKind;
  kind: 'fixed' | 'variable';
  amount: number;
  frequency: ExpenseFrequency;
  dueDay?: number;
  essential: boolean;
  notes?: string;
}

export type ObligationKind =
  | 'income-tax'
  | 'advance-tax'
  | 'tds'
  | 'gst'
  | 'home-loan-emi'
  | 'personal-loan-emi'
  | 'vehicle-loan-emi'
  | 'education-loan-emi'
  | 'credit-card'
  | 'insurance-premium'
  | 'other-liability';

export type ObligationStatus = 'Paid' | 'Upcoming' | 'Overdue' | 'Partially Paid';
export type EntryOrigin = 'user-entered' | 'estimated' | 'confirmed';

export interface ObligationItem {
  id: string;
  name: string;
  kind: ObligationKind;
  totalAmount: number;
  amountDue: number;
  dueDate: string;
  frequency: 'monthly' | 'quarterly' | 'yearly' | 'one-time';
  remainingBalance?: number;
  interestRate?: number;
  status: ObligationStatus;
  entrySource: EntryOrigin;
  notes?: string;
}

export type TaxRegime = 'new' | 'old';

export interface TaxSettings {
  configured: boolean;
  assessmentYear: string;
  regime: TaxRegime;
  annualGrossIncome: number | null;
  deductions80C: number;
  deductions80D: number;
  hraExemption: number;
  otherExemptions: number;
  tdsAlreadyDeducted: number;
  advanceTaxPaid: number;
  gstApplicable: boolean;
  gstMonthlyEstimated: number;
}

export interface TaxBreakdown {
  configured: boolean;
  regime: TaxRegime;
  grossIncome: number;
  standardDeduction: number;
  eligibleDeductions: number;
  taxableIncome: number;
  slabTax: number;
  cess: number;
  totalIncomeTax: number;
  annualGst: number;
  totalTaxLiability: number;
  alreadyPaidTdsAdvance: number;
  remainingTaxPayable: number;
  monthlyTaxReserve: number;
  effectiveRatePct: number;
  methodologyNote: string;
}

export type AssetKind =
  | 'Cash & Bank'
  | 'Mutual Funds & Equity'
  | 'Fixed Deposits & RD'
  | 'Gold & Jewellery'
  | 'Real Estate'
  | 'PF / PPF / NPS'
  | 'Other Asset';

export type LiabilityKind =
  | 'Home Loan'
  | 'Personal Loan'
  | 'Vehicle Loan'
  | 'Education Loan'
  | 'Credit Card Balance'
  | 'Other Liability';

export interface AssetItem {
  id: string;
  name: string;
  kind: AssetKind;
  value: number;
}

export interface LiabilityItem {
  id: string;
  name: string;
  kind: LiabilityKind;
  balance: number;
  interestRate?: number;
}

export interface FinancialProfile {
  incomes: IncomeSource[];
  expenses: RecurringExpense[];
  obligations: ObligationItem[];
  tax: TaxSettings;
  assets: AssetItem[];
  liabilities: LiabilityItem[];
}

export type AdvisorPriority = 'High' | 'Medium' | 'Low';

export interface AdvisorRecommendation {
  id: string;
  title: string;
  category: string;
  priority: AdvisorPriority;
  identified: string;
  whyItMatters: string;
  suggestedAction: string;
  estimatedImpact: string;
  basis: string;
}

export interface LoanStrategyResult {
  loanCount: number;
  totalBalance: number;
  weightedApr: number;
  avalancheOrder: string[];
  snowballOrder: string[];
  avalancheMonths: number;
  snowballMonths: number;
  avalancheInterest: number;
  snowballInterest: number;
  interestSavedWithAvalanche: number;
  extraMonthlyTested: number;
}

export interface MonthlyProjection {
  ym: string;
  label: string;
  income: number;
  fixedExpenses: number;
  variableExpenses: number;
  emisAndDebt: number;
  taxesAndRenewals: number;
  totalOutflow: number;
  netCashFlow: number;
}

export interface FinancialSummary {
  monthlyIncome: number;
  annualIncome: number;
  confirmedMonthlyIncome: number;
  estimatedMonthlyIncome: number;
  fixedMonthlyExpenses: number;
  variableMonthlyExpenses: number;
  essentialMonthlyExpenses: number;
  totalMonthlyExpenses: number;
  annualExpenses: number;
  monthlyEmiPayments: number;
  annualEmiPayments: number;
  upcomingObligationsAmount: number;
  overdueObligationsAmount: number;
  upcomingObligationsCount: number;
  overdueObligationsCount: number;
  dueTodayCount: number;
  monthlySavingsActual: number;
  disposableIncomeMonthly: number;
  monthlyCashFlow: number;
  dtiPct: number;
  savingsRatePct: number;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number | null;
  hasAssetsOrLiabilities: boolean;
  liquidAssets: number;
  tax: TaxBreakdown;
  ledgerActualIncome: number;
  ledgerActualOutflow: number;
  ledgerActualExpense: number;
  ledgerActualLoan: number;
  ledgerActualSaving: number;
  profileIncomeConfigured: boolean;
  profileExpenseConfigured: boolean;
  projections: MonthlyProjection[];
  methodologyNotes: string[];
}

export interface CalendarUnifiedEvent {
  id: string;
  date: string;
  title: string;
  category: string;
  kind: 'income' | 'expense' | 'loan' | 'saving' | 'tax-insurance' | 'credit-card';
  amount: number;
  alertState: 'overdue' | 'due-today' | 'upcoming' | 'paid' | 'info';
  source: 'ledger' | 'profile-income' | 'profile-expense' | 'obligation';
  detail: string;
  txRow?: Transaction;
}

