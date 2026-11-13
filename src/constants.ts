import type { ReportId, Role, SectionDef, ThemeDef, Transaction } from './types';

export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const OUTFLOW = ['EXPENSE', 'LOAN', 'SAVING'];

export const ROLES: Record<Role, { name: string; blurb: string }> = {
  admin: { name: 'Admin', blurb: 'Everything, including people and resetting data.' },
  editor: { name: 'Editor', blurb: 'Add, change and delete transactions. Cannot manage people.' },
  viewer: { name: 'Viewer', blurb: 'Read and export only. Cannot change anything.' }
};

export const MAX_MEMBERS = 10;

export const THEMES: ThemeDef[] = [
  {
    id: 'hem-ledger',
    name: 'H ∈ M Ledger',
    desc: 'Original brand edition: deep oceanic teal masthead, mineral sage stock, marigold and brick.',
    badge: 'Original'
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    desc: 'Crisp Workspace ice canvas, Google Blue masthead, Basil green and Tomato alerts.',
    badge: 'Calendar'
  },
  {
    id: 'lavender-press',
    name: 'Lavender Press',
    desc: 'Editorial violet masthead, soft lilac stock, vermilion signal.'
  },
  {
    id: 'newsprint',
    name: 'Newsprint',
    desc: 'Warm uncoated stock, black masthead, cobalt and brick inks.'
  },
  {
    id: 'night-edition',
    name: 'Night Edition',
    desc: 'Charcoal pages and an amber masthead for after-hours reading.'
  },
  {
    id: 'gazette-mono',
    name: 'Gazette Mono',
    desc: 'Black on white; crisp greys carry the data, labels carry the meaning.'
  },
  {
    id: 'swiss-poster',
    name: 'Swiss Modern',
    desc: 'International Style red and black with cobalt counterpoint.'
  },
  {
    id: 'forest-ochre',
    name: 'Forest Finance',
    desc: 'Field-guide greens, ochre and rust on oat-coloured paper.'
  },
  {
    id: 'riso-pastel',
    name: 'Riso Pastel',
    desc: 'Two-drum risograph: bright rose and medium blue on warm cream.'
  }
];

export const SECTIONS: SectionDef[] = [
  { id: 's01', num: '01', short: 'Overview', title: 'Overview & Analysis', folioL: '002', folioR: '003' },
  { id: 'sProfile', num: '02', short: 'Profile', title: 'My Financial Profile', folioL: '004', folioR: '005' },
  { id: 'sOblig', num: '03', short: 'Obligations', title: 'Payments & Obligations', folioL: '006', folioR: '007' },
  { id: 'sAdvisor', num: '04', short: 'AI Advisor', title: 'AI Financial Advisor', folioL: '008', folioR: '009' },
  { id: 's02', num: '05', short: 'Income & Exp', title: 'Income & Expenses', folioL: '010', folioR: '011' },
  { id: 's03', num: '06', short: 'Budgets', title: 'Budget Intelligence', folioL: '012', folioR: '013' },
  { id: 's04', num: '07', short: 'Savings', title: 'Savings & Goals', folioL: '014', folioR: '015' },
  { id: 's05', num: '08', short: 'Loans', title: 'Loans & Liabilities', folioL: '016', folioR: '017' },
  { id: 's06', num: '09', short: 'Ledger', title: 'Transactions', folioL: '018', folioR: '019' },
  { id: 's07', num: '10', short: 'Reports', title: 'Reports & Analytics', folioL: '020', folioR: '021' },
  { id: 's08', num: '11', short: 'Members', title: 'Household Members', folioL: '022', folioR: '023' },
  { id: 's09', num: '12', short: 'Data', title: 'Data Management', folioL: '024', folioR: '025' },
  { id: 's10', num: '13', short: 'Settings', title: 'Settings', folioL: '026', folioR: '027' }
];

export const REPORTS: Array<{ id: ReportId; name: string; label: string }> = [
  { id: 'monthly', name: 'Monthly wise', label: 'Month' },
  { id: 'member', name: 'Member wise', label: 'Member' },
  { id: 'type', name: 'Type wise', label: 'Type' },
  { id: 'category', name: 'Category wise', label: 'Category' },
  { id: 'pm', name: 'Payment method', label: 'Payment method' },
  { id: 'status', name: 'Status wise', label: 'Status' },
  { id: 'desc', name: 'Description wise', label: 'Description' },
  { id: 'loan', name: 'Loan wise', label: 'Loan' },
  { id: 'detail', name: 'Transaction detail', label: 'Member' }
];

export const SEED: Transaction[] = [
  { id: 1, date: '2026-08-01', member: 'SYAM', type: 'INCOME', category: 'INCOME', desc: 'SALARY', pm: 'BANK', budget: 115000, spent: 113000, status: 'Not Necessary' },
  { id: 2, date: '2026-08-01', member: 'MADHURI', type: 'INCOME', category: 'INCOME', desc: 'SALARY', pm: 'BANK', budget: 40000, spent: 36000, status: 'Not Necessary' },
  { id: 3, date: '2026-08-01', member: 'CHINMAYI', type: 'INCOME', category: 'INCOME', desc: 'SALARY', pm: 'BANK', budget: 0, spent: 0, status: 'Not Necessary' },
  { id: 4, date: '2026-08-01', member: 'OTHER INCOME', type: 'INCOME', category: 'INCOME', desc: 'LIC/ RD/ M.FUND -', pm: 'BANK', budget: 0, spent: 0, status: 'Not Necessary' },
  { id: 5, date: '2026-08-01', member: 'OTHER INCOME', type: 'INCOME', category: 'INCOME', desc: 'LOAN AMTS', pm: 'BANK', budget: 0, spent: 0, status: 'Not Necessary' },
  { id: 6, date: '2026-08-01', member: 'OTHER INCOME', type: 'INCOME', category: 'INCOME', desc: 'LOAN FROM OTHERS', pm: 'BANK', budget: 0, spent: 0, status: 'Not Necessary' },
  { id: 7, date: '2026-08-01', member: 'MADHURI', type: 'EXPENSE', category: 'EXPENSE', desc: 'ON HAND MADHURI EXPENSES', pm: 'UPI', budget: 3000, spent: 5000, status: 'PAID' },
  { id: 8, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'EXPENSE', desc: 'MAINTENANCE - HOUSE', pm: 'UPI', budget: 1500, spent: 1500, status: 'PAID' },
  { id: 9, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'EXPENSE', desc: 'GROCERIES', pm: 'UPI', budget: 6000, spent: 2600, status: 'PAID' },
  { id: 10, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'EXPENSE', desc: 'RICE', pm: 'UPI', budget: 2000, spent: 2000, status: 'PAID' },
  { id: 11, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'EXPENSE', desc: 'MILK', pm: 'CASH', budget: 1500, spent: 1500, status: 'PAID' },
  { id: 12, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'EXPENSE', desc: 'CAR WASH', pm: 'CASH', budget: 600, spent: 600, status: 'PAID' },
  { id: 13, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'EXPENSE', desc: 'CLOTHS IRON', pm: 'CASH', budget: 1000, spent: 600, status: 'PAID' },
  { id: 14, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'EXPENSE', desc: 'GHEE', pm: 'UPI', budget: 600, spent: 300, status: 'PAID' },
  { id: 15, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'EXPENSE', desc: 'VEGITABLES', pm: 'UPI', budget: 1500, spent: 800, status: 'PAID' },
  { id: 16, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'EXPENSE', desc: 'GAS', pm: 'UPI', budget: 1000, spent: 1000, status: 'PAID' },
  { id: 17, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'EXPENSE', desc: 'FLOWERS', pm: 'UPI', budget: 1000, spent: 500, status: 'PAID' },
  { id: 18, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'EXPENSE', desc: 'FRUITS', pm: 'CASH', budget: 600, spent: 300, status: 'PAID' },
  { id: 19, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'EXPENSE', desc: 'CURRENT BILL', pm: 'UPI', budget: 3000, spent: 2860, status: 'PAID' },
  { id: 20, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'EXPENSE', desc: 'PETROL', pm: 'UPI', budget: 4000, spent: 6400, status: 'PAID' },
  { id: 21, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'EXPENSE', desc: 'MEDICAL EXPENSES', pm: 'CASH', budget: 4000, spent: 4900, status: 'PAID' },
  { id: 22, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'EXPENSE', desc: 'RENT', pm: 'OTHER', budget: 0, spent: 0, status: 'Not Necessary' },
  { id: 23, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'EXPENSE', desc: 'NEWS PAPER', pm: 'CASH', budget: 0, spent: 0, status: 'Not Necessary' },
  { id: 24, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'EXPENSE', desc: 'CABLE/ NET CHARGES', pm: 'UPI', budget: 1500, spent: 0, status: 'TO BE PAID' },
  { id: 25, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'OCCASIONAL EXPENSE', desc: 'OCCASSIONS /FESTIVAL EXP', pm: 'UPI', budget: 1000, spent: 0, status: 'PAID' },
  { id: 26, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'OCCASIONAL EXPENSE', desc: 'HOUSE REPAIRS', pm: 'UPI', budget: 0, spent: 0, status: 'PAID' },
  { id: 27, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'OCCASIONAL EXPENSE', desc: 'HOSPITALISATION EXPENSES', pm: 'UPI', budget: 0, spent: 0, status: 'Not Necessary' },
  { id: 28, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'OCCASIONAL EXPENSE', desc: 'ONLINE SHOPING', pm: 'UPI', budget: 0, spent: 0, status: 'Not Necessary' },
  { id: 29, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'OCCASIONAL EXPENSE', desc: 'HEALTH INSURANCE', pm: 'UPI', budget: 0, spent: 0, status: 'Not Necessary' },
  { id: 30, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'OCCASIONAL EXPENSE', desc: 'VEHICLE INSURANCE', pm: 'UPI', budget: 0, spent: 0, status: 'Not Necessary' },
  { id: 31, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'OCCASIONAL EXPENSE', desc: 'VEHICLES REPAIRS', pm: 'UPI', budget: 0, spent: 0, status: 'Not Necessary' },
  { id: 32, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'OCCASIONAL EXPENSE', desc: 'SHOES/ CHAPPALS PURCHASE', pm: 'UPI', budget: 0, spent: 0, status: 'Not Necessary' },
  { id: 33, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'OCCASIONAL EXPENSE', desc: 'CLOTH PURCHASE', pm: 'UPI', budget: 0, spent: 0, status: 'Not Necessary' },
  { id: 34, date: '2026-08-01', member: 'SYAM', type: 'EXPENSE', category: 'OCCASIONAL EXPENSE', desc: "TOUR'S EXPENSES", pm: 'UPI', budget: 0, spent: 0, status: 'Not Necessary' },
  { id: 35, date: '2026-08-01', member: 'MADHURI', type: 'LOAN', category: 'GOLD LOAN', desc: 'GOLD LOAN', pm: 'UPI', budget: 5000, spent: 5000, status: 'PAID' },
  { id: 36, date: '2026-08-01', member: 'MADHURI', type: 'LOAN', category: 'GOLD LOAN', desc: 'GOLD LOAN', pm: 'UPI', budget: 5000, spent: 5000, status: 'PAID' },
  { id: 37, date: '2026-08-01', member: 'MADHURI', type: 'LOAN', category: 'B. PARISHATH LOAN', desc: 'BRAMHANA PARISHATH', pm: 'UPI', budget: 1000, spent: 1000, status: 'PAID' },
  { id: 38, date: '2026-08-01', member: 'SYAM', type: 'LOAN', category: 'CRED LOAN', desc: 'CRED LOAN', pm: 'UPI', budget: 5298, spent: 5298, status: 'PAID' },
  { id: 39, date: '2026-08-01', member: 'SYAM', type: 'LOAN', category: 'CRED LOAN', desc: 'CRED LOAN', pm: 'UPI', budget: 5298, spent: 5298, status: 'PAID' },
  { id: 40, date: '2026-08-01', member: 'SYAM', type: 'LOAN', category: 'CREDIT CARD LOAN', desc: 'AXIS BANK LOAN', pm: 'UPI', budget: 1300, spent: 0, status: 'TO BE PAID' },
  { id: 41, date: '2026-08-01', member: 'SYAM', type: 'LOAN', category: 'HDFC PERSONAL LOAN', desc: 'HDFC JUMBO LOAN', pm: 'UPI', budget: 10643, spent: 10643, status: 'PAID' },
  { id: 42, date: '2026-08-01', member: 'SYAM', type: 'LOAN', category: 'HDFC PERSONAL LOAN', desc: 'HDFC JUMBO LOAN', pm: 'UPI', budget: 31425, spent: 31425, status: 'PAID' },
  { id: 43, date: '2026-08-01', member: 'SYAM', type: 'LOAN', category: 'HDFC PERSONAL LOAN', desc: 'HDFC INSTA LOAN', pm: 'UPI', budget: 4480, spent: 4480, status: 'PAID' },
  { id: 44, date: '2026-08-01', member: 'SYAM', type: 'LOAN', category: 'HOUSING LOAN', desc: 'HOUSING LOAN-1', pm: 'UPI', budget: 26298, spent: 26298, status: 'PAID' },
  { id: 45, date: '2026-08-01', member: 'SYAM', type: 'LOAN', category: 'HOUSING LOAN', desc: 'HOUSING LOAN-2', pm: 'UPI', budget: 4843, spent: 4843, status: 'PAID' },
  { id: 46, date: '2026-08-01', member: 'MADHURI', type: 'SAVING', category: 'SAVING', desc: 'MUTUAL FUNDS - MADHURI 5TH', pm: 'UPI', budget: 2000, spent: 2000, status: 'PAID' },
  { id: 47, date: '2026-08-01', member: 'MADHURI', type: 'SAVING', category: 'SAVING', desc: 'G R T GOLD SCHEME', pm: 'UPI', budget: 12000, spent: 12000, status: 'PAID' },
  { id: 48, date: '2026-08-01', member: 'SYAM', type: 'SAVING', category: 'SAVING', desc: 'MUTUAL FUNDS - SYAM 3RD', pm: 'UPI', budget: 2000, spent: 2000, status: 'PAID' },
  { id: 49, date: '2026-08-01', member: 'SYAM', type: 'SAVING', category: 'SAVING', desc: 'UNION BANK RD', pm: 'UPI', budget: 1000, spent: 1000, status: 'PAID' }
];
