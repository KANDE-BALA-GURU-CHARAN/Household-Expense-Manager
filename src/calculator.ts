import type { Totals, Transaction } from './types';
import { $, $$, el, fmtIn, money, num, toast, totals } from './utils';

export type CalcTab = 'standard' | 'emi' | 'tax' | 'savings';

export interface CalcPrefill {
  type: string;
  category: string;
  desc: string;
  budget: number;
  spent: number;
}

export interface FinancialCalculatorApi {
  open: (tab?: CalcTab) => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
}

/* ============================================================
   PURE FINANCIAL & ARITHMETIC ENGINES
   ============================================================ */
export function evaluateCalcExpression(expr: string): { ok: boolean; value: number; text: string } {
  const cleaned = expr
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/\s+/g, '');

  if (!cleaned) return { ok: true, value: 0, text: '0' };
  if (!/^[0-9+\-*/.%()]+$/.test(cleaned)) {
    return { ok: false, value: NaN, text: 'Error' };
  }

  // Convert trailing percentages like 2500+18% => 2500+(2500*0.18) or standalone 50% => (50/100)
  let normalized = cleaned.replace(/(\d+(?:\.\d+)?)([+\-])(\d+(?:\.\d+)?)%/g, '($1$2($1*($3/100)))');
  normalized = normalized.replace(/(\d+(?:\.\d+)?)%/g, '($1/100)');

  try {
    // Tokenize & parse safely using shunting-yard (no eval/Function)
    const tokens: string[] = [];
    let i = 0;
    while (i < normalized.length) {
      const ch = normalized[i];
      if ((ch >= '0' && ch <= '9') || ch === '.') {
        let n = '';
        while (i < normalized.length && ((normalized[i] >= '0' && normalized[i] <= '9') || normalized[i] === '.')) {
          n += normalized[i++];
        }
        tokens.push(n);
        continue;
      }
      if ('+-*/()'.includes(ch)) {
        // Handle unary minus at start or after operator/'('
        const prev = tokens[tokens.length - 1];
        if (ch === '-' && (tokens.length === 0 || '+-*/('.includes(prev))) {
          tokens.push('0');
        }
        tokens.push(ch);
        i++;
        continue;
      }
      return { ok: false, value: NaN, text: 'Error' };
    }

    const out: Array<number | string> = [];
    const ops: string[] = [];
    const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

    for (const tok of tokens) {
      if (!'+-*/()'.includes(tok)) {
        const parsed = Number(tok);
        if (!Number.isFinite(parsed)) return { ok: false, value: NaN, text: 'Error' };
        out.push(parsed);
      } else if (tok === '(') {
        ops.push(tok);
      } else if (tok === ')') {
        while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop()!);
        if (!ops.length) return { ok: false, value: NaN, text: 'Error' };
        ops.pop();
      } else {
        while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]] >= prec[tok]) {
          out.push(ops.pop()!);
        }
        ops.push(tok);
      }
    }
    while (ops.length) {
      const op = ops.pop()!;
      if (op === '(') return { ok: false, value: NaN, text: 'Error' };
      out.push(op);
    }

    const stack: number[] = [];
    for (const item of out) {
      if (typeof item === 'number') {
        stack.push(item);
      } else {
        if (stack.length < 2) return { ok: false, value: NaN, text: 'Error' };
        const b = stack.pop()!;
        const a = stack.pop()!;
        if (item === '+') stack.push(a + b);
        else if (item === '-') stack.push(a - b);
        else if (item === '*') stack.push(a * b);
        else if (item === '/') {
          if (Math.abs(b) < 1e-12) return { ok: false, value: NaN, text: 'Cannot ÷ 0' };
          stack.push(a / b);
        }
      }
    }

    if (stack.length !== 1 || !Number.isFinite(stack[0])) {
      return { ok: false, value: NaN, text: 'Error' };
    }
    const rounded = Math.round(stack[0] * 1e8) / 1e8;
    return { ok: true, value: rounded, text: String(rounded) };
  } catch {
    return { ok: false, value: NaN, text: 'Error' };
  }
}

export function calculateEmi(principal: number, annualRatePct: number, months: number) {
  const p = Math.max(0, principal);
  const n = Math.max(1, Math.round(months));
  const r = Math.max(0, annualRatePct) / 12 / 100;

  let emi = 0;
  if (p > 0) {
    if (r === 0) emi = p / n;
    else {
      const pow = Math.pow(1 + r, n);
      emi = (p * r * pow) / (pow - 1);
    }
  }
  const totalPayment = emi * n;
  const totalInterest = Math.max(0, totalPayment - p);
  return { emi, totalPayment, totalInterest, principal: p, months: n };
}

export function calculateIndianTax(
  grossAnnual: number,
  extraDeductions: number,
  salaried: boolean,
  regime: 'new' | 'old'
) {
  const gross = Math.max(0, grossAnnual);

  function computeNew(g: number) {
    const stdDed = salaried ? Math.min(g, 75000) : 0;
    const taxable = Math.max(0, g - stdDed);
    const slabs: Array<[number, number]> = [
      [400000, 0],
      [400000, 0.05],
      [400000, 0.10],
      [400000, 0.15],
      [400000, 0.20],
      [400000, 0.25],
      [Infinity, 0.30]
    ];
    let rem = taxable;
    let slabTax = 0;
    for (const [band, rate] of slabs) {
      if (rem <= 0) break;
      const chunk = Math.min(rem, band);
      slabTax += chunk * rate;
      rem -= chunk;
    }
    let rebate = 0;
    if (taxable <= 1200000) {
      rebate = Math.min(slabTax, 60000);
    } else if (taxable <= 1275000) {
      // Marginal relief near ₹12L threshold
      const excess = taxable - 1200000;
      if (slabTax > excess) rebate = slabTax - excess;
    }
    const baseAfterRebate = Math.max(0, slabTax - rebate);
    const cess = baseAfterRebate * 0.04;
    const total = baseAfterRebate + cess;
    return { stdDed, deductions: stdDed, taxable, slabTax, rebate, cess, total };
  }

  function computeOld(g: number) {
    const stdDed = salaried ? Math.min(g, 50000) : 0;
    const ded = stdDed + Math.max(0, extraDeductions);
    const taxable = Math.max(0, g - ded);
    const slabs: Array<[number, number]> = [
      [250000, 0],
      [250000, 0.05],
      [500000, 0.20],
      [Infinity, 0.30]
    ];
    let rem = taxable;
    let slabTax = 0;
    for (const [band, rate] of slabs) {
      if (rem <= 0) break;
      const chunk = Math.min(rem, band);
      slabTax += chunk * rate;
      rem -= chunk;
    }
    const rebate = taxable <= 500000 ? Math.min(slabTax, 12500) : 0;
    const baseAfterRebate = Math.max(0, slabTax - rebate);
    const cess = baseAfterRebate * 0.04;
    const total = baseAfterRebate + cess;
    return { stdDed, deductions: ded, taxable, slabTax, rebate, cess, total };
  }

  const newRes = computeNew(gross);
  const oldRes = computeOld(gross);
  const active = regime === 'new' ? newRes : oldRes;
  const other = regime === 'new' ? oldRes : newRes;
  const savingsVsOther = other.total - active.total;
  const effectiveRate = gross > 0 ? (active.total / gross) * 100 : 0;
  const monthlyTakeHome = Math.max(0, (gross - active.total) / 12);

  return {
    ...active,
    gross,
    effectiveRate,
    monthlyTax: active.total / 12,
    monthlyTakeHome,
    savingsVsOther,
    otherRegime: regime === 'new' ? 'Old Regime' : 'New Regime'
  };
}

export function calculateSavingsProjection(
  monthlySip: number,
  lumpSum: number,
  annualReturnPct: number,
  years: number
) {
  const m = Math.max(0, monthlySip);
  const l = Math.max(0, lumpSum);
  const y = Math.max(1, years);
  const n = Math.round(y * 12);
  const i = Math.max(0, annualReturnPct) / 12 / 100;

  const lumpFv = i === 0 ? l : l * Math.pow(1 + i, n);
  const sipFv =
    m === 0
      ? 0
      : i === 0
        ? m * n
        : m * ((Math.pow(1 + i, n) - 1) / i) * (1 + i);

  const futureValue = lumpFv + sipFv;
  const totalInvested = l + m * n;
  const wealthGain = Math.max(0, futureValue - totalInvested);
  const multiplier = totalInvested > 0 ? futureValue / totalInvested : 1;

  return { futureValue, totalInvested, wealthGain, multiplier, months: n };
}

/* ============================================================
   FLOATING FINANCIAL CALCULATOR CONTROLLER
   ============================================================ */
export function initFinancialCalculator(opts: {
  getRows: () => Transaction[];
  onPrefillTransaction: (preset: CalcPrefill) => void;
}): FinancialCalculatorApi {
  const host = $('#finCalc');
  const bandBtn = $('#calcBandBtn');
  const settingsBtn = $('#openCalcFromSettings');

  if (!host) {
    return { open: () => {}, close: () => {}, toggle: () => {}, isOpen: () => false };
  }

  let activeTab: CalcTab = 'standard';
  let expr = '0';
  let justEvaluated = false;
  let lastNumericResult = 0;

  // Render floating calculator skeleton inside #finCalc
  host.innerHTML = `
    <div id="calcDragHead" class="calc-head">
      <div style="min-width:0;">
        <span class="micro-upper" style="display:block;">Household Utility</span>
        <h3 class="calc-title">Financial Calculator</h3>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <button id="calcResetPos" type="button" class="btn sm ghost" title="Snap back to corner" hidden>Dock</button>
        <button id="calcCloseBtn" type="button" class="btn sm ghost" aria-label="Close Financial Calculator">✕</button>
      </div>
    </div>

    <div id="calcTabs" class="seg-group calc-tabs" role="tablist" aria-label="Calculator modes">
      <button type="button" class="seg-btn" role="tab" data-ctab="standard" aria-selected="true" aria-pressed="true">Standard</button>
      <button type="button" class="seg-btn" role="tab" data-ctab="emi" aria-selected="false" aria-pressed="false">EMI</button>
      <button type="button" class="seg-btn" role="tab" data-ctab="tax" aria-selected="false" aria-pressed="false">Tax</button>
      <button type="button" class="seg-btn" role="tab" data-ctab="savings" aria-selected="false" aria-pressed="false">Savings</button>
    </div>

    <!-- TAB 1: STANDARD -->
    <div id="cPaneStandard" class="calc-pane">
      <div class="calc-screen">
        <div id="cStdExpr" class="calc-expr num">0</div>
        <div id="cStdOut" class="calc-out num">0</div>
      </div>
      <div class="calc-pad" role="group" aria-label="Calculator keypad">
        <button type="button" class="calc-key is-fn" data-key="AC">AC</button>
        <button type="button" class="calc-key is-fn" data-key="BS">⌫</button>
        <button type="button" class="calc-key is-fn" data-key="%">%</button>
        <button type="button" class="calc-key is-op" data-key="÷">÷</button>

        <button type="button" class="calc-key" data-key="7">7</button>
        <button type="button" class="calc-key" data-key="8">8</button>
        <button type="button" class="calc-key" data-key="9">9</button>
        <button type="button" class="calc-key is-op" data-key="×">×</button>

        <button type="button" class="calc-key" data-key="4">4</button>
        <button type="button" class="calc-key" data-key="5">5</button>
        <button type="button" class="calc-key" data-key="6">6</button>
        <button type="button" class="calc-key is-op" data-key="−">−</button>

        <button type="button" class="calc-key" data-key="1">1</button>
        <button type="button" class="calc-key" data-key="2">2</button>
        <button type="button" class="calc-key" data-key="3">3</button>
        <button type="button" class="calc-key is-op" data-key="+">+</button>

        <button type="button" class="calc-key" data-key="00">00</button>
        <button type="button" class="calc-key" data-key="0">0</button>
        <button type="button" class="calc-key" data-key=".">.</button>
        <button type="button" class="calc-key is-eq" data-key="=">=</button>
      </div>
      <div class="calc-foot-actions">
        <button id="cStdCopy" type="button" class="btn sm ghost">Copy value</button>
        <button id="cStdUse" type="button" class="btn sm">Use in + Add entry</button>
      </div>
    </div>

    <!-- TAB 2: EMI ESTIMATOR -->
    <div id="cPaneEmi" class="calc-pane" hidden>
      <div class="calc-form-grid">
        <div class="field">
          <label for="cEmiP">Loan Principal (₹)</label>
          <input id="cEmiP" type="number" min="0" step="1000" value="500000">
        </div>
        <div class="field">
          <label for="cEmiR">Interest (% p.a.)</label>
          <input id="cEmiR" type="number" min="0" max="45" step="0.1" value="9.2">
        </div>
        <div class="field">
          <label for="cEmiT">Tenure</label>
          <input id="cEmiT" type="number" min="1" max="480" step="1" value="5">
        </div>
        <div class="field">
          <label for="cEmiUnit">Unit</label>
          <select id="cEmiUnit">
            <option value="years" selected>Years</option>
            <option value="months">Months</option>
          </select>
        </div>
      </div>

      <div class="calc-result-card">
        <div class="calc-res-main">
          <span class="micro-upper">Estimated Monthly EMI</span>
          <strong id="cEmiVal" class="calc-big num">₹10,428</strong>
        </div>
        <div class="calc-res-rows">
          <div><span class="mono-meta">Principal</span><strong id="cEmiOutP" class="num">₹5,00,000</strong></div>
          <div><span class="mono-meta">Total Interest</span><strong id="cEmiOutI" class="num is-brick">₹1,25,686</strong></div>
          <div><span class="mono-meta">Total Payable</span><strong id="cEmiOutTot" class="num">₹6,25,686</strong></div>
        </div>
        <div id="cEmiBar" class="calc-split-bar" aria-hidden="true"></div>
      </div>

      <div class="calc-foot-actions">
        <span id="cEmiRatioNote" class="mono-meta">Interest: 20.1%</span>
        <button id="cEmiUse" type="button" class="btn sm">Log as Loan EMI →</button>
      </div>
    </div>

    <!-- TAB 3: INCOME TAX (INDIA) -->
    <div id="cPaneTax" class="calc-pane" hidden>
      <div class="calc-form-grid">
        <div class="field" style="grid-column:1 / -1;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <label for="cTaxGross">Annual Gross Income (₹)</label>
            <button id="cTaxLoad" type="button" class="btn sm ghost" style="min-height:24px;padding:2px 8px;font-size:11px;">Use ledger × 12</button>
          </div>
          <input id="cTaxGross" type="number" min="0" step="10000" value="1800000">
        </div>
        <div class="field">
          <label for="cTaxRegime">Tax Regime</label>
          <select id="cTaxRegime">
            <option value="new" selected>New Regime (FY 25–26)</option>
            <option value="old">Old Regime</option>
          </select>
        </div>
        <div class="field">
          <label for="cTaxDed">Extra Deductions (Old)</label>
          <input id="cTaxDed" type="number" min="0" step="5000" value="150000">
        </div>
      </div>

      <label style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:10px;cursor:pointer;">
        <input id="cTaxSal" type="checkbox" checked style="width:auto;min-height:auto;">
        <span>Salaried standard deduction (₹75,000 New / ₹50,000 Old)</span>
      </label>

      <div class="calc-result-card">
        <div class="calc-res-main">
          <span class="micro-upper">Total Annual Tax (incl. 4% Cess)</span>
          <strong id="cTaxTotal" class="calc-big num">₹1,48,200</strong>
        </div>
        <div class="calc-res-rows">
          <div><span class="mono-meta">Taxable Income</span><strong id="cTaxTaxable" class="num">₹17,25,000</strong></div>
          <div><span class="mono-meta">Monthly Tax</span><strong id="cTaxMonthly" class="num is-brick">₹12,350/mo</strong></div>
          <div><span class="mono-meta">Net Take-Home</span><strong id="cTaxTakeHome" class="num is-green">₹1,37,650/mo</strong></div>
        </div>
      </div>
      <p id="cTaxCompare" class="mono-meta" style="margin:8px 0 0;"></p>
    </div>

    <!-- TAB 4: SAVINGS PROJECTION -->
    <div id="cPaneSavings" class="calc-pane" hidden>
      <div class="calc-form-grid">
        <div class="field">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
            <label for="cSavSip">Monthly SIP (₹)</label>
            <button id="cSavLoad" type="button" class="btn sm ghost" style="min-height:22px;padding:1px 6px;font-size:10.5px;">Ledger</button>
          </div>
          <input id="cSavSip" type="number" min="0" step="500" value="17000">
        </div>
        <div class="field">
          <label for="cSavLump">Initial Lump Sum (₹)</label>
          <input id="cSavLump" type="number" min="0" step="5000" value="50000">
        </div>
        <div class="field">
          <label for="cSavRate">Expected Return (% p.a.)</label>
          <input id="cSavRate" type="number" min="0" max="35" step="0.5" value="12">
        </div>
        <div class="field">
          <label for="cSavYears">Horizon (<span id="cSavYearsRead" class="num">10</span> yrs)</label>
          <input id="cSavYears" type="range" min="1" max="35" step="1" value="10">
        </div>
      </div>

      <div class="calc-result-card">
        <div class="calc-res-main">
          <span class="micro-upper">Projected Corpus</span>
          <strong id="cSavFv" class="calc-big num is-green">₹41,03,808</strong>
        </div>
        <div class="calc-res-rows">
          <div><span class="mono-meta">Invested</span><strong id="cSavInv" class="num">₹20,90,000</strong></div>
          <div><span class="mono-meta">Est. Returns</span><strong id="cSavGain" class="num is-green">₹20,13,808</strong></div>
          <div><span class="mono-meta">Growth</span><strong id="cSavMult" class="num">1.96×</strong></div>
        </div>
        <div id="cSavBar" class="calc-split-bar" aria-hidden="true"></div>
      </div>

      <div class="calc-foot-actions">
        <span class="mono-meta">Compounded monthly</span>
        <button id="cSavUse" type="button" class="btn sm">Log Monthly SIP →</button>
      </div>
    </div>
  `;

  /* ---- Tab Switching ---- */
  const paneMap: Record<CalcTab, HTMLElement | null> = {
    standard: $('#cPaneStandard'),
    emi: $('#cPaneEmi'),
    tax: $('#cPaneTax'),
    savings: $('#cPaneSavings')
  };

  function setTab(tab: CalcTab) {
    activeTab = tab;
    $$('#calcTabs [data-ctab]').forEach(btn => {
      const on = btn.getAttribute('data-ctab') === tab;
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-selected', String(on));
    });
    (Object.keys(paneMap) as CalcTab[]).forEach(k => {
      const p = paneMap[k];
      if (p) p.hidden = k !== tab;
    });
    if (tab === 'emi') updateEmi();
    if (tab === 'tax') updateTax();
    if (tab === 'savings') updateSavings();
  }

  $$('#calcTabs [data-ctab]').forEach(btn => {
    btn.addEventListener('click', () => {
      setTab((btn.getAttribute('data-ctab') || 'standard') as CalcTab);
    });
  });

  /* ---- Standard Calculator Logic ---- */
  function updateStdDisplay(previewText?: string) {
    const exprEl = $('#cStdExpr');
    const outEl = $('#cStdOut');
    if (exprEl) exprEl.textContent = expr;
    if (outEl) {
      if (previewText !== undefined) {
        outEl.textContent = previewText;
      } else {
        const res = evaluateCalcExpression(expr);
        if (res.ok) {
          lastNumericResult = res.value;
          const absDecimals = String(res.value).includes('.') ? Math.min(6, String(res.value).split('.')[1].length) : 0;
          outEl.textContent = fmtIn(res.value, absDecimals);
        } else {
          outEl.textContent = expr;
        }
      }
    }
  }

  function pressKey(k: string) {
    const isOp = ['+', '−', '×', '÷'].includes(k);
    if (k === 'AC') {
      expr = '0';
      justEvaluated = false;
      updateStdDisplay('0');
      return;
    }
    if (k === 'BS') {
      if (justEvaluated) {
        expr = '0';
        justEvaluated = false;
      } else {
        expr = expr.length > 1 ? expr.slice(0, -1) : '0';
      }
      updateStdDisplay();
      return;
    }
    if (k === '=') {
      const res = evaluateCalcExpression(expr);
      if (res.ok) {
        lastNumericResult = res.value;
        expr = String(res.value);
        justEvaluated = true;
        updateStdDisplay();
      } else {
        updateStdDisplay(res.text);
        justEvaluated = true;
      }
      return;
    }

    if (justEvaluated && !isOp && k !== '%') {
      expr = k === '.' ? '0.' : k === '00' ? '0' : k;
      justEvaluated = false;
      updateStdDisplay();
      return;
    }
    justEvaluated = false;

    if (expr === '0' && !isOp && k !== '.' && k !== '%') {
      expr = k === '00' ? '0' : k;
    } else if (isOp && ['+', '−', '×', '÷'].includes(expr.slice(-1))) {
      expr = expr.slice(0, -1) + k;
    } else {
      expr += k;
    }
    updateStdDisplay();
  }

  $$('.calc-key[data-key]').forEach(btn => {
    btn.addEventListener('click', () => pressKey(btn.getAttribute('data-key') || ''));
  });

  // Keyboard support when calculator is focused
  host.addEventListener('keydown', e => {
    if (activeTab !== 'standard') return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const map: Record<string, string> = {
      '+': '+',
      '-': '−',
      '*': '×',
      '/': '÷',
      '%': '%',
      '.': '.',
      Enter: '=',
      '=': '=',
      Backspace: 'BS',
      Delete: 'AC'
    };
    if (e.key >= '0' && e.key <= '9') {
      e.preventDefault();
      pressKey(e.key);
    } else if (map[e.key]) {
      e.preventDefault();
      pressKey(map[e.key]);
    }
  });

  $('#cStdCopy')?.addEventListener('click', () => {
    const val = String(lastNumericResult);
    navigator.clipboard?.writeText(val).then(
      () => toast(`Copied ${val}`, 'ok'),
      () => toast(`Result: ${val}`)
    );
  });

  $('#cStdUse')?.addEventListener('click', () => {
    const amt = Math.max(0, Math.round(lastNumericResult * 100) / 100);
    opts.onPrefillTransaction({
      type: 'EXPENSE',
      category: 'EXPENSE',
      desc: '',
      budget: amt,
      spent: amt
    });
  });

  /* ---- EMI Estimator Logic ---- */
  let latestEmi = 0;
  function updateEmi() {
    const p = num(($('#cEmiP') as HTMLInputElement | null)?.value);
    const r = num(($('#cEmiR') as HTMLInputElement | null)?.value);
    const tVal = Math.max(1, num(($('#cEmiT') as HTMLInputElement | null)?.value));
    const unit = ($('#cEmiUnit') as HTMLSelectElement | null)?.value || 'years';
    const months = unit === 'years' ? tVal * 12 : tVal;

    const res = calculateEmi(p, r, months);
    latestEmi = Math.round(res.emi);

    const setT = (id: string, txt: string) => {
      const elNode = $(id);
      if (elNode) elNode.textContent = txt;
    };
    setT('#cEmiVal', money(Math.round(res.emi)));
    setT('#cEmiOutP', money(Math.round(res.principal)));
    setT('#cEmiOutI', money(Math.round(res.totalInterest)));
    setT('#cEmiOutTot', money(Math.round(res.totalPayment)));

    const total = Math.max(1, res.totalPayment);
    const pPct = (res.principal / total) * 100;
    const iPct = Math.max(0, 100 - pPct);
    setT('#cEmiRatioNote', `Interest share: ${iPct.toFixed(1)}% · ${res.months} months`);

    const bar = $('#cEmiBar');
    if (bar) {
      bar.innerHTML = '';
      bar.appendChild(el('span', { style: `width:${pPct.toFixed(1)}%;background:var(--violet);` }));
      bar.appendChild(el('span', { style: `width:${iPct.toFixed(1)}%;background:var(--marigold);` }));
    }
  }

  ['#cEmiP', '#cEmiR', '#cEmiT', '#cEmiUnit'].forEach(sel => {
    $(sel)?.addEventListener('input', updateEmi);
    $(sel)?.addEventListener('change', updateEmi);
  });

  $('#cEmiUse')?.addEventListener('click', () => {
    opts.onPrefillTransaction({
      type: 'LOAN',
      category: 'PERSONAL LOAN',
      desc: 'MONTHLY LOAN EMI',
      budget: latestEmi,
      spent: latestEmi
    });
  });

  /* ---- Tax Calculator Logic ---- */
  function updateTax() {
    const gross = num(($('#cTaxGross') as HTMLInputElement | null)?.value);
    const regime = (($('#cTaxRegime') as HTMLSelectElement | null)?.value || 'new') as 'new' | 'old';
    const ded = num(($('#cTaxDed') as HTMLInputElement | null)?.value);
    const salaried = !!($('#cTaxSal') as HTMLInputElement | null)?.checked;

    const dedInput = $('#cTaxDed') as HTMLInputElement | null;
    if (dedInput) dedInput.disabled = regime === 'new';

    const res = calculateIndianTax(gross, ded, salaried, regime);
    const setT = (id: string, txt: string) => {
      const node = $(id);
      if (node) node.textContent = txt;
    };
    setT('#cTaxTotal', money(Math.round(res.total)));
    setT('#cTaxTaxable', money(Math.round(res.taxable)));
    setT('#cTaxMonthly', `${money(Math.round(res.monthlyTax))}/mo`);
    setT('#cTaxTakeHome', `${money(Math.round(res.monthlyTakeHome))}/mo`);

    const cmp = $('#cTaxCompare');
    if (cmp) {
      if (Math.abs(res.savingsVsOther) < 1) {
        cmp.textContent = `Effective rate: ${res.effectiveRate.toFixed(1)}% · Identical tax under ${res.otherRegime}.`;
      } else if (res.savingsVsOther > 0) {
        cmp.textContent = `Effective rate: ${res.effectiveRate.toFixed(1)}% · Saves ${money(Math.round(res.savingsVsOther))}/yr vs ${res.otherRegime}.`;
      } else {
        cmp.textContent = `Effective rate: ${res.effectiveRate.toFixed(1)}% · ${res.otherRegime} saves ${money(Math.round(-res.savingsVsOther))}/yr.`;
      }
    }
  }

  ['#cTaxGross', '#cTaxRegime', '#cTaxDed', '#cTaxSal'].forEach(sel => {
    $(sel)?.addEventListener('input', updateTax);
    $(sel)?.addEventListener('change', updateTax);
  });

  $('#cTaxLoad')?.addEventListener('click', () => {
    const t: Totals = totals(opts.getRows());
    const annual = Math.round(t.income * 12);
    const inEl = $('#cTaxGross') as HTMLInputElement | null;
    if (inEl) {
      inEl.value = String(annual);
      updateTax();
      toast(`Loaded annualized income (${money(annual)})`, 'ok');
    }
  });

  /* ---- Savings Projection Logic ---- */
  let latestSip = 17000;
  function updateSavings() {
    const sip = num(($('#cSavSip') as HTMLInputElement | null)?.value);
    const lump = num(($('#cSavLump') as HTMLInputElement | null)?.value);
    const rate = num(($('#cSavRate') as HTMLInputElement | null)?.value);
    const yrs = Math.max(1, num(($('#cSavYears') as HTMLInputElement | null)?.value));
    latestSip = Math.round(sip);

    const yrsRead = $('#cSavYearsRead');
    if (yrsRead) yrsRead.textContent = String(yrs);

    const res = calculateSavingsProjection(sip, lump, rate, yrs);
    const setT = (id: string, txt: string) => {
      const node = $(id);
      if (node) node.textContent = txt;
    };
    setT('#cSavFv', money(Math.round(res.futureValue)));
    setT('#cSavInv', money(Math.round(res.totalInvested)));
    setT('#cSavGain', money(Math.round(res.wealthGain)));
    setT('#cSavMult', `${res.multiplier.toFixed(2)}×`);

    const tot = Math.max(1, res.futureValue);
    const invPct = (res.totalInvested / tot) * 100;
    const gainPct = Math.max(0, 100 - invPct);
    const bar = $('#cSavBar');
    if (bar) {
      bar.innerHTML = '';
      bar.appendChild(el('span', { style: `width:${invPct.toFixed(1)}%;background:var(--ink-3);` }));
      bar.appendChild(el('span', { style: `width:${gainPct.toFixed(1)}%;background:var(--green);` }));
    }
  }

  ['#cSavSip', '#cSavLump', '#cSavRate', '#cSavYears'].forEach(sel => {
    $(sel)?.addEventListener('input', updateSavings);
    $(sel)?.addEventListener('change', updateSavings);
  });

  $('#cSavLoad')?.addEventListener('click', () => {
    const t: Totals = totals(opts.getRows());
    const sipEl = $('#cSavSip') as HTMLInputElement | null;
    if (sipEl) {
      sipEl.value = String(Math.round(t.saving));
      updateSavings();
      toast(`Loaded monthly savings (${money(t.saving)})`, 'ok');
    }
  });

  $('#cSavUse')?.addEventListener('click', () => {
    opts.onPrefillTransaction({
      type: 'SAVING',
      category: 'SAVING',
      desc: 'MONTHLY SIP CONTRIBUTION',
      budget: latestSip,
      spent: latestSip
    });
  });

  /* ---- Open / Close / Toggle & Draggable Repositioning ---- */
  function open(tab?: CalcTab) {
    if (tab) setTab(tab);
    host!.hidden = false;
    bandBtn?.setAttribute('aria-expanded', 'true');
    if (activeTab === 'emi') updateEmi();
    if (activeTab === 'tax') updateTax();
    if (activeTab === 'savings') updateSavings();
  }

  function close() {
    host!.hidden = true;
    bandBtn?.setAttribute('aria-expanded', 'false');
  }

  function toggle() {
    if (host!.hidden) open();
    else close();
  }

  $('#calcCloseBtn')?.addEventListener('click', close);
  bandBtn?.addEventListener('click', toggle);
  settingsBtn?.addEventListener('click', () => open());
  $('#calcDrawerBtn')?.addEventListener('click', () => {
    const drawer = $('#pagerDrawer');
    const toggleBtn = $('#pagerToggle');
    if (drawer) drawer.hidden = true;
    toggleBtn?.setAttribute('aria-expanded', 'false');
    open();
  });

  // Pointer drag repositioning on desktop header
  const dragHead = $('#calcDragHead');
  const dockBtn = $('#calcResetPos');
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  dockBtn?.addEventListener('click', () => {
    host.style.left = '';
    host.style.top = '';
    host.style.right = '';
    host.style.bottom = '';
    dockBtn.hidden = true;
  });

  dragHead?.addEventListener('pointerdown', e => {
    if ((e.target as HTMLElement)?.closest('button')) return;
    if (window.innerWidth < 640) return;
    const rect = host.getBoundingClientRect();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    host.style.left = `${rect.left}px`;
    host.style.top = `${rect.top}px`;
    dragHead.setPointerCapture(e.pointerId);
  });

  dragHead?.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const w = host.offsetWidth;
    const h = host.offsetHeight;
    const nextL = Math.max(8, Math.min(window.innerWidth - w - 8, startLeft + dx));
    const nextT = Math.max(52, Math.min(window.innerHeight - h - 8, startTop + dy));
    host.style.left = `${nextL}px`;
    host.style.top = `${nextT}px`;
    if (dockBtn) dockBtn.hidden = false;
  });

  const endDrag = () => {
    dragging = false;
  };
  dragHead?.addEventListener('pointerup', endDrag);
  dragHead?.addEventListener('pointercancel', endDrag);

  updateStdDisplay('0');
  updateEmi();
  updateTax();
  updateSavings();

  return { open, close, toggle, isOpen: () => !host.hidden };
}
