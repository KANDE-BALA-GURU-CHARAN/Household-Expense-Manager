import './styles.css';
import { createAuthGate } from './authGate';
import { initFinancialCalculator } from './calculator';
import { initHouseholdCalendar } from './calendar';
import { SECTIONS, SEED } from './constants';
import { createDefaultProfile, loadProfile } from './profileStore';
import { Backend, FB, migrateV1, Net, SessionContext } from './storage';
import { initThemeSystem } from './theme';
import type { UserProfile } from './types';
import { $, $$, REDUCED_MOTION, toast, tooltip } from './utils';
import { createInitialState, createViews } from './views';

function setupNavigation() {
  const navList = $('#navList');
  const pagerList = $('#pagerList');
  const pagerToggle = $('#pagerToggle') as HTMLButtonElement | null;
  const pagerDrawer = $('#pagerDrawer');
  const pagerLabel = $('#pagerLabel');
  const progress = $('#bandProgress');

  let activeIdx = 0;

  if (navList) {
    navList.innerHTML = '';
    SECTIONS.forEach((sec, idx) => {
      const a = document.createElement('a');
      a.href = `#${sec.id}`;
      a.className = `band-link${idx === 0 ? ' is-active' : ''}`;
      a.setAttribute('data-sec', sec.id);
      a.setAttribute('title', `${sec.num} — ${sec.title}`);
      a.innerHTML = `<span class="band-num">${sec.num}</span><span class="band-txt">${sec.short}</span>`;
      a.addEventListener('click', e => {
        e.preventDefault();
        goToSection(idx);
      });
      navList.appendChild(a);
    });
  }

  if (pagerList) {
    pagerList.innerHTML = '';
    SECTIONS.forEach((sec, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pager-item';
      btn.setAttribute('data-sec', sec.id);
      btn.innerHTML = `<span class="pager-num">${sec.num}</span><span>${sec.title}</span>`;
      btn.addEventListener('click', () => {
        closePagerDrawer();
        goToSection(idx);
      });
      pagerList.appendChild(btn);
    });
  }

  function setActive(idx: number) {
    activeIdx = Math.max(0, Math.min(SECTIONS.length - 1, idx));
    const sec = SECTIONS[activeIdx];
    $$('#navList .band-link').forEach((el, i) => {
      el.classList.toggle('is-active', i === activeIdx);
      if (i === activeIdx) el.setAttribute('aria-current', 'location');
      else el.removeAttribute('aria-current');
    });
    $$('#pagerList .pager-item').forEach((el, i) => {
      el.classList.toggle('is-active', i === activeIdx);
    });
    if (pagerLabel) pagerLabel.textContent = `${sec.num} — ${sec.short}`;
  }

  function goToSection(idx: number) {
    const clamped = Math.max(0, Math.min(SECTIONS.length - 1, idx));
    const sec = SECTIONS[clamped];
    const target = document.getElementById(sec.id);
    if (target) {
      target.scrollIntoView({ behavior: REDUCED_MOTION() ? 'auto' : 'smooth', block: 'start' });
      setActive(clamped);
    }
  }

  function closePagerDrawer() {
    if (!pagerDrawer || !pagerToggle) return;
    pagerDrawer.hidden = true;
    pagerToggle.setAttribute('aria-expanded', 'false');
  }

  pagerToggle?.addEventListener('click', () => {
    if (!pagerDrawer || !pagerToggle) return;
    const next = pagerDrawer.hidden;
    pagerDrawer.hidden = !next;
    pagerToggle.setAttribute('aria-expanded', String(next));
  });

  // Close pager on outside click
  document.addEventListener('click', e => {
    if (
      pagerDrawer &&
      !pagerDrawer.hidden &&
      e.target instanceof Node &&
      !pagerDrawer.contains(e.target) &&
      e.target !== pagerToggle &&
      !pagerToggle?.contains(e.target)
    ) {
      closePagerDrawer();
    }
  });

  // Scroll spy & reading progress bar
  const sectionEls = SECTIONS.map(s => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
  if (sectionEls.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) {
          const id = visible[0].target.id;
          const idx = SECTIONS.findIndex(s => s.id === id);
          if (idx >= 0) setActive(idx);
        }
      },
      { rootMargin: '-18% 0px -65% 0px', threshold: [0, 0.2, 0.5] }
    );
    sectionEls.forEach(el => io.observe(el));
  }

  window.addEventListener(
    'scroll',
    () => {
      if (!progress) return;
      const doc = document.documentElement;
      const max = Math.max(1, doc.scrollHeight - window.innerHeight);
      const pct = Math.max(0, Math.min(1, window.scrollY / max));
      progress.style.transform = `scaleX(${pct.toFixed(4)})`;
    },
    { passive: true }
  );

  // Keyboard shortcuts when app is visible and user is not typing
  document.addEventListener('keydown', e => {
    const app = $('#app');
    if (!app || app.hidden) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const k = e.key.toLowerCase();
    if (k === 'j') {
      e.preventDefault();
      goToSection(activeIdx + 1);
    } else if (k === 'k') {
      e.preventDefault();
      goToSection(activeIdx - 1);
    } else if (k === 'g') {
      e.preventDefault();
      const g = $('#gridOverlay');
      if (g) g.hidden = !g.hidden;
    } else if (k === 'escape') {
      closePagerDrawer();
      const g = $('#gridOverlay');
      if (g && !g.hidden) g.hidden = true;
      document.dispatchEvent(new CustomEvent('hem:escape'));
    } else if (k === 'c') {
      e.preventDefault();
      document.dispatchEvent(new CustomEvent('hem:togglecalc'));
    } else if (k >= '1' && k <= '9') {
      e.preventDefault();
      goToSection(Number(k) - 1);
    } else if (k === '0') {
      e.preventDefault();
      goToSection(9);
    }
  });

  setActive(0);
  return { closePagerDrawer, goToSection };
}

async function boot() {
  tooltip.init();
  const nav = setupNavigation();
  const themeApi = initThemeSystem(nav.closePagerDrawer);
  const S = createInitialState();

  let saveTimer: number | null = null;
  function persist() {
    if (!SessionContext.hid) return;
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      Backend.saveTx(S.tx).catch(err => {
        toast(err?.message || 'Could not save ledger changes', 'err');
      });
    }, 180);
  }

  const authGate = createAuthGate();
  let viewsRef: ReturnType<typeof createViews> | null = null;

  function handleSignOut() {
    Backend.signOut();
    SessionContext.hid = null;
    SessionContext.me = null;
    SessionContext.house = null;
    SessionContext.members = [];
    S.tx = [];
    S.profile = createDefaultProfile();
    S.repFromDate = '';
    S.repToDate = '';
    S.hasAnimatedKpis = false;
    authGate.showGate('signin', {
      title: 'Signed out',
      sub: 'Sign back in or explore the sample household ledger anytime.'
    });
  }

  viewsRef = createViews(S, persist, themeApi, handleSignOut);
  viewsRef.wireEvents();

  const calcApi = initFinancialCalculator({
    getRows: () => S.tx,
    onPrefillTransaction: preset => {
      viewsRef?.openTxDialog(null, preset);
    }
  });
  const calApi = initHouseholdCalendar({
    getRows: () => S.tx,
    getProfile: () => S.profile,
    onAddForDate: date => {
      viewsRef?.openTxDialog(null, { date });
    },
    onEditRow: row => {
      viewsRef?.openTxDialog(row);
    },
    onMarkPaid: id => {
      viewsRef?.markPaid(id);
    },
    onMarkObligationPaid: id => {
      viewsRef?.markObligationPaid(id);
    }
  });
  document.addEventListener('hem:txchange', () => calApi.refresh());
  document.addEventListener('hem:togglecalc', () => calcApi.toggle());
  document.addEventListener('hem:escape', () => {
    if (calcApi.isOpen()) calcApi.close();
    if (calApi.isOpen()) calApi.close();
  });

  async function enterApp(me: UserProfile) {
    SessionContext.hid = me.household.id;
    SessionContext.me = { email: me.email, name: me.name, role: me.role };
    SessionContext.house = me.household;
    SessionContext.members = me.members || [];

    const rows = await Backend.loadTx();
    S.tx = Array.isArray(rows) && rows.length ? rows : [];
    if (!S.tx.length && Net.mode !== 'firebase' && me.email === 'syam@hem-household.local') {
      S.tx = SEED.slice();
    }
    S.profile = loadProfile(me.household.id);
    S.repFromDate = '';
    S.repToDate = '';
    S.hasAnimatedKpis = false;

    authGate.hideGate();
    viewsRef?.renderAll();

    if (Net.mode === 'firebase') {
      FB.watch(me.household.id, (updatedRows, who) => {
        S.tx = updatedRows;
        viewsRef?.renderAll();
        toast(`Ledger updated by ${who}`, 'ok');
      });
    }
  }

  authGate.wire(enterApp);
  authGate.showBoot('Connecting H ∈ M Household Financial Intelligence…');

  try {
    migrateV1();
    await Net.detect();
    const resumed = await Backend.resume();
    if (resumed) {
      await enterApp(resumed);
    } else {
      authGate.showGate();
    }
  } catch {
    authGate.showGate();
  } finally {
    authGate.hideBoot();
  }
}

document.addEventListener('DOMContentLoaded', boot);
