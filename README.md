# H E M — Household Expense Manager

H E M is a personal and household finance manager for recording income, expenses,
budgets, savings, loans, taxes and recurring obligations in one workspace.
It helps users understand where money is going, what payments are approaching,
how much can be saved, and which practical actions may improve their financial
position.

## What it includes

- Household dashboard with income, spending, savings, debt and cash-flow summaries
- Searchable income and expense ledger with categories, payment status and members
- Financial profile for income streams, regular expenses, assets and liabilities
- Budget-versus-actual tracking with spending indicators and alerts
- Savings goals, SIP and lump-sum projections
- Loan, EMI, bill, insurance and tax-obligation tracking
- Indian tax estimation for New and Old Regimes
- Twelve-month cash-flow forecasting and rule-based financial recommendations
- Unified financial calendar with due dates and `.ics` export
- Standard, EMI, tax and savings calculators
- PDF and Excel reports, CSV/Excel import and JSON backup/restore
- Responsive interface with nine selectable themes, including the original H E M theme

## Important notes

This is a prototype-stage application. Financial forecasts and tax results are
estimates based on the information entered by the user and must be checked
against current official rules or a qualified professional.

The recommendation feature is deterministic and rule-based. It is not a
connected generative-AI chatbot and does not provide regulated financial advice.
There is no documented automatic bank-account connection.

The application supports browser-local storage and contains optional
server/Firebase synchronization paths. Those optional paths must be configured,
reviewed and secured before using real household data. Do not treat source-code
features as proof that a production backend is deployed.

## Technology

- TypeScript
- Vite
- HTML and CSS
- `xlsx` for spreadsheet import and export
- Browser APIs for local persistence and file downloads
- Optional Firebase or server synchronization, when configured

## Project structure

```text
├── index.html
├── package.json
├── bun.lock
├── tsconfig.json
├── vite.config.ts
├── metadata.json
├── public/
└── src/
    ├── main.ts           # Application startup and feature wiring
    ├── views.ts          # Interface rendering and interactions
    ├── intelligence.ts   # Financial analysis and recommendations
    ├── charts.ts         # Financial visualizations
    ├── calendar.ts       # Financial calendar and .ics export
    ├── calculator.ts     # Calculator modes
    ├── reportExport.ts   # PDF and Excel exports
    ├── profileStore.ts   # Financial profile persistence
    ├── storage.ts        # Persistence and synchronization paths
    ├── authGate.ts       # Sign-in and household access flows
    ├── theme.ts          # Theme selection and persistence
    ├── types.ts          # TypeScript models
    ├── constants.ts      # Themes, roles and starter data
    ├── utils.ts          # Formatting and shared utilities
    └── styles.css        # Layout, themes and responsive styling
```

## Getting started

### Requirements

- Node.js with npm
- A modern desktop or mobile browser

### Install and run locally

```bash
git clone https://github.com/KANDE-BALA-GURU-CHARAN/Household-Expense-Manager.git
cd Household-Expense-Manager
npm install
npm run dev
```

Open the local URL shown by Vite. The project is configured to use port `3000`.

### Verify and build

```bash
npm run lint
npm run build
```

The production files are written to `dist/`. To preview that build locally:

```bash
npm run preview
```

Use one package manager consistently. The repository includes a Bun lockfile,
so Bun may be used instead of npm if preferred.

## Available scripts

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Start the Vite development server |
| `npm run lint` | Run the TypeScript no-emit check |
| `npm run build` | Create the production build |
| `npm run preview` | Preview the production build |

## Data and security

- Never commit `.env` files, API keys, passwords or access tokens.
- Keep server and Firebase credentials outside source control.
- Back up important data before importing, replacing or restoring records.
- Review household isolation, encryption and Admin/Editor/Viewer permissions
  before enabling shared or production storage.
- Validate deployment, accessibility and security independently before using
  real financial information.

## Roadmap

Planned improvements include stronger automated tests for financial calculations
and data migration, configurable reminders, recurring-transaction automation,
scenario planning, accessibility improvements and production deployment checks.

## Contributing

Create a focused branch, make a small change, and run the checks before opening
an issue or pull request:

```bash
npm run lint
npm run build
```

For financial calculations, include examples or tests showing the expected result.

## License

No license has been selected for this repository yet. Until a `LICENSE` file is
added, do not assume that the code may be reused or redistributed.
