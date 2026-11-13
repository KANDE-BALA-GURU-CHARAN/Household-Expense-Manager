import { MONTH_NAMES, MONTHS } from './constants';
import type { FilterState, GroupedTotals, TooltipData, Totals, Transaction } from './types';

export const $ = <T extends HTMLElement = HTMLElement>(s: string): T | null =>
  document.querySelector(s) as T | null;

export const $$ = <T extends HTMLElement = HTMLElement>(s: string): T[] =>
  Array.from(document.querySelectorAll(s)) as T[];

export const REDUCED_MOTION = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c] || c));
}

export function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v === null || v === undefined) return 0;
  let s = String(v).trim();
  if (!s || s === '-' || s === '—') return 0;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/[()]/g, '').replace(/[₹$€£,\s]/g, '').replace(/^-/, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

export function uniq(a: Array<string | number | null | undefined>): string[] {
  return Array.from(
    new Set(
      a
        .filter(v => v !== null && v !== undefined && String(v).trim() !== '')
        .map(v => String(v))
    )
  ).sort();
}

export function fmtIn(val: number, dec = 0): string {
  return num(val).toLocaleString('en-IN', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec
  });
}

export function money(n: unknown, dec = 0): string {
  return '₹' + fmtIn(num(n), dec);
}

export function signed(n: unknown): string {
  const v = num(n);
  return (v < 0 ? '−' : '') + money(Math.abs(v));
}

export function compactMoney(n: unknown): string {
  const v = num(n);
  const abs = Math.abs(v);
  const prefix = v < 0 ? '−₹' : '₹';
  if (abs >= 1e7) return `${prefix}${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${prefix}${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${prefix}${(abs / 1e3).toFixed(1)}k`;
  return `${prefix}${fmtIn(abs, 0)}`;
}

export function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso + (String(iso).length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1901) return '';
  return (
    String(d.getDate()).padStart(2, '0') +
    '-' +
    MONTH_NAMES[d.getMonth()] +
    '-' +
    d.getFullYear()
  );
}

export function yearOf(r: Transaction): string {
  const d = new Date(r.date + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? '' : String(d.getFullYear());
}

export function monthOf(r: Transaction): string {
  const d = new Date(r.date + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? '' : MONTHS[d.getMonth()];
}

export function isPaid(r: Transaction): boolean {
  return String(r.status || '').toUpperCase() === 'PAID';
}

export function isDue(r: Transaction): boolean {
  return String(r.status || '').toUpperCase().replace(/\s+/g, ' ') === 'TO BE PAID';
}

export function filterTransactions(tx: Transaction[], f: FilterState): Transaction[] {
  return tx.filter(
    r =>
      (f.year === 'ALL' || yearOf(r) === f.year) &&
      (f.month === 'ALL' || monthOf(r) === f.month) &&
      (f.member === 'ALL' || r.member === f.member) &&
      (f.type === 'ALL' || r.type === f.type) &&
      (f.category === 'ALL' || r.category === f.category) &&
      (f.pm === 'ALL' || r.pm === f.pm) &&
      (f.status === 'ALL' || r.status === f.status)
  );
}

export function totals(rows: Transaction[]): Totals {
  const t: Totals = {
    income: 0,
    expense: 0,
    loan: 0,
    saving: 0,
    budget: 0,
    spent: 0,
    paid: 0,
    due: 0,
    count: rows.length,
    incomeBudget: 0,
    outflow: 0,
    balance: 0,
    variance: 0,
    rawBudget: 0,
    rawSpent: 0
  };
  rows.forEach(r => {
    const b = num(r.budget);
    const s = num(r.spent);
    const ty = String(r.type || '').toUpperCase();
    if (ty === 'INCOME') {
      t.income += s;
      t.incomeBudget += b;
    } else {
      t.budget += b;
      t.spent += s;
      if (ty === 'EXPENSE') t.expense += s;
      else if (ty === 'LOAN') t.loan += s;
      else if (ty === 'SAVING') t.saving += s;
      else t.expense += s;
    }
    if (isPaid(r)) t.paid += s;
    if (isDue(r)) t.due += b;
  });
  t.outflow = t.expense + t.loan + t.saving;
  t.balance = t.income - t.outflow;
  t.variance = t.budget - t.spent;
  t.rawBudget = t.budget + t.incomeBudget;
  t.rawSpent = t.spent + t.income;
  return t;
}

export function groupBy(rows: Transaction[], keyFn: (r: Transaction) => string): GroupedTotals[] {
  const map = new Map<string, Transaction[]>();
  rows.forEach(r => {
    const k = keyFn(r) || '—';
    const arr = map.get(k);
    if (arr) arr.push(r);
    else map.set(k, [r]);
  });
  return Array.from(map, ([key, rs]) => Object.assign({ key, rows: rs }, totals(rs)));
}

export function scaleLinear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | null | undefined> = {},
  children: Array<Node | string | null | undefined> | Node | string = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') node.textContent = String(v);
    else if (k === 'html') node.innerHTML = String(v);
    else if (k === 'class') node.className = String(v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) {
    if (child !== null && child !== undefined) {
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
  }
  return node;
}

export function svgEl(
  tag: string,
  attrs: Record<string, string | number | null | undefined> = {},
  children: Array<SVGElement | null | undefined> | SVGElement = []
): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'text') node.textContent = String(v);
    else node.setAttribute(k, String(v));
  }
  const arr = Array.isArray(children) ? children : [children];
  for (const child of arr) {
    if (child !== null && child !== undefined) {
      node.appendChild(child);
    }
  }
  return node;
}

export function toCsv(matrix: Array<Array<string | number>>): string {
  return matrix
    .map(row =>
      row
        .map(c => {
          const s = String(c ?? '');
          return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        })
        .join(',')
    )
    .join('\n');
}

export function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function toast(msg: string, kind: 'ok' | 'err' | '' = ''): void {
  const host = document.getElementById('toast');
  if (!host) return;
  const item = document.createElement('div');
  item.className = 'toast ' + kind;
  item.textContent = msg;
  host.appendChild(item);
  window.setTimeout(() => {
    item.style.opacity = '0';
    item.style.transition = 'opacity 0.28s ease';
  }, 2400);
  window.setTimeout(() => item.remove(), 2750);
}

export function countUpCurrency(node: HTMLElement, target: number, prefix = '₹', suffix = '', decimals = 0): void {
  if (REDUCED_MOTION()) {
    node.textContent = `${target < 0 && prefix === '₹' ? '−₹' : prefix}${fmtIn(Math.abs(target), decimals)}${suffix}`;
    return;
  }
  const startVal = 0;
  const dur = 750;
  const start = performance.now();
  const isNeg = target < 0;
  const absTarget = Math.abs(target);

  function tick(now: number) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = startVal + absTarget * eased;
    const signStr = isNeg && prefix === '₹' ? '−' : '';
    node.textContent = `${signStr}${prefix}${fmtIn(t >= 1 ? absTarget : val, decimals)}${suffix}`;
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* Shared Tooltip Controller */
class TooltipController {
  private tt: HTMLElement | null = null;
  private ttCat: HTMLElement | null = null;
  private ttVal: HTMLElement | null = null;
  private ttSub: HTMLElement | null = null;
  private live: HTMLElement | null = null;
  private activeOwner: Element | null = null;
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    this.tt = document.getElementById('tt');
    this.ttCat = document.getElementById('ttCat');
    this.ttVal = document.getElementById('ttVal');
    this.ttSub = document.getElementById('ttSub');
    this.live = document.getElementById('liveRegion');
    if (!this.tt) return;
    this.initialized = true;

    window.addEventListener('scroll', () => this.hide(), { passive: true });
    document.addEventListener('pointerdown', e => {
      if (
        this.activeOwner &&
        e.target instanceof Node &&
        !this.activeOwner.contains(e.target) &&
        this.tt &&
        !this.tt.contains(e.target)
      ) {
        this.hide();
      }
    });
  }

  private clampPosition(x: number, y: number): { x: number; y: number } {
    if (!this.tt) return { x, y };
    const pad = 12;
    const rect = this.tt.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - pad;
    const maxY = window.innerHeight - rect.height - pad;
    return {
      x: Math.max(pad, Math.min(x, maxX)),
      y: Math.max(52, Math.min(y, maxY))
    };
  }

  show(owner: Element | null, data: TooltipData, pointerEvent?: PointerEvent | MouseEvent): void {
    if (!this.tt || !this.ttCat || !this.ttVal || !this.ttSub) this.init();
    if (!this.tt || !this.ttCat || !this.ttVal || !this.ttSub) return;

    if (this.activeOwner && this.activeOwner !== owner) {
      this.activeOwner.removeAttribute('aria-describedby');
    }
    this.activeOwner = owner;
    this.ttCat.textContent = data.cat || '';
    this.ttVal.textContent = data.val || '';
    this.ttSub.textContent = data.sub || '';
    this.tt.hidden = false;
    this.tt.classList.add('is-visible');
    if (owner) owner.setAttribute('aria-describedby', 'tt');
    if (this.live) {
      this.live.textContent = [data.cat, data.val, data.sub].filter(Boolean).join('. ');
    }

    let x = 16;
    let y = 56;
    if (pointerEvent && typeof pointerEvent.clientX === 'number') {
      x = pointerEvent.clientX + 16;
      y = pointerEvent.clientY + 16;
      const rect = this.tt.getBoundingClientRect();
      if (x + rect.width > window.innerWidth - 12) x = pointerEvent.clientX - rect.width - 16;
      if (y + rect.height > window.innerHeight - 12) y = pointerEvent.clientY - rect.height - 16;
    } else if (owner) {
      const or = owner.getBoundingClientRect();
      const tr = this.tt.getBoundingClientRect();
      x = or.left + or.width / 2 - tr.width / 2;
      y = or.top - tr.height - 10;
      if (y < 52) y = or.bottom + 10;
    }
    const pos = this.clampPosition(x, y);
    this.tt.style.transform = `translate3d(${Math.round(pos.x)}px, ${Math.round(pos.y)}px, 0)`;
  }

  hide = (): void => {
    if (this.activeOwner) {
      this.activeOwner.removeAttribute('aria-describedby');
      this.activeOwner = null;
    }
    if (this.tt) {
      this.tt.classList.remove('is-visible');
      this.tt.hidden = true;
    }
  };
}

export const tooltip = new TooltipController();
