import type { FinancialProfile } from './types';

const memProfiles: Record<string, FinancialProfile> = {};

export function profileStorageKey(hid: string | null): string {
  return `budget2026.profile.${hid || 'guest'}`;
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createDefaultProfile(): FinancialProfile {
  return {
    incomes: [],
    expenses: [],
    obligations: [],
    tax: {
      configured: false,
      assessmentYear: 'FY 2025-26 (AY 2026-27)',
      regime: 'new',
      annualGrossIncome: null,
      deductions80C: 0,
      deductions80D: 0,
      hraExemption: 0,
      otherExemptions: 0,
      tdsAlreadyDeducted: 0,
      advanceTaxPaid: 0,
      gstApplicable: false,
      gstMonthlyEstimated: 0
    },
    assets: [],
    liabilities: []
  };
}

export function normalizeProfile(raw: unknown): FinancialProfile {
  const def = createDefaultProfile();
  if (!raw || typeof raw !== 'object') return def;
  const r = raw as Partial<FinancialProfile>;
  return {
    incomes: Array.isArray(r.incomes) ? r.incomes : [],
    expenses: Array.isArray(r.expenses) ? r.expenses : [],
    obligations: Array.isArray(r.obligations) ? r.obligations : [],
    tax: {
      ...def.tax,
      ...(r.tax && typeof r.tax === 'object' ? r.tax : {})
    },
    assets: Array.isArray(r.assets) ? r.assets : [],
    liabilities: Array.isArray(r.liabilities) ? r.liabilities : []
  };
}

export function loadProfile(hid: string | null): FinancialProfile {
  const k = profileStorageKey(hid);
  try {
    const raw = localStorage.getItem(k);
    if (raw) {
      const parsed = normalizeProfile(JSON.parse(raw));
      memProfiles[k] = parsed;
      return parsed;
    }
  } catch {
    // ignore storage errors and fall back to memory/default
  }
  return memProfiles[k] ? normalizeProfile(memProfiles[k]) : createDefaultProfile();
}

export function saveProfile(hid: string | null, profile: FinancialProfile): void {
  const k = profileStorageKey(hid);
  const clean = normalizeProfile(profile);
  memProfiles[k] = clean;
  try {
    localStorage.setItem(k, JSON.stringify(clean));
  } catch {
    // ignore quota errors; memory store still preserves active session state
  }
}
