import { THEMES } from './constants';
import type { ThemeId } from './types';
import { el, REDUCED_MOTION, tooltip } from './utils';

const STORAGE_KEY = 'hem.theme.v1';
const DEFAULT_THEME: ThemeId = 'hem-ledger';

export interface ThemePanelApi {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  applyTheme: (id: ThemeId) => void;
  getCurrent: () => ThemeId;
}

export function initThemeSystem(onSectionMenuClose?: () => void): ThemePanelApi {
  const panel = document.getElementById('themePanel') as HTMLDialogElement | null;
  const inner = document.getElementById('themePanelInner');
  const btn = document.getElementById('themePanelBtn');
  const closeBtn = document.getElementById('themePanelClose');
  const list = document.getElementById('themeList');
  const resetBtn = document.getElementById('themeReset') as HTMLButtonElement | null;
  const storageNote = document.getElementById('themeStorageNote');
  const statusEl = document.getElementById('themeStatus');
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  let storageOk = true;
  try {
    const testKey = 'hem.theme.test';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
  } catch {
    storageOk = false;
  }
  if (!storageOk && storageNote) {
    storageNote.textContent = 'Not saved: storage unavailable';
  }

  const radios: HTMLInputElement[] = [];

  if (list) {
    list.innerHTML = '';
    const legend = el('legend', { class: 'sr-only', text: 'Colour theme' });
    list.appendChild(legend);

    THEMES.forEach(t => {
      const radio = el('input', {
        type: 'radio',
        name: 'theme',
        value: t.id,
        class: 'theme-radio'
      }) as HTMLInputElement;
      radios.push(radio);

      const swatch = el('span', { class: 'theme-swatch', 'data-swatch': t.id, 'aria-hidden': 'true' }, [
        el('span', { class: 'sw-band' }),
        el('span', { class: 'sw-mid' }, [
          el('span', { class: 'sw-line' }),
          el('span', { class: 'sw-bars' }, [el('i'), el('i'), el('i')])
        ]),
        el('span', { class: 'sw-ramp' }, [el('i'), el('i'), el('i'), el('i'), el('i'), el('i')])
      ]);

      const nameRow = el('span', { class: 'theme-opt-name' }, [
        document.createTextNode(t.name),
        t.badge ? el('span', { class: 'theme-opt-badge', text: ` · ${t.badge}` }) : null
      ]);

      const body = el('span', { class: 'theme-opt-body' }, [
        swatch,
        el('span', { class: 'theme-opt-text' }, [
          nameRow,
          el('span', { class: 'theme-opt-desc', text: t.desc })
        ]),
        el('span', { class: 'theme-opt-mark', 'aria-hidden': 'true' })
      ]);

      list.appendChild(el('label', { class: 'theme-opt' }, [radio, body]));
    });
  }

  let persistTimer: number | null = null;
  let fadeTimer: number | null = null;
  let lastFocus: HTMLElement | null = null;
  let closing = false;

  function syncThemeColorMeta() {
    if (!themeMeta) return;
    const bandColor = getComputedStyle(document.documentElement).getPropertyValue('--band').trim();
    if (bandColor) themeMeta.setAttribute('content', bandColor);
  }

  function applyTheme(
    id: string,
    opts: { announce?: boolean; persist?: boolean; remove?: boolean; immediate?: boolean } = {}
  ) {
    const themeObj = THEMES.find(t => t.id === id) || THEMES[0];
    const safeId = themeObj.id;
    document.documentElement.dataset.theme = safeId;

    radios.forEach(r => {
      r.checked = r.value === safeId;
    });

    // Also sync inline theme cards in Section 10 if present
    document.querySelectorAll<HTMLButtonElement>('[data-inline-theme]').forEach(cardBtn => {
      const active = cardBtn.getAttribute('data-inline-theme') === safeId;
      cardBtn.setAttribute('aria-pressed', String(active));
      cardBtn.classList.toggle('is-active', active);
    });

    const isDefault = safeId === DEFAULT_THEME;
    if (resetBtn) {
      resetBtn.disabled = isDefault;
      resetBtn.setAttribute('aria-disabled', String(isDefault));
    }
    syncThemeColorMeta();

    if (opts.announce !== false && statusEl) {
      statusEl.textContent = `Theme: ${themeObj.name}`;
    }
    document.dispatchEvent(new CustomEvent('hem:themechange', { detail: { id: safeId } }));

    if (opts.persist !== false && storageOk) {
      if (persistTimer) window.clearTimeout(persistTimer);
      persistTimer = window.setTimeout(() => {
        try {
          if (opts.remove) localStorage.removeItem(STORAGE_KEY);
          else localStorage.setItem(STORAGE_KEY, safeId);
        } catch {
          storageOk = false;
          if (storageNote) storageNote.textContent = 'Not saved: storage unavailable';
        }
      }, opts.immediate ? 0 : 120);
    }
  }

  function switchTheme(
    id: ThemeId,
    opts: { force?: boolean; announce?: boolean; persist?: boolean; remove?: boolean; immediate?: boolean } = {}
  ) {
    const current = (document.documentElement.dataset.theme as ThemeId) || DEFAULT_THEME;
    if (current === id && !opts.force) return;
    if (REDUCED_MOTION()) {
      applyTheme(id, opts);
      return;
    }
    if (typeof (document as any).startViewTransition === 'function') {
      try {
        (document as any).startViewTransition(() => applyTheme(id, opts));
        return;
      } catch {}
    }
    if (fadeTimer) window.clearTimeout(fadeTimer);
    document.documentElement.classList.add('theme-fading');
    applyTheme(id, opts);
    fadeTimer = window.setTimeout(() => {
      document.documentElement.classList.remove('theme-fading');
    }, 420);
  }

  radios.forEach(r => {
    r.addEventListener('change', () => {
      if (r.checked) switchTheme(r.value as ThemeId, { persist: true, announce: true });
    });
  });

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      switchTheme(DEFAULT_THEME, { persist: true, remove: true, immediate: true, announce: true });
    });
  }

  function openPanel() {
    if (!panel || panel.open) return;
    closing = false;
    if (onSectionMenuClose) onSectionMenuClose();
    tooltip.hide();
    const ae = document.activeElement;
    lastFocus = ae && ae !== document.body && ae instanceof HTMLElement ? ae : btn;
    document.documentElement.classList.add('panel-open');
    panel.showModal();
    if (btn) btn.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      panel.classList.add('is-open');
      const checked = (panel.querySelector('.theme-radio:checked') as HTMLElement) || radios[0];
      if (checked) checked.focus({ preventScroll: true });
    });
  }

  function finishClose() {
    if (!panel || !panel.open) return;
    panel.close();
    if (btn) btn.setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('panel-open');
    closing = false;
    const target = lastFocus && document.contains(lastFocus) ? lastFocus : btn;
    if (target && typeof target.focus === 'function') target.focus();
  }

  function closePanel() {
    if (!panel || !panel.open || closing) return;
    closing = true;
    panel.classList.remove('is-open');
    let done = false;
    const onDone = (e: TransitionEvent) => {
      if (e && e.target !== panel) return;
      if (done) return;
      done = true;
      panel.removeEventListener('transitionend', onDone);
      finishClose();
    };
    panel.addEventListener('transitionend', onDone);
    window.setTimeout(() => {
      if (!done) {
        done = true;
        panel.removeEventListener('transitionend', onDone);
        finishClose();
      }
    }, REDUCED_MOTION() ? 120 : 300);
  }

  if (btn) {
    btn.addEventListener('click', () => {
      if (panel?.open) closePanel();
      else openPanel();
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', closePanel);
  if (panel) {
    panel.addEventListener('cancel', e => {
      e.preventDefault();
      closePanel();
    });
    panel.addEventListener('click', e => {
      if (e.target !== panel || !inner) return;
      const rect = inner.getBoundingClientRect();
      const outside =
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom;
      if (outside) closePanel();
    });
  }

  const initial = document.documentElement.getAttribute('data-theme') || DEFAULT_THEME;
  applyTheme(initial, { persist: false, announce: false });

  return {
    isOpen: () => !!panel?.open,
    open: openPanel,
    close: closePanel,
    applyTheme: (id: ThemeId) => switchTheme(id, { persist: true, announce: true }),
    getCurrent: () => ((document.documentElement.dataset.theme as ThemeId) || DEFAULT_THEME)
  };
}
