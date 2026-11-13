import { MONTH_NAMES, MONTHS } from './constants';
import type { FilterState, MonthlyProjection, Totals, Transaction } from './types';
import {
  compactMoney,
  el,
  fmtDate,
  fmtIn,
  groupBy,
  isDue,
  isPaid,
  money,
  monthOf,
  num,
  REDUCED_MOTION,
  scaleLinear,
  signed,
  svgEl,
  tooltip,
  totals,
  uniq,
  yearOf
} from './utils';

/* ============================================================
   SHARED FIGURE CAPTION + ACCESSIBLE DATA TABLE TOGGLE
   ============================================================ */
export function renderFigureCaption(
  targetId: string,
  opts: {
    fig: string;
    caption: string;
    source?: string;
    cols: Array<{ label: string; num?: boolean }>;
    rows?: Array<Array<string | number>>;
    getRows?: () => Array<Array<string | number>>;
  }
) {
  const host = document.getElementById(targetId);
  if (!host) return { refreshTable: () => {} };

  const tblId = `${targetId}-tbl`;
  const btn = el('button', {
    type: 'button',
    class: 'fig-table-btn',
    'aria-expanded': 'false',
    'aria-controls': tblId,
    text: 'Show data table ↓'
  }) as HTMLButtonElement;
  const wrap = el('div', { class: 'fig-table-wrap', id: tblId, hidden: true });

  function buildTable() {
    wrap.innerHTML = '';
    const rows = typeof opts.getRows === 'function' ? opts.getRows() : opts.rows || [];
    const thead = el(
      'thead',
      {},
      el(
        'tr',
        {},
        opts.cols.map(c =>
          el('th', { class: c.num ? 'is-num' : '', scope: 'col', text: c.label })
        )
      )
    );
    const tbody = el(
      'tbody',
      {},
      rows.map(r =>
        el(
          'tr',
          {},
          r.map((cell, idx) =>
            el('td', {
              class: opts.cols[idx]?.num ? 'is-num num' : '',
              text: String(cell)
            })
          )
        )
      )
    );
    wrap.appendChild(el('table', { class: 'data-table' }, [thead, tbody]));
  }

  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') === 'true';
    if (!open) buildTable();
    btn.setAttribute('aria-expanded', String(!open));
    btn.textContent = open ? 'Show data table ↓' : 'Hide data table ↑';
    wrap.hidden = open;
  });

  const cap = el('div', { class: 'fig-caption' }, [
    el('div', { class: 'fig-meta' }, [
      el('span', { class: 'micro-upper', text: opts.fig }),
      el('span', { class: 'fig-text', text: opts.caption }),
      el('span', { class: 'mono-meta', text: opts.source || 'Calculated live from household ledger' })
    ]),
    btn
  ]);

  host.innerHTML = '';
  host.appendChild(cap);
  host.appendChild(wrap);

  return {
    refreshTable: () => {
      if (btn.getAttribute('aria-expanded') === 'true') buildTable();
    }
  };
}

export function renderChartEmpty(
  host: HTMLElement,
  title: string,
  subtitle: string,
  onAdd?: () => void
) {
  host.innerHTML = '';
  const box = el('div', { class: 'chart-empty' }, [
    el('p', { class: 'chart-empty-title', text: title }),
    el('p', { class: 'chart-empty-sub', text: subtitle })
  ]);
  if (onAdd) {
    const btn = el('button', { type: 'button', class: 'btn sm', text: '+ Log transaction' });
    btn.addEventListener('click', onAdd);
    box.appendChild(btn);
  }
  host.appendChild(box);
}

/* ============================================================
   01A. SIGNATURE MONEY FLOW BAR (H ∈ M)
   ============================================================ */
export function renderMoneyFlowBar(
  barId: string,
  keyId: string,
  captionId: string,
  t: Totals
) {
  const bar = document.getElementById(barId);
  const key = document.getElementById(keyId);
  const cap = document.getElementById(captionId);
  if (!bar || !key || !cap) return;

  const segs = [
    { label: 'Loan repayments', v: t.loan, color: 'var(--violet)', fg: 'var(--on-violet)' },
    { label: 'Living expenses', v: t.expense, color: 'var(--brick)', fg: 'var(--on-brick)' },
    { label: 'Into savings', v: t.saving, color: 'var(--ink-3)', fg: 'var(--white)' },
    { label: 'Left over', v: Math.max(0, t.balance), color: 'var(--green)', fg: 'var(--on-green)' }
  ].filter(s => s.v > 0);

  const total = segs.reduce((a, s) => a + s.v, 0);
  bar.innerHTML = '';
  key.innerHTML = '';

  if (!total) {
    key.appendChild(el('span', { class: 'mono-meta', text: 'No income or outflow recorded for the current filter selection.' }));
    cap.textContent = '';
    return;
  }

  segs.forEach(s => {
    const pct = (s.v / total) * 100;
    const segEl = el('div', {
      class: 'flow-seg',
      style: `flex:${s.v} 1 0;background:${s.color};color:${s.fg}`,
      tabindex: '0',
      role: 'img',
      'aria-label': `${s.label}: ${money(s.v)} (${pct.toFixed(1)}%)`
    });
    if (pct > 9) {
      segEl.appendChild(el('span', { class: 'num', text: `${Math.round(pct)}%` }));
    }
    const info = { cat: 'Cash Allocation', val: money(s.v), sub: `${s.label} · ${pct.toFixed(1)}% of flow` };
    segEl.addEventListener('pointerenter', e => tooltip.show(segEl, info, e));
    segEl.addEventListener('pointermove', e => tooltip.show(segEl, info, e));
    segEl.addEventListener('pointerleave', tooltip.hide);
    segEl.addEventListener('focus', () => tooltip.show(segEl, info));
    segEl.addEventListener('blur', tooltip.hide);
    bar.appendChild(segEl);

    const kItem = el('div', { class: 'flow-key-item' }, [
      el('i', { style: `background:${s.color}` }),
      document.createTextNode(`${s.label} `),
      el('b', { class: 'num', text: money(s.v) }),
      el('span', { class: 'mono-meta num', text: ` (${pct.toFixed(1)}%)` })
    ]);
    key.appendChild(kItem);
  });

  cap.textContent =
    t.balance < 0
      ? `${money(t.income)} came in — ${money(-t.balance)} more went out than came in.`
      : `${money(t.income)} came in, ${money(t.outflow)} went out, ${money(t.balance)} remaining.`;
}

/* ============================================================
   01B. UNIT MATRIX CHART (1 square = 1 transaction)
   ============================================================ */
export function renderUnitMatrix(
  hostId: string,
  capId: string,
  rows: Transaction[],
  mode: 'all' | 'type' | 'member' | 'status' | 'pm',
  onAdd?: () => void
) {
  const host = document.getElementById(hostId);
  if (!host) return;

  if (!rows.length) {
    renderChartEmpty(host, 'No transactions in view', 'Add a transaction or clear filters to visualize every ledger row.', onAdd);
    renderFigureCaption(capId, {
      fig: 'FIG. 01',
      caption: 'Transaction unit matrix (empty selection).',
      cols: [{ label: 'Group' }, { label: 'Rows', num: true }, { label: 'Spent (₹)', num: true }],
      rows: []
    });
    return;
  }

  const paletteMap: Record<string, string> = {
    INCOME: 'var(--green)',
    EXPENSE: 'var(--brick)',
    LOAN: 'var(--violet)',
    SAVING: 'var(--ink-3)',
    PAID: 'var(--green)',
    'TO BE PAID': 'var(--marigold)',
    'NOT NECESSARY': 'var(--neutral-data)'
  };
  const fallbackPalette = ['var(--ink)', 'var(--violet)', 'var(--green)', 'var(--brick)', 'var(--marigold)', 'var(--ink-3)'];

  const keyFor = (r: Transaction): string => {
    if (mode === 'type') return r.type || 'OTHER';
    if (mode === 'member') return r.member || 'UNASSIGNED';
    if (mode === 'status') return (r.status || 'UNKNOWN').toUpperCase();
    if (mode === 'pm') return r.pm || 'OTHER';
    return 'All transactions';
  };

  const groups = groupBy(rows, keyFor).sort((a, b) => b.count - a.count);

  const svgNode = svgEl('svg', {
    class: 'matrix-svg is-revealed',
    role: 'group',
    'aria-label': `Unit matrix of ${rows.length} household transactions grouped by ${mode}`
  });
  const labelsLayer = svgEl('g');
  const squaresLayer = svgEl('g');
  const hitLayer = svgEl('g');
  svgNode.appendChild(labelsLayer);
  svgNode.appendChild(squaresLayer);
  svgNode.appendChild(hitLayer);
  host.innerHTML = '';
  host.appendChild(svgNode);

  renderFigureCaption(capId, {
    fig: 'FIG. 01',
    caption: `Unit matrix of ${rows.length} household transactions (${mode === 'all' ? 'all records' : 'grouped by ' + mode}); each square represents one ledger entry.`,
    cols: [
      { label: 'Group' },
      { label: 'Records (n)', num: true },
      { label: 'Share (%)', num: true },
      { label: 'Amount (₹)', num: true }
    ],
    getRows: () =>
      groups.map(g => [
        g.key,
        String(g.count),
        `${((g.count / rows.length) * 100).toFixed(1)} %`,
        money(g.rawSpent || g.rawBudget)
      ])
  });

  function draw() {
    const w = Math.max(260, host!.clientWidth || 500);
    labelsLayer.innerHTML = '';
    squaresLayer.innerHTML = '';
    hitLayer.innerHTML = '';

    const gap = w < 440 ? 4 : 5;

    if (mode === 'all') {
      const cols = Math.min(rows.length, w >= 520 ? 18 : w >= 380 ? 14 : 11);
      const sq = Math.min(22, Math.max(10, (w - (cols - 1) * gap) / cols));
      const step = sq + gap;
      const numRows = Math.ceil(rows.length / cols);
      const h = Math.max(80, numRows * step - gap);
      svgNode.setAttribute('viewBox', `0 0 ${w} ${h}`);

      rows.forEach((r, i) => {
        const c = i % cols;
        const row = Math.floor(i / cols);
        const color = paletteMap[r.type.toUpperCase()] || 'var(--ink-3)';
        const rect = svgEl('rect', {
          class: 'matrix-sq',
          x: (c * step).toFixed(1),
          y: (row * step).toFixed(1),
          width: sq.toFixed(1),
          height: sq.toFixed(1),
          rx: 2,
          fill: color,
          tabindex: 0,
          role: 'img',
          'aria-label': `ID ${r.id} ${r.desc}: ${money(r.spent || r.budget)}`
        });
        const info = {
          cat: `#${r.id} · ${r.type} · ${r.member}`,
          val: money(r.spent || r.budget),
          sub: `${r.desc} (${r.status})`
        };
        rect.addEventListener('pointerenter', e => tooltip.show(rect, info, e));
        rect.addEventListener('pointermove', e => tooltip.show(rect, info, e));
        rect.addEventListener('pointerleave', tooltip.hide);
        rect.addEventListener('focus', () => tooltip.show(rect, info));
        rect.addEventListener('blur', tooltip.hide);
        squaresLayer.appendChild(rect);
      });
      return;
    }

    const twoCol = w >= 480 && groups.length > 1;
    const colGap = 24;
    const blockW = twoCol ? (w - colGap) / 2 : w;
    const blockCols = Math.max(8, Math.min(16, Math.floor(blockW / 18)));
    const sq = Math.min(18, Math.max(9, (blockW - (blockCols - 1) * gap) / blockCols));
    const step = sq + gap;

    let rowY = 0;
    const stride = twoCol ? 2 : 1;

    for (let rIdx = 0; rIdx < groups.length; rIdx += stride) {
      const pair = groups.slice(rIdx, rIdx + stride);
      let maxH = 0;

      pair.forEach((grp, colPos) => {
        const gIdx = rIdx + colPos;
        const baseX = twoCol ? colPos * (blockW + colGap) : 0;
        const color = paletteMap[grp.key.toUpperCase()] || fallbackPalette[gIdx % fallbackPalette.length];
        const share = ((grp.count / rows.length) * 100).toFixed(1);

        labelsLayer.appendChild(
          svgEl('text', {
            x: baseX,
            y: rowY + 13,
            class: 'svg-label',
            text: `${grp.key} · ${grp.count} (${share}%)`
          })
        );

        const gridTop = rowY + 22;
        const nRows = Math.ceil(grp.count / blockCols);
        const blockH = Math.max(sq, nRows * step - gap);
        if (blockH > maxH) maxH = blockH;

        grp.rows.forEach((r, j) => {
          const c = j % blockCols;
          const row = Math.floor(j / blockCols);
          const rect = svgEl('rect', {
            class: 'matrix-sq',
            x: (baseX + c * step).toFixed(1),
            y: (gridTop + row * step).toFixed(1),
            width: sq.toFixed(1),
            height: sq.toFixed(1),
            rx: 2,
            fill: color
          });
          squaresLayer.appendChild(rect);
        });

        const amt = grp.rawSpent || grp.rawBudget;
        const hit = svgEl('rect', {
          x: baseX,
          y: gridTop,
          width: blockW,
          height: blockH,
          fill: 'transparent',
          tabindex: 0,
          role: 'img',
          class: 'matrix-group-hit',
          'aria-label': `${grp.key}: ${grp.count} records, ${money(amt)}`
        });
        const info = {
          cat: `${grp.key} (${grp.count} rows)`,
          val: money(amt),
          sub: `${share}% of transactions · Budget ${money(grp.rawBudget)}`
        };
        hit.addEventListener('pointerenter', e => tooltip.show(hit, info, e));
        hit.addEventListener('pointermove', e => tooltip.show(hit, info, e));
        hit.addEventListener('pointerleave', tooltip.hide);
        hit.addEventListener('focus', () => tooltip.show(hit, info));
        hit.addEventListener('blur', tooltip.hide);
        hitLayer.appendChild(hit);
      });

      rowY += 22 + maxH + 22;
    }

    svgNode.setAttribute('viewBox', `0 0 ${w} ${Math.max(90, rowY - 10)}`);
  }

  const ro = new ResizeObserver(() => requestAnimationFrame(draw));
  ro.observe(host);
  draw();
}

/* ============================================================
   02A. 100% STACKED COMPOSITION BAR
   ============================================================ */
export function renderCompositionStack(
  hostId: string,
  capId: string,
  rows: Transaction[],
  mode: 'outflow' | 'pm'
) {
  const host = document.getElementById(hostId);
  if (!host) return;

  const targetRows = mode === 'outflow' ? rows.filter(r => r.type.toUpperCase() !== 'INCOME') : rows;
  const groups = groupBy(targetRows, r => (mode === 'outflow' ? r.type : r.pm)).sort(
    (a, b) => (b.rawSpent || b.rawBudget) - (a.rawSpent || a.rawBudget)
  );
  const total = groups.reduce((s, g) => s + (mode === 'outflow' ? g.spent : g.rawSpent || g.rawBudget), 0);

  if (!total) {
    renderChartEmpty(host, 'No outflow composition data', 'Add expenses, loans, or savings to see the breakdown.');
    renderFigureCaption(capId, {
      fig: 'FIG. 02A',
      caption: 'Proportional breakdown (no data).',
      cols: [{ label: 'Segment' }, { label: 'Amount', num: true }],
      rows: []
    });
    return;
  }

  const colorFor = (k: string, idx: number) => {
    const u = k.toUpperCase();
    if (u === 'LOAN') return { bg: 'var(--violet)', fg: 'var(--on-violet)' };
    if (u === 'EXPENSE') return { bg: 'var(--brick)', fg: 'var(--on-brick)' };
    if (u === 'SAVING') return { bg: 'var(--ink-3)', fg: 'var(--white)' };
    const seq = [
      { bg: 'var(--ink)', fg: 'var(--paper)' },
      { bg: 'var(--green)', fg: 'var(--on-green)' },
      { bg: 'var(--marigold)', fg: 'var(--on-marigold)' },
      { bg: 'var(--violet)', fg: 'var(--on-violet)' },
      { bg: 'var(--neutral-data)', fg: 'var(--ink)' }
    ];
    return seq[idx % seq.length];
  };

  const items = groups
    .map((g, idx) => {
      const val = mode === 'outflow' ? g.spent : g.rawSpent || g.rawBudget;
      const pct = (val / total) * 100;
      const col = colorFor(g.key, idx);
      return { name: g.key, val, pct, color: col.bg, text: col.fg };
    })
    .filter(i => i.val > 0);

  const svgNode = svgEl('svg', {
    style: 'width:100%;height:auto;display:block;overflow:visible;',
    role: 'group',
    'aria-label': `Proportional breakdown by ${mode}`
  });
  const gBars = svgEl('g');
  svgNode.appendChild(gBars);
  const legendDiv = el('div', { class: 'hm-ramp', style: 'margin-top:var(--s-3);' });

  host.innerHTML = '';
  host.appendChild(svgNode);
  host.appendChild(legendDiv);

  renderFigureCaption(capId, {
    fig: 'FIG. 02A',
    caption: mode === 'outflow' ? 'Proportional share of household outflow by type.' : 'Proportional transaction volume by payment method.',
    cols: [
      { label: mode === 'outflow' ? 'Type' : 'Payment Method' },
      { label: 'Amount (₹)', num: true },
      { label: 'Share (%)', num: true }
    ],
    rows: items.map(i => [i.name, money(i.val), `${i.pct.toFixed(1)} %`])
  });

  function draw() {
    const w = Math.max(260, host!.clientWidth || 500);
    const barH = 44;
    svgNode.setAttribute('viewBox', `0 0 ${w} ${barH}`);
    gBars.innerHTML = '';
    legendDiv.innerHTML = '';

    let x = 0;
    items.forEach(seg => {
      const segW = (seg.pct / 100) * w;
      const r = svgEl('rect', {
        x,
        y: 0,
        width: segW,
        height: barH,
        fill: seg.color,
        tabindex: 0,
        role: 'img',
        'aria-label': `${seg.name}: ${money(seg.val)} (${seg.pct.toFixed(1)}%)`,
        style: 'cursor:pointer;'
      });
      const info = { cat: seg.name, val: money(seg.val), sub: `${seg.pct.toFixed(1)}% of total` };
      r.addEventListener('pointerenter', e => tooltip.show(r, info, e));
      r.addEventListener('pointermove', e => tooltip.show(r, info, e));
      r.addEventListener('pointerleave', tooltip.hide);
      r.addEventListener('focus', () => tooltip.show(r, info));
      r.addEventListener('blur', tooltip.hide);
      gBars.appendChild(r);

      if (segW >= 44) {
        gBars.appendChild(
          svgEl('text', {
            x: x + 8,
            y: 27,
            style: `fill:${seg.text};font-size:12px;font-weight:600;pointer-events:none;`,
            text: `${Math.round(seg.pct)}%`
          })
        );
      }
      x += segW;

      legendDiv.appendChild(
        el('span', { class: 'hm-ramp-item' }, [
          el('span', { class: 'hm-ramp-box', style: `background:${seg.color};` }),
          document.createTextNode(`${seg.name} ${money(seg.val)} (${seg.pct.toFixed(1)}%)`)
        ])
      );
    });
  }

  const ro = new ResizeObserver(() => requestAnimationFrame(draw));
  ro.observe(host);
  draw();
}

/* ============================================================
   02B. INCOME VS OUTFLOW VERTICAL BAR CHART
   ============================================================ */
export function renderIncomeOutflowBar(hostId: string, capId: string, t: Totals) {
  const host = document.getElementById(hostId);
  if (!host) return;

  const items = [
    { label: 'Income', val: t.income, color: 'var(--green)' },
    { label: 'Expenses', val: t.expense, color: 'var(--brick)' },
    { label: 'Loans', val: t.loan, color: 'var(--violet)' },
    { label: 'Savings', val: t.saving, color: 'var(--ink-3)' }
  ];
  const maxVal = Math.max(100, ...items.map(i => i.val));

  if (items.every(i => i.val === 0)) {
    renderChartEmpty(host, 'No cash flow yet', 'Add income or outflow rows to compare flows.');
    return;
  }

  const svgNode = svgEl('svg', {
    style: 'width:100%;height:auto;display:block;overflow:visible;',
    role: 'group',
    'aria-label': 'Income vs outflow comparison'
  });
  host.innerHTML = '';
  host.appendChild(svgNode);

  renderFigureCaption(capId, {
    fig: 'FIG. 02B',
    caption: 'Household inflows compared against living expenses, debt repayments, and savings.',
    cols: [{ label: 'Flow' }, { label: 'Amount (₹)', num: true }],
    rows: items.map(i => [i.label, money(i.val)])
  });

  function draw() {
    const w = Math.max(260, host!.clientWidth || 480);
    const h = 240;
    const padL = 56, padR = 12, padT = 26, padB = 34;
    const yScale = scaleLinear(0, maxVal * 1.12, h - padB, padT);
    svgNode.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svgNode.innerHTML = '';

    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const v = (maxVal * 1.12 * i) / steps;
      const y = yScale(v);
      svgNode.appendChild(
        svgEl('line', {
          x1: padL,
          y1: y,
          x2: w - padR,
          y2: y,
          stroke: i === 0 ? 'var(--ink)' : 'var(--rule)',
          'stroke-width': i === 0 ? 1.5 : 1
        })
      );
      svgNode.appendChild(
        svgEl('text', {
          x: padL - 8,
          y: y + 4,
          'text-anchor': 'end',
          class: 'svg-micro',
          text: compactMoney(v)
        })
      );
    }

    const slotW = (w - padL - padR) / items.length;
    const barW = Math.min(58, slotW * 0.58);
    items.forEach((item, idx) => {
      const cx = padL + slotW * idx + slotW / 2;
      const x = cx - barW / 2;
      const y = yScale(item.val);
      const bh = Math.max(2, yScale(0) - y);

      const rect = svgEl('rect', {
        x,
        y,
        width: barW,
        height: bh,
        rx: 2,
        fill: item.color,
        tabindex: 0,
        role: 'img',
        'aria-label': `${item.label}: ${money(item.val)}`,
        style: 'cursor:pointer;'
      });
      const info = { cat: item.label, val: money(item.val), sub: t.income > 0 ? `${((item.val / t.income) * 100).toFixed(1)}% of income` : '' };
      rect.addEventListener('pointerenter', e => tooltip.show(rect, info, e));
      rect.addEventListener('pointermove', e => tooltip.show(rect, info, e));
      rect.addEventListener('pointerleave', tooltip.hide);
      rect.addEventListener('focus', () => tooltip.show(rect, info));
      rect.addEventListener('blur', tooltip.hide);
      svgNode.appendChild(rect);

      svgNode.appendChild(
        svgEl('text', {
          x: cx,
          y: y - 7,
          'text-anchor': 'middle',
          class: 'svg-micro',
          style: 'fill:var(--ink);font-weight:600;',
          text: compactMoney(item.val)
        })
      );
      svgNode.appendChild(
        svgEl('text', {
          x: cx,
          y: h - 10,
          'text-anchor': 'middle',
          class: 'svg-label',
          style: 'font-size:12px;',
          text: item.label
        })
      );
    });
  }

  const ro = new ResizeObserver(() => requestAnimationFrame(draw));
  ro.observe(host);
  draw();
}

/* ============================================================
   03A. BUDGET VS ACTUAL DUMBBELL COMPARISON
   ============================================================ */
export function renderBudgetDumbbell(
  hostId: string,
  capId: string,
  rows: Transaction[],
  sortBy: 'spent' | 'budget' | 'variance'
) {
  const host = document.getElementById(hostId);
  if (!host) return;

  const outflow = rows.filter(r => r.type.toUpperCase() !== 'INCOME');
  const cats = groupBy(outflow, r => r.category).filter(g => g.budget > 0 || g.spent > 0);

  if (!cats.length) {
    renderChartEmpty(host, 'No budgeted categories', 'Add outflow entries with budget targets to compare planned vs actual.');
    return;
  }

  const sorted = [...cats]
    .sort((a, b) => {
      if (sortBy === 'budget') return b.budget - a.budget;
      if (sortBy === 'variance') return (b.spent - b.budget) - (a.spent - a.budget);
      return b.spent - a.spent;
    })
    .slice(0, 10);

  const maxVal = Math.max(100, ...sorted.flatMap(g => [g.budget, g.spent]));

  const svgNode = svgEl('svg', {
    style: 'width:100%;height:auto;display:block;overflow:visible;',
    role: 'group',
    'aria-label': 'Budget vs actual spending dumbbell comparison'
  });
  host.innerHTML = '';
  host.appendChild(svgNode);

  renderFigureCaption(capId, {
    fig: 'FIG. 03A',
    caption: 'Category budget target (hollow circle) vs actual spend (filled dot). Brick connectors flag overspending.',
    cols: [
      { label: 'Category' },
      { label: 'Budget (₹)', num: true },
      { label: 'Actual (₹)', num: true },
      { label: 'Variance (₹)', num: true }
    ],
    getRows: () => sorted.map(g => [g.key, money(g.budget), money(g.spent), signed(g.variance)])
  });

  function draw() {
    const w = Math.max(280, host!.clientWidth || 540);
    const stacked = w < 460;
    const rH = stacked ? 56 : 42;
    const topPad = 32;
    const labelW = stacked ? 0 : 175;
    const deltaW = stacked ? 0 : 88;
    const plotL = stacked ? 8 : labelW;
    const plotR = stacked ? w - 12 : w - deltaW;
    const xScale = scaleLinear(0, maxVal * 1.08, plotL, plotR);
    const h = topPad + sorted.length * rH + 28;
    svgNode.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svgNode.innerHTML = '';

    // Legend
    svgNode.appendChild(svgEl('circle', { cx: plotL + 5, cy: 10, r: 4.5, fill: 'var(--paper)', stroke: 'var(--ink)', 'stroke-width': 2 }));
    svgNode.appendChild(svgEl('text', { x: plotL + 14, y: 14, class: 'svg-micro', text: 'Budget' }));
    svgNode.appendChild(svgEl('circle', { cx: plotL + 68, cy: 10, r: 5, fill: 'var(--green)' }));
    svgNode.appendChild(svgEl('text', { x: plotL + 78, y: 14, class: 'svg-micro', text: 'On/under' }));
    svgNode.appendChild(svgEl('circle', { cx: plotL + 142, cy: 10, r: 5, fill: 'var(--brick)' }));
    svgNode.appendChild(svgEl('text', { x: plotL + 152, y: 14, class: 'svg-micro', text: 'Over budget' }));

    for (let i = 0; i <= 4; i++) {
      const tick = (maxVal * 1.08 * i) / 4;
      const x = xScale(tick);
      svgNode.appendChild(
        svgEl('line', {
          x1: x,
          y1: topPad,
          x2: x,
          y2: h - 22,
          stroke: i === 0 ? 'var(--ink)' : 'var(--rule)',
          'stroke-width': i === 0 ? 1.5 : 1
        })
      );
      if (i % 2 === 0 || !stacked) {
        svgNode.appendChild(
          svgEl('text', { x, y: h - 6, 'text-anchor': 'middle', class: 'svg-micro', text: compactMoney(tick) })
        );
      }
    }

    sorted.forEach((g, idx) => {
      const y = topPad + idx * rH;
      const trackY = stacked ? 36 : 21;
      const textY = stacked ? 15 : 25;
      const over = g.spent > g.budget;
      const color = over ? 'var(--brick)' : 'var(--green)';
      const x1 = xScale(g.budget);
      const x2 = xScale(g.spent);

      const grp = svgEl('g', { tabindex: 0, role: 'img', style: 'cursor:pointer;', 'aria-label': `${g.key}: budget ${money(g.budget)}, actual ${money(g.spent)}` });
      grp.appendChild(svgEl('rect', { x: 0, y, width: w, height: rH, fill: 'transparent' }));
      const labelText = g.key.length > 22 && !stacked ? g.key.slice(0, 20) + '…' : g.key;
      grp.appendChild(svgEl('text', { x: 0, y: y + textY, class: 'svg-label', style: 'font-size:12.5px;', text: labelText }));

      grp.appendChild(
        svgEl('line', {
          x1,
          y1: y + trackY,
          x2,
          y2: y + trackY,
          stroke: color,
          'stroke-width': 2.5
        })
      );
      grp.appendChild(
        svgEl('circle', {
          cx: x1,
          cy: y + trackY,
          r: 5,
          fill: 'var(--paper)',
          stroke: 'var(--ink)',
          'stroke-width': 2
        })
      );
      grp.appendChild(svgEl('circle', { cx: x2, cy: y + trackY, r: 5.5, fill: color }));

      const deltaStr = `${g.variance >= 0 ? '+' : '−'}${compactMoney(Math.abs(g.variance)).replace('−', '')}`;
      grp.appendChild(
        svgEl('text', {
          x: w,
          y: y + textY,
          'text-anchor': 'end',
          class: 'num',
          style: `font-size:12px;font-weight:600;fill:${over ? 'var(--brick)' : 'var(--green)'};`,
          text: deltaStr
        })
      );

      const info = {
        cat: g.key,
        val: `${money(g.spent)} spent`,
        sub: `Budget ${money(g.budget)} · ${over ? 'Over by ' + money(g.spent - g.budget) : 'Remaining ' + money(g.variance)}`
      };
      grp.addEventListener('pointerenter', e => tooltip.show(grp, info, e));
      grp.addEventListener('pointermove', e => tooltip.show(grp, info, e));
      grp.addEventListener('pointerleave', tooltip.hide);
      grp.addEventListener('focus', () => tooltip.show(grp, info));
      grp.addEventListener('blur', tooltip.hide);
      svgNode.appendChild(grp);
    });
  }

  const ro = new ResizeObserver(() => requestAnimationFrame(draw));
  ro.observe(host);
  draw();
}

/* ============================================================
   03B. ROTATED-NUMERAL KPI BARS (Folio signature adapted to H ∈ M)
   ============================================================ */
export function renderRotatedKpiBars(
  hostId: string,
  capId: string,
  rows: Transaction[],
  memberFilter: string
) {
  const host = document.getElementById(hostId);
  if (!host) return;

  const scope = memberFilter === 'ALL' ? rows : rows.filter(r => r.member === memberFilter);
  const t = totals(scope);
  const totalOut = t.outflow || 1;
  const pcts = [
    { label: 'Loans', val: Math.round((t.loan / totalOut) * 100), amt: t.loan, color: 'var(--violet)', on: 'var(--on-violet)' },
    { label: 'Living', val: Math.round((t.expense / totalOut) * 100), amt: t.expense, color: 'var(--brick)', on: 'var(--on-brick)' },
    { label: 'Savings', val: Math.round((t.saving / totalOut) * 100), amt: t.saving, color: 'var(--ink-3)', on: 'var(--white)' }
  ];
  const maxVal = Math.max(10, ...pcts.map(p => p.val));

  host.innerHTML = '';
  const wrap = el('div', { class: 'rot-bars-wrap' });
  const stage = el('div', { class: 'rot-bars-stage', role: 'group', 'aria-label': 'Outflow share by type' });
  const labels = el('div', { class: 'rot-bars-labels' });

  pcts.forEach(p => {
    const ratio = Math.min(1, p.val / maxVal);
    const btn = el('button', {
      type: 'button',
      class: 'rot-bar-btn',
      style: `--bar-ratio:${ratio.toFixed(4)}`,
      'aria-label': `${p.label}: ${p.val}% (${money(p.amt)})`
    });
    const fill = el('div', { class: 'rot-bar-fill', style: `background:${p.color};transform:scaleY(${ratio.toFixed(4)})` });
    const anchorDark = el('div', { class: 'rot-num-anchor' }, el('span', { class: 'rot-num-text is-active', text: `${p.val}%` }));
    const clip = el('div', { class: 'rot-bar-clip' },
      el('div', { class: 'rot-num-anchor' }, el('span', { class: 'rot-num-text is-active', style: `color:${p.on}`, text: `${p.val}%` }))
    );

    btn.appendChild(fill);
    btn.appendChild(anchorDark);
    btn.appendChild(clip);

    const info = { cat: `${memberFilter === 'ALL' ? 'Household' : memberFilter} · ${p.label}`, val: `${p.val}%`, sub: money(p.amt) };
    btn.addEventListener('pointerenter', e => tooltip.show(btn, info, e));
    btn.addEventListener('pointermove', e => tooltip.show(btn, info, e));
    btn.addEventListener('pointerleave', tooltip.hide);
    btn.addEventListener('focus', () => tooltip.show(btn, info));
    btn.addEventListener('blur', tooltip.hide);

    stage.appendChild(btn);
    labels.appendChild(
      el('div', { class: 'rot-bar-label' }, [
        el('div', { text: p.label }),
        el('div', { class: 'mono-meta num', text: money(p.amt) })
      ])
    );
  });

  wrap.appendChild(stage);
  wrap.appendChild(labels);
  host.appendChild(wrap);

  renderFigureCaption(capId, {
    fig: 'FIG. 03B',
    caption: `Proportional outflow split (${memberFilter === 'ALL' ? 'All household' : memberFilter}) across Loans, Living Expenses, and Savings.`,
    cols: [{ label: 'Outflow Type' }, { label: 'Share (%)', num: true }, { label: 'Amount (₹)', num: true }],
    rows: pcts.map(p => [p.label, `${p.val} %`, money(p.amt)])
  });
}

/* ============================================================
   03C. INTERACTIVE CATEGORY × MEMBER/MONTH HEATMAP
   ============================================================ */
export function renderSpendingHeatmap(
  hostId: string,
  capId: string,
  liveCountId: string,
  rows: Transaction[],
  axis: 'member' | 'month',
  thresholdPct: number
) {
  const host = document.getElementById(hostId);
  const liveCount = document.getElementById(liveCountId);
  if (!host) return;

  const outflow = rows.filter(r => r.type.toUpperCase() !== 'INCOME' && (r.spent > 0 || r.budget > 0));
  if (!outflow.length) {
    renderChartEmpty(host, 'No outflow matrix data', 'Add expenses, loans, or savings to explore the spending intensity matrix.');
    return;
  }

  const colKeys =
    axis === 'month'
      ? MONTHS.filter(m => outflow.some(r => monthOf(r) === m))
      : uniq(outflow.map(r => r.member));

  const catGroups = groupBy(outflow, r => r.category).sort((a, b) => b.spent - a.spent).slice(0, 12);
  const grandTotal = outflow.reduce((s, r) => s + r.spent, 0) || 1;

  interface HmRow {
    cat: string;
    vals: number[]; // amount in ₹
    pcts: number[]; // % of grand outflow
    totalAmt: number;
    totalPct: number;
  }

  const matrix: HmRow[] = catGroups.map(cg => {
    const vals = colKeys.map(ck =>
      cg.rows
        .filter(r => (axis === 'month' ? monthOf(r) === ck : r.member === ck))
        .reduce((s, r) => s + r.spent, 0)
    );
    const pcts = vals.map(v => Math.round((v / grandTotal) * 1000) / 10);
    return {
      cat: cg.key,
      vals,
      pcts,
      totalAmt: cg.spent,
      totalPct: Math.round((cg.spent / grandTotal) * 1000) / 10
    };
  });

  const maxCellPct = Math.max(1, ...matrix.flatMap(r => r.pcts));

  function binStyle(pct: number) {
    const ratio = pct / maxCellPct;
    if (pct === 0) return { bg: 'var(--paper-raised)', fg: 'var(--ink-3)' };
    if (ratio >= 0.75) return { bg: 'var(--violet-600)', fg: 'var(--white)' };
    if (ratio >= 0.50) return { bg: 'var(--violet-500)', fg: 'var(--white)' };
    if (ratio >= 0.30) return { bg: 'var(--violet-400)', fg: 'var(--ink)' };
    if (ratio >= 0.15) return { bg: 'var(--violet-300)', fg: 'var(--ink)' };
    if (ratio >= 0.05) return { bg: 'var(--violet-200)', fg: 'var(--ink)' };
    return { bg: 'var(--violet-100)', fg: 'var(--ink)' };
  }

  let sortCol: number | 'total' | null = null;
  let sortDir: 'asc' | 'desc' = 'desc';

  const capApi = renderFigureCaption(capId, {
    fig: 'FIG. 03C',
    caption: `Spending intensity heatmap across ${catGroups.length} categories and ${colKeys.length} ${axis === 'month' ? 'months' : 'household members'}.`,
    cols: [{ label: 'Category' }, ...colKeys.map(c => ({ label: c, num: true })), { label: 'Total (₹)', num: true }],
    getRows: () => getSorted().map(r => [r.cat, ...r.vals.map(v => money(v)), money(r.totalAmt)])
  });

  function getSorted(): HmRow[] {
    const copy = [...matrix];
    if (sortCol === 'total') {
      copy.sort((a, b) => (sortDir === 'desc' ? b.totalAmt - a.totalAmt : a.totalAmt - b.totalAmt));
    } else if (typeof sortCol === 'number') {
      const idx = sortCol;
      copy.sort((a, b) => (sortDir === 'desc' ? b.vals[idx] - a.vals[idx] : a.vals[idx] - b.vals[idx]));
    }
    return copy;
  }

  function draw() {
    const sorted = getSorted();
    const scrollWrap = el('div', { class: 'heatmap-scroll' });
    const tbl = el('table', { class: 'heatmap-table', role: 'grid', 'aria-label': 'Spending heatmap' });

    const thead = el(
      'thead',
      {},
      el('tr', {}, [
        el('th', { class: 'hm-sector-col', scope: 'col', text: 'Category' }),
        ...colKeys.map((c, idx) => {
          const isSorted = sortCol === idx;
          const btn = el('button', {
            type: 'button',
            class: 'sort-btn',
            html: `${c} <span aria-hidden="true">${isSorted ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>`
          });
          btn.addEventListener('click', () => {
            if (sortCol === idx) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
            else {
              sortCol = idx;
              sortDir = 'desc';
            }
            draw();
            capApi.refreshTable();
          });
          return el('th', { scope: 'col' }, btn);
        }),
        (() => {
          const isSorted = sortCol === 'total';
          const btn = el('button', {
            type: 'button',
            class: 'sort-btn',
            html: `Total <span aria-hidden="true">${isSorted ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>`
          });
          btn.addEventListener('click', () => {
            if (sortCol === 'total') sortDir = sortDir === 'desc' ? 'asc' : 'desc';
            else {
              sortCol = 'total';
              sortDir = 'desc';
            }
            draw();
            capApi.refreshTable();
          });
          return el('th', { scope: 'col', class: 'hm-global-col' }, btn);
        })()
      ])
    );

    const cellMatrix: HTMLButtonElement[][] = [];
    let visibleCount = 0;
    let totalCells = 0;

    const tbody = el(
      'tbody',
      {},
      sorted.map((r, rIdx) => {
        const rowBtns: HTMLButtonElement[] = [];
        const allCols = [...r.vals, r.totalAmt];
        const allPcts = [...r.pcts, r.totalPct];
        const tr = el('tr', {}, [
          el('th', { scope: 'row', class: 'hm-row-label', text: r.cat }),
          ...allCols.map((amt, cIdx) => {
            const pct = allPcts[cIdx];
            const isTotal = cIdx === colKeys.length;
            const st = binStyle(pct);
            const pass = pct >= thresholdPct;
            totalCells++;
            if (pass) visibleCount++;

            const btn = el('button', {
              type: 'button',
              class: `hm-cell-btn num${pass ? '' : ' is-below'}`,
              style: `background:${st.bg};color:${st.fg};`,
              text: amt > 0 ? compactMoney(amt) : '—'
            }) as HTMLButtonElement;

            const colName = isTotal ? 'Total' : colKeys[cIdx];
            const info = {
              cat: `${r.cat} · ${colName}`,
              val: money(amt),
              sub: `${pct.toFixed(1)}% of total outflow`
            };
            btn.addEventListener('pointerenter', e => {
              cellMatrix.forEach((row, ri) =>
                row.forEach((b, ci) => b.classList.toggle('is-dim', ri !== rIdx && ci !== cIdx))
              );
              tooltip.show(btn, info, e);
            });
            btn.addEventListener('pointermove', e => tooltip.show(btn, info, e));
            btn.addEventListener('pointerleave', () => {
              cellMatrix.forEach(row => row.forEach(b => b.classList.remove('is-dim')));
              tooltip.hide();
            });
            btn.addEventListener('focus', () => tooltip.show(btn, info));
            btn.addEventListener('blur', tooltip.hide);
            rowBtns.push(btn);
            return el('td', { class: isTotal ? 'hm-global-col' : '' }, btn);
          })
        ]);
        cellMatrix.push(rowBtns);
        return tr;
      })
    );

    tbl.appendChild(thead);
    tbl.appendChild(tbody);
    scrollWrap.appendChild(tbl);
    host!.innerHTML = '';
    host!.appendChild(scrollWrap);
    if (colKeys.length > 2) {
      host!.appendChild(el('p', { class: 'mono-meta hm-mobile-cue', text: 'Scroll horizontally to view all columns →' }));
    }
    if (liveCount) {
      liveCount.textContent = `${visibleCount} of ${totalCells} cells ≥ ${thresholdPct}%`;
    }
  }

  draw();
}

/* ============================================================
   04A. 10x10 WAFFLE ALLOCATION + ROTATED STAT
   ============================================================ */
export function renderWaffleAllocation(
  hostId: string,
  statHostId: string,
  capId: string,
  rows: Transaction[],
  memberFilter: string
) {
  const host = document.getElementById(hostId);
  const statHost = document.getElementById(statHostId);
  if (!host || !statHost) return;

  const scope = memberFilter === 'ALL' ? rows : rows.filter(r => r.member === memberFilter);
  const t = totals(scope);
  const denom = Math.max(1, t.income || t.outflow);

  const savePct = Math.min(100, Math.round((t.saving / denom) * 100));
  const expPct = Math.min(100 - savePct, Math.round((t.expense / denom) * 100));
  const loanPct = Math.min(100 - savePct - expPct, Math.round((t.loan / denom) * 100));
  const remPct = Math.max(0, 100 - savePct - expPct - loanPct);

  // Update giant rotated stat (Savings % of inflow/outflow)
  statHost.innerHTML = '';
  const anchor = el('div', { class: 'rot-num-anchor' });
  anchor.appendChild(el('span', { class: 'rot-num-text is-active', text: `${savePct}%` }));
  statHost.appendChild(anchor);

  const svgNode = svgEl('svg', {
    style: 'width:100%;max-width:250px;height:auto;display:block;overflow:visible;',
    role: 'img',
    'aria-label': `10x10 allocation waffle: ${savePct}% savings, ${expPct}% expenses, ${loanPct}% loans, ${remPct}% balance`
  });

  const cellSize = 20, gap = 4, step = cellSize + gap, gridSize = 10 * step - gap;
  svgNode.setAttribute('viewBox', `0 0 ${gridSize} ${gridSize}`);

  let idx = 0;
  for (let c = 0; c < 10; c++) {
    for (let r = 0; r < 10; r++) {
      const yRow = 9 - r;
      let fill = 'var(--paper)';
      let stroke = 'var(--ink-3)';
      if (idx < savePct) {
        fill = 'var(--green)';
        stroke = 'var(--green)';
      } else if (idx < savePct + expPct) {
        fill = 'var(--brick)';
        stroke = 'var(--brick)';
      } else if (idx < savePct + expPct + loanPct) {
        fill = 'var(--violet)';
        stroke = 'var(--violet)';
      }
      svgNode.appendChild(
        svgEl('rect', {
          x: c * step,
          y: yRow * step,
          width: cellSize,
          height: cellSize,
          rx: 2,
          fill,
          stroke,
          'stroke-width': 1
        })
      );
      idx++;
    }
  }

  const legend = el('div', { class: 'hm-ramp' }, [
    el('span', { class: 'hm-ramp-item' }, [el('span', { class: 'hm-ramp-box', style: 'background:var(--green);' }), document.createTextNode(`Savings ${savePct}%`)]),
    el('span', { class: 'hm-ramp-item' }, [el('span', { class: 'hm-ramp-box', style: 'background:var(--brick);' }), document.createTextNode(`Expenses ${expPct}%`)]),
    el('span', { class: 'hm-ramp-item' }, [el('span', { class: 'hm-ramp-box', style: 'background:var(--violet);' }), document.createTextNode(`Loans ${loanPct}%`)]),
    el('span', { class: 'hm-ramp-item' }, [el('span', { class: 'hm-ramp-box', style: 'background:var(--paper);border:1px solid var(--ink-3);' }), document.createTextNode(`Balance ${remPct}%`)])
  ]);

  host.innerHTML = '';
  host.appendChild(svgNode);
  host.appendChild(legend);

  renderFigureCaption(capId, {
    fig: 'FIG. 04A',
    caption: `Every ₹100 of ${memberFilter === 'ALL' ? 'household' : memberFilter} flow broken into 100 unit squares.`,
    cols: [{ label: 'Bucket' }, { label: 'Share (%)', num: true }, { label: 'Amount (₹)', num: true }],
    rows: [
      ['Savings', `${savePct} %`, money(t.saving)],
      ['Expenses', `${expPct} %`, money(t.expense)],
      ['Loans', `${loanPct} %`, money(t.loan)],
      ['Remaining', `${remPct} %`, money(Math.max(0, t.balance))]
    ]
  });
}

/* ============================================================
   04B. SAVINGS TREND (Monthly bars + running cumulative line)
   ============================================================ */
export function renderSavingsTrend(hostId: string, capId: string, rows: Transaction[]) {
  const host = document.getElementById(hostId);
  if (!host) return;

  const presentMonths = MONTHS.filter(m => rows.some(r => monthOf(r) === m));
  const mLabels = presentMonths.length ? presentMonths : ['AUG'];
  let run = 0;
  const points = mLabels.map(m => {
    const val = totals(rows.filter(r => monthOf(r) === m)).saving;
    run += val;
    return { m, val, cum: run };
  });

  if (run === 0) {
    renderChartEmpty(host, 'No savings recorded yet', 'Log a transaction with Type = SAVING to track your household wealth growth.');
    return;
  }

  const svgNode = svgEl('svg', {
    style: 'width:100%;height:auto;display:block;overflow:visible;',
    role: 'group',
    'aria-label': 'Savings trend and running cumulative total'
  });
  host.innerHTML = '';
  host.appendChild(svgNode);

  renderFigureCaption(capId, {
    fig: 'FIG. 04B',
    caption: 'Monthly savings contribution bars paired with running cumulative savings line.',
    cols: [{ label: 'Month' }, { label: 'Saved (₹)', num: true }, { label: 'Cumulative (₹)', num: true }],
    rows: points.map(p => [p.m, money(p.val), money(p.cum)])
  });

  function draw() {
    const w = Math.max(260, host!.clientWidth || 500);
    const h = 240;
    const padL = 58, padR = 18, padT = 26, padB = 34;
    const maxY = Math.max(100, ...points.map(p => p.cum)) * 1.15;
    const yScale = scaleLinear(0, maxY, h - padB, padT);
    svgNode.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svgNode.innerHTML = '';

    for (let i = 0; i <= 4; i++) {
      const v = (maxY * i) / 4;
      const y = yScale(v);
      svgNode.appendChild(svgEl('line', { x1: padL, y1: y, x2: w - padR, y2: y, stroke: i === 0 ? 'var(--ink)' : 'var(--rule)', 'stroke-width': i === 0 ? 1.5 : 1 }));
      svgNode.appendChild(svgEl('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end', class: 'svg-micro', text: compactMoney(v) }));
    }

    const slotW = (w - padL - padR) / points.length;
    const barW = Math.min(54, slotW * 0.52);
    const linePts: string[] = [];

    points.forEach((p, idx) => {
      const cx = padL + slotW * idx + slotW / 2;
      const by = yScale(p.val);
      const bh = Math.max(2, yScale(0) - by);
      const rect = svgEl('rect', {
        x: cx - barW / 2,
        y: by,
        width: barW,
        height: bh,
        rx: 2,
        fill: 'var(--ink-3)',
        tabindex: 0,
        role: 'img',
        'aria-label': `${p.m}: saved ${money(p.val)}, cumulative ${money(p.cum)}`
      });
      const info = { cat: `${p.m} Savings`, val: money(p.val), sub: `Cumulative: ${money(p.cum)}` };
      rect.addEventListener('pointerenter', e => tooltip.show(rect, info, e));
      rect.addEventListener('pointermove', e => tooltip.show(rect, info, e));
      rect.addEventListener('pointerleave', tooltip.hide);
      svgNode.appendChild(rect);

      svgNode.appendChild(svgEl('text', { x: cx, y: h - 10, 'text-anchor': 'middle', class: 'svg-micro', text: p.m }));
      linePts.push(`${cx.toFixed(1)},${yScale(p.cum).toFixed(1)}`);
    });

    if (linePts.length > 1) {
      svgNode.appendChild(svgEl('polyline', { fill: 'none', stroke: 'var(--marigold)', 'stroke-width': 2.5, points: linePts.join(' ') }));
    }
    points.forEach((p, idx) => {
      const cx = padL + slotW * idx + slotW / 2;
      const cy = yScale(p.cum);
      svgNode.appendChild(svgEl('circle', { cx, cy, r: 4.5, fill: 'var(--marigold)', stroke: 'var(--paper)', 'stroke-width': 1.5 }));
      svgNode.appendChild(svgEl('text', { x: cx, y: cy - 9, 'text-anchor': 'middle', class: 'svg-micro', style: 'fill:var(--ink);font-weight:600;', text: compactMoney(p.cum) }));
    });
  }

  const ro = new ResizeObserver(() => requestAnimationFrame(draw));
  ro.observe(host);
  draw();
}

/* ============================================================
   05A. LOAN REPAYMENTS HORIZONTAL STACKED BAR
   ============================================================ */
export function renderLoanProgress(hostId: string, capId: string, rows: Transaction[]) {
  const host = document.getElementById(hostId);
  if (!host) return;

  const loans = groupBy(
    rows.filter(r => r.type.toUpperCase() === 'LOAN'),
    r => r.category
  ).sort((a, b) => (b.spent + b.due) - (a.spent + a.due));

  if (!loans.length) {
    renderChartEmpty(host, 'No loan records', 'Add transactions with Type = LOAN to track debt repayment progress.');
    return;
  }

  const maxTotal = Math.max(100, ...loans.map(l => l.spent + l.due));
  const svgNode = svgEl('svg', {
    style: 'width:100%;height:auto;display:block;overflow:visible;',
    role: 'group',
    'aria-label': 'Loan repayments by category'
  });
  host.innerHTML = '';
  host.appendChild(svgNode);

  renderFigureCaption(capId, {
    fig: 'FIG. 05A',
    caption: 'Loan obligations ordered by amount: settled repayments vs remaining amount due.',
    cols: [
      { label: 'Loan Category' },
      { label: 'Repaid (₹)', num: true },
      { label: 'Still Due (₹)', num: true },
      { label: 'Budget (₹)', num: true }
    ],
    rows: loans.map(l => [l.key, money(l.spent), money(l.due), money(l.budget)])
  });

  function draw() {
    const w = Math.max(280, host!.clientWidth || 520);
    const stacked = w < 440;
    const rH = stacked ? 54 : 38;
    const topPad = 28;
    const labelW = stacked ? 0 : 165;
    const valW = stacked ? 0 : 76;
    const plotL = stacked ? 4 : labelW;
    const plotR = stacked ? w - 4 : w - valW;
    const xScale = scaleLinear(0, maxTotal * 1.05, plotL, plotR);
    const h = topPad + loans.length * rH + 16;
    svgNode.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svgNode.innerHTML = '';

    svgNode.appendChild(svgEl('rect', { x: plotL, y: 4, width: 10, height: 10, fill: 'var(--violet)' }));
    svgNode.appendChild(svgEl('text', { x: plotL + 15, y: 13, class: 'svg-micro', text: 'Repaid' }));
    svgNode.appendChild(svgEl('rect', { x: plotL + 72, y: 4, width: 10, height: 10, fill: 'var(--marigold)' }));
    svgNode.appendChild(svgEl('text', { x: plotL + 87, y: 13, class: 'svg-micro', text: 'Still due' }));

    loans.forEach((l, idx) => {
      const y = topPad + idx * rH;
      const barY = stacked ? y + 20 : y + 8;
      const barH = 18;
      const totalAmt = l.spent + l.due;
      const wPaid = Math.max(0, xScale(l.spent) - plotL);
      const wDue = Math.max(0, xScale(totalAmt) - xScale(l.spent));

      const grp = svgEl('g', { tabindex: 0, role: 'img', style: 'cursor:pointer;', 'aria-label': `${l.key}: repaid ${money(l.spent)}, due ${money(l.due)}` });
      grp.appendChild(svgEl('text', { x: 0, y: stacked ? y + 13 : y + 21, class: 'svg-label', style: 'font-size:12px;', text: l.key.length > 22 && !stacked ? l.key.slice(0, 20) + '…' : l.key }));
      if (wPaid > 0) grp.appendChild(svgEl('rect', { x: plotL, y: barY, width: wPaid, height: barH, fill: 'var(--violet)', rx: 2 }));
      if (wDue > 0) grp.appendChild(svgEl('rect', { x: plotL + wPaid, y: barY, width: wDue, height: barH, fill: 'var(--marigold)', rx: 2 }));
      grp.appendChild(svgEl('text', { x: w, y: stacked ? y + 13 : y + 21, 'text-anchor': 'end', class: 'num svg-micro', style: 'fill:var(--ink);font-weight:600;', text: money(totalAmt) }));

      const info = { cat: l.key, val: money(totalAmt), sub: `Repaid: ${money(l.spent)} · Due: ${money(l.due)}` };
      grp.addEventListener('pointerenter', e => tooltip.show(grp, info, e));
      grp.addEventListener('pointermove', e => tooltip.show(grp, info, e));
      grp.addEventListener('pointerleave', tooltip.hide);
      svgNode.appendChild(grp);
    });
  }

  const ro = new ResizeObserver(() => requestAnimationFrame(draw));
  ro.observe(host);
  draw();
}

/* ============================================================
   05B. OBLIGATIONS & SETTLEMENT TIMELINE (Collision-free!)
   ============================================================ */
export function renderObligationsTimeline(
  trackHostId: string,
  detailHostId: string,
  capId: string,
  rows: Transaction[],
  onMarkPaid?: (id: number) => void
) {
  const host = document.getElementById(trackHostId);
  const detailHost = document.getElementById(detailHostId);
  if (!host || !detailHost) return;

  // Prioritize TO BE PAID obligations first, then largest PAID outflows
  const obligations = rows
    .filter(r => r.type.toUpperCase() !== 'INCOME' && (isDue(r) || r.spent > 0 || r.budget > 0))
    .sort((a, b) => {
      const aDue = isDue(a) ? 0 : 1;
      const bDue = isDue(b) ? 0 : 1;
      if (aDue !== bDue) return aDue - bDue;
      return (num(b.spent) || num(b.budget)) - (num(a.spent) || num(a.budget));
    })
    .slice(0, 7);

  if (!obligations.length) {
    host.innerHTML = '';
    detailHost.innerHTML = '<p class="mono-meta">No obligations in this selection.</p>';
    return;
  }

  let selectedId = obligations[0].id;

  function renderDetail() {
    const r = obligations.find(x => x.id === selectedId) || obligations[0];
    const amt = num(r.spent) || num(r.budget);
    const dueFlag = isDue(r);
    detailHost!.innerHTML = '';

    const card = el('div', { class: 'timeline-detail' }, [
      el('div', { class: 'timeline-detail-date num', text: `${fmtDate(r.due || r.date) || r.date} · ${r.member} · ${r.type}` }),
      el('h4', { class: 'timeline-detail-title', text: `${r.desc} — ${money(amt)}` }),
      el('p', {
        class: 'body-single',
        text: `Category: ${r.category} · Payment method: ${r.pm} · Budget: ${money(r.budget)} · Actual: ${money(r.spent)} · Status: ${r.status}`
      })
    ]);

    if (dueFlag && onMarkPaid) {
      const btn = el('button', {
        type: 'button',
        class: 'btn sm gold',
        style: 'margin-top:var(--s-3);',
        text: `Mark #${r.id} as Paid (${money(r.budget)})`
      });
      btn.addEventListener('click', () => onMarkPaid(r.id));
      card.appendChild(btn);
    }
    detailHost!.appendChild(card);
  }

  function draw() {
    host!.innerHTML = '';
    const w = host!.clientWidth || 500;
    const isMobile = w < 520;

    if (!isMobile) {
      // Clean horizontal milestone bar with non-overlapping alternating stagger & bounded text
      const svgNode = svgEl('svg', {
        style: 'width:100%;height:auto;display:block;overflow:visible;',
        role: 'group',
        'aria-label': 'Key household obligations and repayments'
      });
      const padX = 48;
      const h = 136;
      const trackY = 66;
      svgNode.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svgNode.appendChild(svgEl('line', { x1: 12, y1: trackY, x2: w - 12, y2: trackY, stroke: 'var(--ink)', 'stroke-width': 1.5 }));

      const xScale = scaleLinear(0, Math.max(1, obligations.length - 1), padX, w - padX);
      obligations.forEach((r, idx) => {
        const cx = obligations.length === 1 ? w / 2 : xScale(idx);
        const above = idx % 2 === 0;
        const labelY = above ? 20 : 108;
        const stemEnd = above ? 38 : 90;
        const active = r.id === selectedId;
        const dueFlag = isDue(r);

        const g = svgEl('g', { tabindex: 0, role: 'button', style: 'cursor:pointer;', 'aria-pressed': String(active), 'aria-label': `${r.desc}: ${money(num(r.spent) || num(r.budget))}` });
        g.appendChild(svgEl('line', { x1: cx, y1: trackY, x2: cx, y2: stemEnd, stroke: 'var(--rule)', 'stroke-width': 1 }));
        g.appendChild(
          svgEl('rect', {
            x: cx - 6,
            y: trackY - 6,
            width: 12,
            height: 12,
            fill: active ? 'var(--marigold)' : dueFlag ? 'var(--brick)' : 'var(--ink)',
            stroke: 'var(--paper)',
            'stroke-width': 1.5
          })
        );

        const shortDesc = r.desc.length > 13 ? r.desc.slice(0, 12) + '…' : r.desc;
        g.appendChild(
          svgEl('text', {
            x: cx,
            y: labelY,
            'text-anchor': 'middle',
            class: 'svg-micro',
            style: `fill:${active ? 'var(--ink)' : 'var(--ink-2)'};font-weight:${active ? 600 : 500};`,
            text: shortDesc
          })
        );
        g.appendChild(
          svgEl('text', {
            x: cx,
            y: labelY + 13,
            'text-anchor': 'middle',
            class: 'svg-micro num',
            style: `fill:${dueFlag ? 'var(--brick)' : 'var(--ink-3)'};`,
            text: compactMoney(num(r.spent) || num(r.budget))
          })
        );

        g.addEventListener('click', () => {
          selectedId = r.id;
          draw();
          renderDetail();
        });
        g.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectedId = r.id;
            draw();
            renderDetail();
          }
        });
        svgNode.appendChild(g);
      });
      host!.appendChild(svgNode);
    }

    // Ergonomic tap list (always crisp on mobile and great quick-picker on desktop)
    const list = el('div', { class: 'tl-mobile-list', style: isMobile ? 'display:grid;' : '' });
    obligations.forEach(r => {
      const dueFlag = isDue(r);
      const amt = num(r.spent) || num(r.budget);
      const btn = el(
        'button',
        {
          type: 'button',
          class: 'tl-mobile-btn',
          'aria-pressed': String(r.id === selectedId)
        },
        [
          el('span', { class: 'tl-mobile-sq', style: dueFlag ? 'background:var(--marigold);' : '' }),
          el('span', { class: 'tl-mobile-date num', text: compactMoney(amt) }),
          el('span', { class: 'tl-mobile-title', text: `${r.desc} (${r.status})` })
        ]
      );
      btn.addEventListener('click', () => {
        selectedId = r.id;
        draw();
        renderDetail();
      });
      list.appendChild(btn);
    });
    host!.appendChild(list);
  }

  renderFigureCaption(capId, {
    fig: 'FIG. 05B',
    caption: 'Priority obligations and major scheduled payments. Select any item to inspect or settle.',
    cols: [{ label: 'Description' }, { label: 'Category' }, { label: 'Amount (₹)', num: true }, { label: 'Status' }],
    rows: obligations.map(r => [r.desc, r.category, money(num(r.spent) || num(r.budget)), r.status])
  });

  const ro = new ResizeObserver(() => requestAnimationFrame(draw));
  ro.observe(host);
  draw();
  renderDetail();
}

/* ============================================================
   07A. SCROLLYTELLING STACKED COLUMNS
   ============================================================ */
export function renderScrollyColumns(
  hostId: string,
  legendId: string,
  capId: string,
  rows: Transaction[],
  stepIdx: number,
  mode: 'abs' | 'share',
  activeKeys: Set<string>,
  onToggleKey: (k: string) => void
) {
  const host = document.getElementById(hostId);
  const legendHost = document.getElementById(legendId);
  if (!host || !legendHost) return;

  const series = [
    { key: 'expense', label: 'Living Expenses', color: 'var(--brick)' },
    { key: 'loan', label: 'Loans & Debt', color: 'var(--violet)' },
    { key: 'saving', label: 'Savings', color: 'var(--green)' }
  ];

  legendHost.innerHTML = '';
  series.forEach(s => {
    const active = activeKeys.has(s.key);
    const chip = el('button', { type: 'button', class: 'legend-chip', 'aria-pressed': String(active) }, [
      el('span', { class: 'legend-swatch', style: `background:${s.color}` }),
      el('span', { text: s.label })
    ]);
    chip.addEventListener('click', () => onToggleKey(s.key));
    legendHost.appendChild(chip);
  });

  // Group by active members so even single-month data yields a multi-column comparative chart!
  const members = uniq(rows.map(r => r.member)).filter(m => {
    const t = totals(rows.filter(r => r.member === m));
    return t.expense + t.loan + t.saving > 0;
  });

  if (!members.length) {
    renderChartEmpty(host, 'No outflow columns', 'Add outflow records to explore household member allocation columns.');
    return;
  }

  const colData = members.map(m => {
    const t = totals(rows.filter(r => r.member === m));
    return { label: m, expense: t.expense, loan: t.loan, saving: t.saving };
  });

  const svgNode = svgEl('svg', {
    style: 'width:100%;height:auto;display:block;overflow:visible;',
    role: 'group',
    'aria-label': 'Stacked outflow columns by member'
  });
  host.innerHTML = '';
  host.appendChild(svgNode);

  renderFigureCaption(capId, {
    fig: 'FIG. 07A',
    caption: 'Interactive scrollytelling columns across household members with series focus and absolute/share modes.',
    cols: [
      { label: 'Member' },
      { label: 'Expenses (₹)', num: true },
      { label: 'Loans (₹)', num: true },
      { label: 'Savings (₹)', num: true }
    ],
    rows: colData.map(d => [d.label, money(d.expense), money(d.loan), money(d.saving)])
  });

  function isHighlighted(key: string) {
    if (stepIdx === 0) return key === 'loan';
    if (stepIdx === 1) return key === 'expense';
    return true;
  }

  function draw() {
    const w = Math.max(260, host!.clientWidth || 500);
    const h = 300;
    const padL = 56, padR = 14, padT = 26, padB = 36;
    const plotH = h - padT - padB;

    const maxSum =
      mode === 'share'
        ? 100
        : Math.max(
            100,
            ...colData.map(d =>
              series.filter(s => activeKeys.has(s.key)).reduce((a, s) => a + (d as any)[s.key], 0)
            )
          ) * 1.12;
    const yScale = scaleLinear(0, maxSum, padT + plotH, padT);

    svgNode.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svgNode.innerHTML = '';

    for (let i = 0; i <= 4; i++) {
      const v = (maxSum * i) / 4;
      const y = yScale(v);
      svgNode.appendChild(svgEl('line', { x1: padL, y1: y, x2: w - padR, y2: y, stroke: i === 0 ? 'var(--ink)' : 'var(--rule)', 'stroke-width': i === 0 ? 1.5 : 1 }));
      svgNode.appendChild(
        svgEl('text', {
          x: padL - 8,
          y: y + 4,
          'text-anchor': 'end',
          class: 'svg-micro',
          text: mode === 'share' ? `${Math.round(v)}%` : compactMoney(v)
        })
      );
    }

    const slotW = (w - padL - padR) / colData.length;
    const barW = Math.min(64, Math.max(24, slotW * 0.56));

    colData.forEach((d, idx) => {
      const cx = padL + slotW * idx + slotW / 2;
      const x = cx - barW / 2;
      const activeSum = series.filter(s => activeKeys.has(s.key)).reduce((a, s) => a + (d as any)[s.key], 0);
      let acc = 0;

      series.forEach(s => {
        if (!activeKeys.has(s.key)) return;
        const raw = (d as any)[s.key] as number;
        if (raw <= 0) return;
        const val = mode === 'share' ? (activeSum > 0 ? (raw / activeSum) * 100 : 0) : raw;
        const yTop = yScale(acc + val);
        const yBot = yScale(acc);
        const hi = isHighlighted(s.key);

        const rect = svgEl('rect', {
          x,
          y: yTop,
          width: barW,
          height: Math.max(1, yBot - yTop),
          fill: hi ? s.color : 'var(--neutral-data)',
          tabindex: 0,
          role: 'img',
          'aria-label': `${d.label} ${s.label}: ${money(raw)}`
        });
        const info = { cat: `${d.label} · ${s.label}`, val: money(raw), sub: activeSum > 0 ? `${((raw / activeSum) * 100).toFixed(1)}% of member outflow` : '' };
        rect.addEventListener('pointerenter', e => tooltip.show(rect, info, e));
        rect.addEventListener('pointermove', e => tooltip.show(rect, info, e));
        rect.addEventListener('pointerleave', tooltip.hide);
        svgNode.appendChild(rect);
        acc += val;
      });

      const topY = yScale(mode === 'share' ? 100 : activeSum);
      svgNode.appendChild(
        svgEl('text', {
          x: cx,
          y: topY - 7,
          'text-anchor': 'middle',
          class: 'svg-micro num',
          style: 'fill:var(--ink);font-weight:600;',
          text: mode === 'share' ? '100%' : compactMoney(activeSum)
        })
      );
      svgNode.appendChild(svgEl('text', { x: cx, y: padT + plotH + 18, 'text-anchor': 'middle', class: 'svg-label', style: 'font-size:12px;', text: d.label }));
    });
  }

  const ro = new ResizeObserver(() => requestAnimationFrame(draw));
  ro.observe(host);
  draw();
}

/* ============================================================
   07B. BUDGET VS ACTUAL SCATTER + LIVE OLS REGRESSION
   ============================================================ */
export function renderBudgetScatterOLS(
  hostId: string,
  chipsHostId: string,
  capId: string,
  rows: Transaction[],
  minBudget: number,
  showTrend: boolean,
  activeTypes: Set<string>,
  onToggleType: (t: string) => void,
  onMetrics: (slopeText: string, r2Text: string) => void
) {
  const host = document.getElementById(hostId);
  const chipsHost = document.getElementById(chipsHostId);
  if (!host || !chipsHost) return;

  const types = [
    { key: 'EXPENSE', label: 'Expense', color: 'var(--brick)', shape: 'square' },
    { key: 'LOAN', label: 'Loan', color: 'var(--violet)', shape: 'triangle' },
    { key: 'SAVING', label: 'Saving', color: 'var(--green)', shape: 'circle' }
  ];

  chipsHost.innerHTML = '';
  types.forEach(t => {
    const btn = el('button', {
      type: 'button',
      class: 'seg-btn',
      'aria-pressed': String(activeTypes.has(t.key))
    }, [
      el('span', { class: 'legend-swatch', style: `background:${t.color};border-radius:${t.shape === 'circle' ? '50%' : '0'}` }),
      el('span', { text: t.label })
    ]);
    btn.addEventListener('click', () => onToggleType(t.key));
    chipsHost.appendChild(btn);
  });

  const pts = rows.filter(r => r.type.toUpperCase() !== 'INCOME' && (r.budget > 0 || r.spent > 0));
  if (!pts.length) {
    renderChartEmpty(host, 'No budgeted transactions', 'Add outflow entries to plot Budget vs Actual correlation.');
    onMetrics('—', 'R² —');
    return;
  }

  const isVisible = (r: Transaction) => activeTypes.has(r.type.toUpperCase()) && r.budget >= minBudget;
  const visible = pts.filter(isVisible);
  const maxVal = Math.max(1000, ...pts.flatMap(r => [r.budget, r.spent])) * 1.08;

  const svgNode = svgEl('svg', {
    style: 'width:100%;height:auto;display:block;overflow:visible;',
    role: 'group',
    'aria-label': 'Budget vs Actual scatter plot with OLS regression'
  });
  host.innerHTML = '';
  host.appendChild(svgNode);

  renderFigureCaption(capId, {
    fig: 'FIG. 07B',
    caption: 'Transaction-level Budget (x) vs Actual Spend (y) with 1:1 parity line and OLS linear regression.',
    cols: [
      { label: 'Description' },
      { label: 'Type' },
      { label: 'Budget (₹)', num: true },
      { label: 'Actual (₹)', num: true }
    ],
    getRows: () => visible.map(r => [r.desc, r.type, money(r.budget), money(r.spent)])
  });

  function computeOLS(list: Transaction[]) {
    if (list.length < 2) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    list.forEach(p => {
      sx += p.budget;
      sy += p.spent;
      sxx += p.budget * p.budget;
      sxy += p.budget * p.spent;
    });
    const mx = sx / list.length;
    const my = sy / list.length;
    const den = sxx - list.length * mx * mx;
    if (Math.abs(den) < 1e-9) return null;
    const slope = (sxy - list.length * mx * my) / den;
    const intercept = my - slope * mx;
    let ssRes = 0, ssTot = 0;
    list.forEach(p => {
      ssRes += (p.spent - (slope * p.budget + intercept)) ** 2;
      ssTot += (p.spent - my) ** 2;
    });
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
    return { slope, intercept, r2 };
  }

  const ols = computeOLS(visible);
  if (ols) {
    onMetrics(`₹${ols.slope.toFixed(2)} spent per ₹1 budgeted`, `R² ${ols.r2.toFixed(2)}`);
  } else {
    onMetrics('Insufficient points', 'R² —');
  }

  function draw() {
    const w = Math.max(260, host!.clientWidth || 500);
    const h = 300;
    const padL = 58, padR = 16, padT = 20, padB = 38;
    const xScale = scaleLinear(0, maxVal, padL, w - padR);
    const yScale = scaleLinear(0, maxVal, h - padB, padT);
    svgNode.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svgNode.innerHTML = '';

    for (let i = 0; i <= 4; i++) {
      const v = (maxVal * i) / 4;
      const y = yScale(v);
      const x = xScale(v);
      svgNode.appendChild(svgEl('line', { x1: padL, y1: y, x2: w - padR, y2: y, stroke: i === 0 ? 'var(--ink)' : 'var(--rule)', 'stroke-width': i === 0 ? 1.5 : 1 }));
      svgNode.appendChild(svgEl('line', { x1: x, y1: padT, x2: x, y2: h - padB, stroke: i === 0 ? 'var(--ink)' : 'var(--rule)', 'stroke-width': i === 0 ? 1.5 : 1 }));
      svgNode.appendChild(svgEl('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end', class: 'svg-micro', text: compactMoney(v) }));
      svgNode.appendChild(svgEl('text', { x, y: h - 20, 'text-anchor': 'middle', class: 'svg-micro', text: compactMoney(v) }));
    }

    svgNode.appendChild(svgEl('text', { x: padL, y: 12, class: 'svg-micro', text: 'Actual Spent (₹)' }));
    svgNode.appendChild(svgEl('text', { x: w - padR, y: h - 4, 'text-anchor': 'end', class: 'svg-micro', text: 'Budgeted (₹) →' }));

    // 1:1 Parity line (Budget = Actual)
    svgNode.appendChild(
      svgEl('line', {
        x1: xScale(0),
        y1: yScale(0),
        x2: xScale(maxVal),
        y2: yScale(maxVal),
        stroke: 'var(--ink-3)',
        'stroke-width': 1,
        'stroke-dasharray': '3 3'
      })
    );

    if (ols && showTrend) {
      const xs = visible.map(d => d.budget);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      svgNode.appendChild(
        svgEl('line', {
          x1: xScale(x0),
          y1: yScale(Math.max(0, Math.min(maxVal, ols.slope * x0 + ols.intercept))),
          x2: xScale(x1),
          y2: yScale(Math.max(0, Math.min(maxVal, ols.slope * x1 + ols.intercept))),
          stroke: 'var(--ink)',
          'stroke-width': 2,
          'stroke-dasharray': '6 4'
        })
      );
    }

    pts.forEach(r => {
      const active = isVisible(r);
      const cx = xScale(r.budget);
      const cy = yScale(r.spent);
      const spec = types.find(t => t.key === r.type.toUpperCase()) || types[0];
      const fill = active ? spec.color : 'var(--neutral-data)';

      const g = svgEl('g', { style: `opacity:${active ? 1 : 0.35};cursor:pointer;`, tabindex: active ? 0 : -1, role: 'img', 'aria-label': `${r.desc}: budget ${money(r.budget)}, spent ${money(r.spent)}` });
      g.appendChild(svgEl('circle', { cx, cy, r: 10, fill: 'transparent' }));
      if (spec.shape === 'square') {
        g.appendChild(svgEl('rect', { x: cx - 4.5, y: cy - 4.5, width: 9, height: 9, fill }));
      } else if (spec.shape === 'triangle') {
        g.appendChild(svgEl('polygon', { points: `${cx},${cy - 5.5} ${cx + 5},${cy + 4.5} ${cx - 5},${cy + 4.5}`, fill }));
      } else {
        g.appendChild(svgEl('circle', { cx, cy, r: 5, fill }));
      }
      const info = { cat: `${r.type} · ${r.member}`, val: r.desc, sub: `Budget ${money(r.budget)} · Actual ${money(r.spent)}` };
      g.addEventListener('pointerenter', e => tooltip.show(g, info, e));
      g.addEventListener('pointermove', e => tooltip.show(g, info, e));
      g.addEventListener('pointerleave', tooltip.hide);
      svgNode.appendChild(g);
    });
  }

  const ro = new ResizeObserver(() => requestAnimationFrame(draw));
  ro.observe(host);
  draw();
}

/* ============================================================
   01C. SIX-MONTH INLINE CATEGORY SPARKLINES (OVERVIEW)
   ============================================================ */
function buildSmoothPath(pts: Array<{ x: number; y: number }>, minY: number, maxY: number): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const clampY = (val: number) => Math.max(minY, Math.min(maxY, val));
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = clampY(p1.y + (p2.y - p0.y) / 6);
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = clampY(p2.y - (p3.y - p1.y) / 6);
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

export function renderCategorySparklines(
  hostId: string,
  windowLabelId: string,
  allRows: Transaction[],
  filters: FilterState,
  flowMode: 'all' | 'INCOME' | 'EXPENSE',
  onAdd?: () => void
) {
  const host = document.getElementById(hostId);
  const winLabel = document.getElementById(windowLabelId);
  if (!host) return;

  // Apply non-date filters so 6-month trend remains visible across months
  const scoped = allRows.filter(
    r =>
      (filters.member === 'ALL' || r.member === filters.member) &&
      (filters.type === 'ALL' || r.type === filters.type) &&
      (filters.category === 'ALL' || r.category === filters.category) &&
      (filters.pm === 'ALL' || r.pm === filters.pm) &&
      (filters.status === 'ALL' || r.status === filters.status)
  );

  // Determine anchor month (selected year+month if both chosen, else latest date in scoped/allRows)
  let anchorYm = '';
  if (filters.year !== 'ALL' && filters.month !== 'ALL') {
    const mIdx = MONTHS.indexOf(filters.month);
    if (mIdx >= 0) anchorYm = `${filters.year}-${String(mIdx + 1).padStart(2, '0')}`;
  }
  if (!anchorYm) {
    const matched = (scoped.length ? scoped : allRows).filter(
      r =>
        (filters.year === 'ALL' || yearOf(r) === filters.year) &&
        (filters.month === 'ALL' || monthOf(r) === filters.month)
    );
    const pool = matched.length ? matched : scoped.length ? scoped : allRows;
    const ymCandidates = pool
      .map(r => (r.date || '').slice(0, 7))
      .filter(ym => /^\d{4}-\d{2}$/.test(ym))
      .sort();
    anchorYm = ymCandidates.length
      ? ymCandidates[ymCandidates.length - 1]
      : new Date().toISOString().slice(0, 7);
  }

  const [aYear, aMonth] = anchorYm.split('-').map(Number);
  const windowMonths: Array<{ ym: string; short: string; label: string }> = [];
  for (let offset = -5; offset <= 0; offset++) {
    const d = new Date(Date.UTC(aYear, (aMonth || 1) - 1 + offset, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const ym = `${y}-${String(m + 1).padStart(2, '0')}`;
    const short = MONTH_NAMES[m];
    windowMonths.push({ ym, short, label: `${short} ${y}` });
  }

  if (winLabel) {
    winLabel.textContent = `6-month window: ${windowMonths[0].label} – ${windowMonths[5].label}`;
  }

  const windowYmSet = new Set(windowMonths.map(w => w.ym));
  const monthsWithHistory = new Set(
    scoped
      .map(r => (r.date || '').slice(0, 7))
      .filter(ym => windowYmSet.has(ym))
  );

  const flowRows = scoped.filter(r => {
    const ty = r.type.toUpperCase();
    if (flowMode === 'INCOME') return ty === 'INCOME';
    if (flowMode === 'EXPENSE') return ty === 'EXPENSE';
    return ty === 'INCOME' || ty === 'EXPENSE';
  });

  if (!flowRows.length) {
    renderChartEmpty(
      host,
      'No income or expense history in view',
      'Add income or expense transactions or adjust filters to view 6-month category sparklines.',
      onAdd
    );
    return;
  }

  const groups = groupBy(flowRows, r => `${r.type.toUpperCase()}::${r.category.toUpperCase()}`);
  const cards = groups
    .map(g => {
      const [type, category] = g.key.split('::');
      const series = windowMonths.map(wm => {
        const hasHistory = monthsWithHistory.has(wm.ym);
        const monthRows = g.rows.filter(r => (r.date || '').slice(0, 7) === wm.ym);
        const actual = monthRows.reduce((s, r) => s + num(r.spent), 0);
        const planned = monthRows.reduce((s, r) => s + num(r.budget), 0);
        return {
          ...wm,
          hasHistory,
          amount: actual,
          planned,
          rowCount: monthRows.length
        };
      });

      const curr = series[5];
      const prev = series[4];
      const currVal = curr.amount;
      const prevVal = prev.amount;

      let pctDelta: number | null = null;
      let deltaText = 'No prior month data';
      let deltaTone: 'pos' | 'neg' | 'neutral' = 'neutral';

      if (prev.hasHistory && prevVal > 0) {
        pctDelta = ((currVal - prevVal) / prevVal) * 100;
        const sign = pctDelta > 0 ? '+' : pctDelta < 0 ? '−' : '';
        deltaText = `${sign}${Math.abs(pctDelta).toFixed(1)}% vs ${prev.short}`;
        if (Math.abs(pctDelta) < 0.05) {
          deltaTone = 'neutral';
        } else if (type === 'INCOME') {
          deltaTone = pctDelta >= 0 ? 'pos' : 'neg';
        } else {
          deltaTone = pctDelta <= 0 ? 'pos' : 'neg';
        }
      } else if (prev.hasHistory && prevVal === 0 && currVal > 0) {
        deltaText = `New in ${curr.short}`;
        deltaTone = type === 'INCOME' ? 'pos' : 'neutral';
      } else if (curr.rowCount > 0 && currVal === 0 && curr.planned > 0) {
        deltaText = `Planned ${money(curr.planned)} (unpaid)`;
      }

      const activePointCount = series.filter(p => p.hasHistory).length;
      return {
        type,
        category,
        series,
        currVal,
        currPlanned: curr.planned,
        currLabel: curr.label,
        pctDelta,
        deltaText,
        deltaTone,
        activePointCount
      };
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'INCOME' ? -1 : 1;
      return b.currVal - a.currVal || b.currPlanned - a.currPlanned;
    });

  host.innerHTML = '';
  const grid = el('div', { class: 'spark-grid' });

  cards.forEach((cardData, cardIdx) => {
    const isIncome = cardData.type === 'INCOME';
    const strokeColor = isIncome ? 'var(--green)' : 'var(--brick)';
    const gradId = `spark-grad-${cardIdx}-${isIncome ? 'inc' : 'exp'}`;

    const deltaCls =
      cardData.deltaTone === 'pos'
        ? 'spark-delta is-good'
        : cardData.deltaTone === 'neg'
          ? 'spark-delta is-bad'
          : 'spark-delta';

    const card = el('article', {
      class: `spark-card ${isIncome ? 'is-income' : 'is-expense'}`,
      'aria-label': `${cardData.category} (${cardData.type}): ${money(cardData.currVal)}`
    });

    const header = el('div', { class: 'spark-card-top' }, [
      el('div', { class: 'spark-cat-group' }, [
        el('span', { class: 'spark-type-dot', style: `background:${strokeColor}`, 'aria-hidden': 'true' }),
        el('span', { class: 'spark-type-tag', text: isIncome ? 'Income' : 'Expense' })
      ]),
      el('span', { class: 'mono-meta', text: cardData.currLabel })
    ]);

    const title = el('h4', { class: 'spark-cat-title', text: cardData.category });

    const metricRow = el('div', { class: 'spark-metric-row' }, [
      el('span', { class: 'spark-amount num', text: money(cardData.currVal) }),
      el('span', { class: `${deltaCls} num`, text: cardData.deltaText })
    ]);

    const chartWrap = el('div', { class: 'spark-svg-wrap' });
    const w = 220;
    const h = 54;
    const padX = 10;
    const padT = 8;
    const padB = 10;
    const xStep = (w - padX * 2) / 5;

    const svgNode = svgEl('svg', {
      viewBox: `0 0 ${w} ${h}`,
      class: 'spark-svg',
      role: 'img',
      'aria-label': `6-month sparkline for ${cardData.category}`
    });

    const defs = svgEl('defs');
    const grad = svgEl('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' });
    grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': strokeColor, 'stop-opacity': '0.24' }));
    grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': strokeColor, 'stop-opacity': '0.0' }));
    defs.appendChild(grad);
    svgNode.appendChild(defs);

    const historyVals = cardData.series.filter(p => p.hasHistory).map(p => p.amount);
    const maxV = Math.max(100, ...historyVals);
    const yScale = scaleLinear(0, maxV * 1.15, h - padB, padT);

    // Subtle baseline
    svgNode.appendChild(
      svgEl('line', {
        x1: padX,
        y1: h - padB,
        x2: w - padX,
        y2: h - padB,
        stroke: 'var(--rule)',
        'stroke-width': 1,
        'stroke-dasharray': cardData.activePointCount < 2 ? '3 3' : undefined
      })
    );

    const plotted = cardData.series
      .map((pt, idx) => ({
        ...pt,
        x: padX + idx * xStep,
        y: yScale(pt.amount)
      }))
      .filter(pt => pt.hasHistory);

    if (plotted.length >= 2) {
      const pathD = buildSmoothPath(plotted, padT, h - padB);
      const areaD = `${pathD} L ${plotted[plotted.length - 1].x.toFixed(2)} ${(h - padB).toFixed(2)} L ${plotted[0].x.toFixed(2)} ${(h - padB).toFixed(2)} Z`;
      svgNode.appendChild(svgEl('path', { d: areaD, fill: `url(#${gradId})` }));
      svgNode.appendChild(
        svgEl('path', {
          d: pathD,
          fill: 'none',
          stroke: strokeColor,
          'stroke-width': 2.25,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round'
        })
      );
    } else {
      svgNode.appendChild(
        svgEl('text', {
          x: padX + 2,
          y: h / 2 - 2,
          class: 'svg-micro',
          style: 'font-size:9.5px;fill:var(--ink-3);',
          text: plotted.length === 1 ? 'Single month recorded (need 2+ mo for trend)' : 'No historical trend data'
        })
      );
    }

    // Hover dots and accessible month columns across all 6 months
    const slotW = (w - padX * 2) / 6;
    cardData.series.forEach((pt, idx) => {
      const cx = padX + idx * xStep;
      const cy = yScale(pt.amount);
      const dot = pt.hasHistory
        ? svgEl('circle', {
            cx,
            cy,
            r: idx === 5 || plotted.length === 1 ? 3.5 : 2.2,
            fill: idx === 5 ? strokeColor : 'var(--paper-raised)',
            stroke: strokeColor,
            'stroke-width': 1.75,
            class: 'spark-dot'
          })
        : svgEl('circle', {
            cx,
            cy: h - padB,
            r: 2,
            fill: 'var(--rule)'
          });
      svgNode.appendChild(dot);

      const hit = svgEl('rect', {
        x: (padX - slotW / 2 + idx * xStep).toFixed(1),
        y: 0,
        width: (slotW + 6).toFixed(1),
        height: h,
        fill: 'transparent',
        tabindex: 0,
        role: 'img',
        style: 'cursor:pointer;',
        'aria-label': pt.hasHistory
          ? `${cardData.category} · ${pt.label}: ${money(pt.amount)}`
          : `${cardData.category} · ${pt.label}: no historical data`
      });

      const info = {
        cat: `${cardData.category} · ${pt.label}`,
        val: pt.hasHistory ? money(pt.amount) : 'No history',
        sub: pt.hasHistory
          ? `${pt.rowCount} transaction${pt.rowCount === 1 ? '' : 's'}${pt.planned > 0 ? ` · Planned ${money(pt.planned)}` : ''}`
          : 'No records logged in this month'
      };
      hit.addEventListener('pointerenter', e => {
        dot.setAttribute('r', '4.5');
        tooltip.show(hit, info, e);
      });
      hit.addEventListener('pointermove', e => tooltip.show(hit, info, e));
      hit.addEventListener('pointerleave', () => {
        dot.setAttribute('r', pt.hasHistory ? (idx === 5 || plotted.length === 1 ? '3.5' : '2.2') : '2');
        tooltip.hide();
      });
      hit.addEventListener('focus', () => {
        dot.setAttribute('r', '4.5');
        tooltip.show(hit, info);
      });
      hit.addEventListener('blur', () => {
        dot.setAttribute('r', pt.hasHistory ? (idx === 5 || plotted.length === 1 ? '3.5' : '2.2') : '2');
        tooltip.hide();
      });
      svgNode.appendChild(hit);
    });

    chartWrap.appendChild(svgNode);

    const footerNote = el('div', { class: 'spark-card-foot' }, [
      el('span', { class: 'mono-meta', text: windowMonths[0].short }),
      el('span', {
        class: 'mono-meta',
        text:
          cardData.activePointCount < 2
            ? `${cardData.activePointCount}/6 mo recorded`
            : `${cardData.activePointCount}/6 mo active`
      }),
      el('span', { class: 'mono-meta', text: windowMonths[5].short })
    ]);

    card.appendChild(header);
    card.appendChild(title);
    card.appendChild(metricRow);
    card.appendChild(chartWrap);
    card.appendChild(footerNote);
    grid.appendChild(card);
  });

  host.appendChild(grid);
}

/* ============================================================
   03D. BUDGET INTELLIGENCE — VISUAL SPENDING PROGRESS CARDS
   ============================================================ */
export function renderBudgetProgressCards(
  hostId: string,
  rows: Transaction[],
  filterMode: 'all' | 'alerts' | 'healthy',
  sortBy: 'spent' | 'budget' | 'variance'
) {
  const host = document.getElementById(hostId);
  if (!host) return;

  const outflow = rows.filter(r => r.type.toUpperCase() !== 'INCOME');
  const cats = groupBy(outflow, r => r.category).filter(g => g.budget > 0 || g.spent > 0);

  if (!cats.length) {
    renderChartEmpty(
      host,
      'No budget categories in view',
      'Add expense, loan, or saving transactions to track visual category progress.'
    );
    return;
  }

  const enriched = cats
    .map(g => {
      const allocated = g.budget;
      const actual = g.spent;
      const remaining = allocated - actual;
      const hasBudget = allocated > 0;
      const pct = hasBudget ? (actual / allocated) * 100 : actual > 0 ? 100 : 0;
      const barWidth = Math.min(100, Math.max(0, pct));

      let tier: 'tier-green' | 'tier-amber' | 'tier-orange' | 'tier-red' | 'tier-neutral' = 'tier-green';
      let statusLabel = 'Healthy spending';

      if (!hasBudget && actual === 0) {
        tier = 'tier-neutral';
        statusLabel = 'No budget set';
      } else if (!hasBudget && actual > 0) {
        tier = 'tier-red';
        statusLabel = 'Unbudgeted spend';
      } else if (pct >= 100) {
        tier = 'tier-red';
        statusLabel = actual > allocated ? 'Budget exceeded' : 'Budget reached';
      } else if (pct >= 85) {
        tier = 'tier-orange';
        statusLabel = 'High spending';
      } else if (pct >= 70) {
        tier = 'tier-amber';
        statusLabel = 'Approaching limit';
      } else {
        tier = 'tier-green';
        statusLabel = 'Healthy spending';
      }

      const pctText = !hasBudget && actual > 0 ? 'Unbudgeted' : `${pct.toFixed(1)}%`;
      const isAlert = !hasBudget ? actual > 0 : pct >= 70;

      return {
        category: g.key,
        rowCount: g.count,
        allocated,
        actual,
        remaining,
        hasBudget,
        pct,
        barWidth,
        tier,
        statusLabel,
        pctText,
        isAlert
      };
    })
    .filter(item => {
      if (filterMode === 'alerts') return item.isAlert;
      if (filterMode === 'healthy') return !item.isAlert;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'budget') return b.allocated - a.allocated;
      if (sortBy === 'variance') return (b.actual - b.allocated) - (a.actual - a.allocated);
      return b.actual - a.actual;
    });

  if (!enriched.length) {
    renderChartEmpty(
      host,
      filterMode === 'alerts' ? 'No high-spending or overspent budgets' : 'No healthy budgets matching filter',
      'Switch the filter tab above to view all budget categories.'
    );
    return;
  }

  host.innerHTML = '';
  const grid = el('div', { class: 'budget-cards-grid' });
  const barsToAnimate: Array<{ fill: HTMLElement; target: number }> = [];

  enriched.forEach(item => {
    const overAmount = item.actual - item.allocated;
    const isOverspent = item.hasBudget ? item.actual > item.allocated : item.actual > 0;

    const card = el('article', {
      class: `budget-card ${item.tier}`,
      'aria-label': `${item.category}: ${item.pctText} used`
    });

    const head = el('div', { class: 'budget-card-head' }, [
      el('div', {}, [
        el('h4', { class: 'budget-card-title', text: item.category }),
        el('span', { class: 'mono-meta', text: `${item.rowCount} record${item.rowCount === 1 ? '' : 's'}` })
      ]),
      el('span', { class: 'budget-status-text' }, [
        el('span', { class: 'budget-status-dot', 'aria-hidden': 'true' }),
        document.createTextNode(item.statusLabel)
      ])
    ]);

    const barTrack = el('div', {
      class: 'budget-bar-track',
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(Math.round(item.barWidth)),
      'aria-label': `${item.category} budget usage ${item.pctText}`
    });

    const barFill = el('div', {
      class: 'budget-bar-fill',
      style: `width:${REDUCED_MOTION() ? item.barWidth : 0}%`
    });
    barTrack.appendChild(barFill);
    if (!REDUCED_MOTION()) barsToAnimate.push({ fill: barFill, target: item.barWidth });

    const progressRow = el('div', { class: 'budget-progress-row' }, [
      barTrack,
      el('span', { class: 'budget-pct-label num', text: item.pctText })
    ]);

    const metrics = el('div', { class: 'budget-metrics-row' }, [
      el('div', { class: 'budget-metric' }, [
        el('span', { class: 'budget-metric-lbl', text: 'Allocated' }),
        el('strong', { class: 'num', text: item.hasBudget ? money(item.allocated) : '₹0 (None)' })
      ]),
      el('div', { class: 'budget-metric' }, [
        el('span', { class: 'budget-metric-lbl', text: 'Spent' }),
        el('strong', { class: 'num', text: money(item.actual) })
      ]),
      el('div', { class: 'budget-metric' }, [
        el('span', { class: 'budget-metric-lbl', text: item.remaining < 0 ? 'Overspent' : 'Remaining' }),
        el('strong', {
          class: `num ${item.remaining < 0 ? 'is-over' : ''}`,
          text: item.hasBudget
            ? item.remaining < 0
              ? `−${money(Math.abs(item.remaining))}`
              : money(item.remaining)
            : '—'
        })
      ])
    ]);

    card.appendChild(head);
    card.appendChild(progressRow);
    card.appendChild(metrics);

    if (isOverspent) {
      card.appendChild(
        el('div', { class: 'budget-over-alert', role: 'status' }, [
          svgEl(
            'svg',
            { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'aria-hidden': 'true' },
            [
              svgEl('path', { d: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' }),
              svgEl('line', { x1: 12, y1: 9, x2: 12, y2: 13 }),
              svgEl('line', { x1: 12, y1: 17, x2: 12.01, y2: 17 })
            ]
          ),
          el('span', {
            class: 'num',
            text: item.hasBudget
              ? `Exceeded budget by ${money(overAmount)}`
              : `Spent ${money(item.actual)} with ₹0 allocated budget`
          })
        ])
      );
    }

    grid.appendChild(card);
  });

  host.appendChild(grid);

  if (!REDUCED_MOTION() && barsToAnimate.length) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        barsToAnimate.forEach(b => {
          b.fill.style.width = `${b.target.toFixed(1)}%`;
        });
      });
    });
  }
}

/* ============================================================
   08. 12-MONTH CASH FLOW PROJECTION (NEGATIVE MONTH HIGHLIGHT)
   ============================================================ */
export function renderCashFlowProjectionChart(
  hostId: string,
  capId: string,
  projections: MonthlyProjection[]
) {
  const host = document.getElementById(hostId);
  if (!host) return;

  if (!projections.length || projections.every(p => p.income === 0 && p.totalOutflow === 0)) {
    renderChartEmpty(
      host,
      'No cash-flow forecast yet',
      'Add recurring incomes, expenses, or obligations in 02 Profile and 03 Obligations to model 12-month cash flow.'
    );
    return;
  }

  const maxV = Math.max(1000, ...projections.flatMap(p => [p.income, p.totalOutflow])) * 1.12;
  const svgNode = svgEl('svg', {
    style: 'width:100%;height:auto;display:block;overflow:visible;',
    role: 'group',
    'aria-label': '12-month projected cash flow comparison'
  });
  host.innerHTML = '';
  host.appendChild(svgNode);

  renderFigureCaption(capId, {
    fig: 'FIG. 08A',
    caption: 'Projected monthly inflows vs scheduled fixed, variable, EMI, and tax outflows over the next 12 months. Red net dots flag negative cash-flow months.',
    cols: [
      { label: 'Month' },
      { label: 'Income (₹)', num: true },
      { label: 'Total Outflow (₹)', num: true },
      { label: 'Net Cash Flow (₹)', num: true }
    ],
    rows: projections.map(p => [p.label, money(p.income), money(p.totalOutflow), signed(p.netCashFlow)])
  });

  function draw() {
    const w = Math.max(300, host!.clientWidth || 640);
    const h = 250;
    const padL = 58, padR = 16, padT = 26, padB = 36;
    const yScale = scaleLinear(0, maxV, h - padB, padT);
    svgNode.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svgNode.innerHTML = '';

    // Legend
    svgNode.appendChild(svgEl('rect', { x: padL, y: 4, width: 10, height: 10, fill: 'var(--green)', rx: 2 }));
    svgNode.appendChild(svgEl('text', { x: padL + 15, y: 13, class: 'svg-micro', text: 'Projected Income' }));
    svgNode.appendChild(svgEl('rect', { x: padL + 125, y: 4, width: 10, height: 10, fill: 'var(--violet)', rx: 2 }));
    svgNode.appendChild(svgEl('text', { x: padL + 140, y: 13, class: 'svg-micro', text: 'Scheduled Outflow' }));
    svgNode.appendChild(svgEl('circle', { cx: padL + 260, cy: 9, r: 4.5, fill: 'var(--brick)' }));
    svgNode.appendChild(svgEl('text', { x: padL + 270, y: 13, class: 'svg-micro', text: 'Negative Month Alert' }));

    for (let i = 0; i <= 4; i++) {
      const v = (maxV * i) / 4;
      const y = yScale(v);
      svgNode.appendChild(svgEl('line', { x1: padL, y1: y, x2: w - padR, y2: y, stroke: i === 0 ? 'var(--ink)' : 'var(--rule)', 'stroke-width': i === 0 ? 1.5 : 1 }));
      svgNode.appendChild(svgEl('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end', class: 'svg-micro', text: compactMoney(v) }));
    }

    const slotW = (w - padL - padR) / projections.length;
    const barW = Math.min(18, Math.max(6, slotW * 0.34));

    projections.forEach((p, idx) => {
      const cx = padL + slotW * idx + slotW / 2;
      const isNeg = p.netCashFlow < 0;

      if (isNeg) {
        svgNode.appendChild(
          svgEl('rect', {
            x: padL + slotW * idx + 2,
            y: padT,
            width: Math.max(4, slotW - 4),
            height: h - padB - padT,
            fill: 'color-mix(in srgb, var(--brick) 10%, transparent)',
            rx: 3
          })
        );
      }

      const incY = yScale(p.income);
      const outY = yScale(p.totalOutflow);

      const g = svgEl('g', {
        tabindex: 0,
        role: 'img',
        style: 'cursor:pointer;',
        'aria-label': `${p.label}: Income ${money(p.income)}, Outflow ${money(p.totalOutflow)}, Net ${signed(p.netCashFlow)}`
      });

      g.appendChild(
        svgEl('rect', {
          x: cx - barW - 1,
          y: incY,
          width: barW,
          height: Math.max(2, yScale(0) - incY),
          fill: 'var(--green)',
          rx: 2
        })
      );

      g.appendChild(
        svgEl('rect', {
          x: cx + 1,
          y: outY,
          width: barW,
          height: Math.max(2, yScale(0) - outY),
          fill: isNeg ? 'var(--brick)' : 'var(--violet)',
          rx: 2
        })
      );

      if (isNeg) {
        g.appendChild(svgEl('circle', { cx, cy: Math.max(padT + 4, outY - 7), r: 4, fill: 'var(--brick)' }));
      }

      const showLbl = w >= 620 || idx % 2 === 0;
      if (showLbl) {
        g.appendChild(
          svgEl('text', {
            x: cx,
            y: h - 10,
            'text-anchor': 'middle',
            class: 'svg-micro',
            style: isNeg ? 'fill:var(--brick);font-weight:700;' : '',
            text: p.label
          })
        );
      }

      const info = {
        cat: `${p.label}${isNeg ? ' · NEGATIVE CASH FLOW' : ''}`,
        val: `${signed(p.netCashFlow)} net`,
        sub: `In: ${money(p.income)} · Fixed: ${money(p.fixedExpenses)} · Var: ${money(p.variableExpenses)} · EMI: ${money(p.emisAndDebt)} · Tax/Ren: ${money(p.taxesAndRenewals)}`
      };
      g.addEventListener('pointerenter', e => tooltip.show(g, info, e));
      g.addEventListener('pointermove', e => tooltip.show(g, info, e));
      g.addEventListener('pointerleave', tooltip.hide);
      g.addEventListener('focus', () => tooltip.show(g, info));
      g.addEventListener('blur', tooltip.hide);
      svgNode.appendChild(g);
    });
  }

  const ro = new ResizeObserver(() => requestAnimationFrame(draw));
  ro.observe(host);
  draw();
}


