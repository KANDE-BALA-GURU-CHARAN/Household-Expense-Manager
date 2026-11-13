import { Backend, DB, E2EE, FB, Net, SessionContext } from './storage';
import type { UserProfile } from './types';
import { $, $$, esc, toast } from './utils';

export type GateMode = 'signin' | 'create' | 'join';

export interface AuthGateController {
  showBoot: (msg?: string) => void;
  hideBoot: () => void;
  showGate: (mode?: GateMode, banner?: { title: string; sub: string } | null) => void;
  hideGate: () => void;
  showRecoveryKey: (key: string) => Promise<void>;
  celebrate: (title: string, sub: string) => Promise<void>;
  wire: (onEnterApp: (me: UserProfile) => Promise<void>) => void;
}

export function createAuthGate(): AuthGateController {
  let mode: GateMode = 'signin';
  let invitedHouseId = '';
  let fails = 0;
  let lockUntil = 0;
  let enterHandler: ((me: UserProfile) => Promise<void>) | null = null;

  function showBoot(msg = 'Opening household ledger…') {
    const b = $('#boot');
    const m = $('#bootMsg');
    if (m) m.textContent = msg;
    if (b) {
      b.hidden = false;
      b.classList.remove('is-leaving');
    }
  }

  function hideBoot() {
    const b = $('#boot');
    if (!b) return;
    b.classList.add('is-leaving');
    window.setTimeout(() => {
      b.hidden = true;
    }, 320);
  }

  function setError(msg = '') {
    const err = $('#gateErr');
    if (!err) return;
    err.textContent = msg;
    err.hidden = !msg;
  }

  function setNotice(msg = '') {
    const n = $('#gateNotice');
    if (!n) return;
    n.textContent = msg;
    n.hidden = !msg;
  }

  function setGateMode(next: GateMode) {
    mode = next;
    setError('');
    $$('#gTabs [data-mode]').forEach(btn => {
      const active = btn.getAttribute('data-mode') === next;
      btn.setAttribute('aria-pressed', String(active));
    });

    const isCreate = next === 'create';
    const isJoin = next === 'join';
    const isSignin = next === 'signin';

    const title = $('#gateTitle');
    const note = $('#gateNote');
    const sub = $('#gSub');
    if (title) {
      title.textContent = isCreate
        ? 'Create your household ledger'
        : isJoin
          ? 'Join an invited household'
          : 'Sign in to H ∈ M';
    }
    if (note) {
      note.textContent = isCreate
        ? 'Start a fresh family ledger or preload the August 2026 Indian household template.'
        : isJoin
          ? 'Enter your invited email and join code (if E2EE Firebase is active) to connect.'
          : 'Sign in with your household email, or explore the sample SYAM family ledger in one click.';
    }
    if (sub) {
      sub.textContent = isCreate
        ? 'Create household →'
        : isJoin
          ? 'Join household →'
          : 'Open ledger →';
    }

    const rowPw2 = $('#rowPw2');
    const rowName = $('#rowName');
    const rowHouse = $('#rowHouse');
    const rowCode = $('#rowCode');
    const rowSeed = $('#rowSeed');
    const forgotBtn = $('#gForgot');
    const recBox = $('#gRecoveryBox');

    if (rowPw2) rowPw2.hidden = isSignin;
    if (rowName) rowName.hidden = isSignin;
    if (rowHouse) rowHouse.hidden = !isCreate;
    if (rowCode) rowCode.hidden = !isJoin;
    if (rowSeed) rowSeed.hidden = !isCreate;
    if (forgotBtn) forgotBtn.hidden = !isSignin;
    if (recBox) recBox.hidden = true;

    const pwEl = $('#gPw') as HTMLInputElement | null;
    if (pwEl) pwEl.setAttribute('autocomplete', isSignin ? 'current-password' : 'new-password');
  }

  function showGate(
    initialMode: GateMode = 'signin',
    banner: { title: string; sub: string } | null = null
  ) {
    const gate = $('#gate');
    const app = $('#app');
    if (app) app.hidden = true;
    if (gate) gate.hidden = false;

    const ban = $('#gateBanner');
    if (ban) {
      if (banner) {
        ban.hidden = false;
        const bt = $('#gateBannerTitle');
        const bs = $('#gateBannerSub');
        if (bt) bt.textContent = banner.title;
        if (bs) bs.textContent = banner.sub;
      } else {
        ban.hidden = true;
      }
    }

    const usersExist = Object.keys(DB.users()).length > 0;
    const targetMode = initialMode || (usersExist || Net.online ? 'signin' : 'create');
    setGateMode(targetMode);
    setNotice(
      Net.mode === 'firebase'
        ? `Connected to Firebase E2EE (${Net.base})`
        : Net.online
          ? `Connected to Household Server (${Net.base})`
          : 'Local encrypted-hash storage active on this device.'
    );
  }

  function hideGate() {
    const gate = $('#gate');
    const app = $('#app');
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
  }

  function showRecoveryKey(key: string): Promise<void> {
    return new Promise(resolve => {
      const vault = $('#vault');
      const code = $('#vaultKey');
      const copyBtn = $('#vaultCopy');
      const doneBtn = $('#vaultDone');
      if (!vault || !code || !doneBtn) {
        resolve();
        return;
      }
      code.textContent = key;
      vault.hidden = false;

      const onCopy = () => {
        navigator.clipboard?.writeText(key).then(
          () => toast('Recovery key copied', 'ok'),
          () => toast('Select and copy the key manually', 'err')
        );
      };
      const onDone = () => {
        vault.hidden = true;
        copyBtn?.removeEventListener('click', onCopy);
        doneBtn.removeEventListener('click', onDone);
        resolve();
      };
      copyBtn?.addEventListener('click', onCopy);
      doneBtn.addEventListener('click', onDone);
    });
  }

  function celebrate(title: string, sub: string): Promise<void> {
    return new Promise(resolve => {
      const burst = $('#burst');
      const bt = $('#burstTitle');
      const bs = $('#burstSub');
      if (!burst) {
        resolve();
        return;
      }
      if (bt) bt.textContent = title;
      if (bs) bs.textContent = sub;
      burst.hidden = false;
      window.setTimeout(() => {
        burst.hidden = true;
        resolve();
      }, 950);
    });
  }

  async function finishAuth(me: UserProfile, title: string, sub: string) {
    if (me.recoveryKey) {
      await showRecoveryKey(me.recoveryKey);
    }
    await celebrate(title, sub);
    hideGate();
    if (enterHandler) await enterHandler(me);
  }

  function wire(onEnterApp: (me: UserProfile) => Promise<void>) {
    enterHandler = onEnterApp;

    $$('#gTabs [data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = (btn.getAttribute('data-mode') || 'signin') as GateMode;
        setGateMode(next);
      });
    });

    // Password peek toggles
    $$('[data-peek]').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-peek');
        const input = targetId ? (document.getElementById(targetId) as HTMLInputElement | null) : null;
        if (!input) return;
        const hidden = input.type === 'password';
        input.type = hidden ? 'text' : 'password';
        btn.setAttribute('aria-pressed', String(hidden));
        btn.textContent = hidden ? 'Hide' : 'Show';
      });
    });

    // Lookup email hint for invited members
    const emailEl = $('#gEmail') as HTMLInputElement | null;
    emailEl?.addEventListener('blur', async () => {
      const v = emailEl.value.trim();
      if (!v || !v.includes('@')) return;
      try {
        const res = await Backend.lookup(v);
        if (res.state === 'invited' && res.household) {
          invitedHouseId = res.household.id;
          setNotice(`Invitation found for "${res.household.name}" (${res.role || 'member'}). Use Join mode to set your password.`);
          if (mode === 'signin') setGateMode('join');
        }
      } catch {}
    });

    // Forgot password / recovery key toggle
    $('#gForgot')?.addEventListener('click', async () => {
      const email = ($('#gEmail') as HTMLInputElement | null)?.value.trim() || '';
      if (Net.mode === 'firebase') {
        const box = $('#gRecoveryBox');
        if (box) box.hidden = !box.hidden;
        return;
      }
      if (!email) {
        setError('Enter your account email above first.');
        return;
      }
      if (Net.online) {
        setNotice('Ask your household admin to reset your account or join from a new invite.');
        return;
      }
      const user = DB.user(email);
      if (!user) {
        setError('No local account found for that email. Try "Explore Sample Household" or Create a new household.');
        return;
      }
      // Show local recovery box so user can set a new local password cleanly without window.prompt
      const box = $('#gRecoveryBox');
      if (box) {
        box.hidden = false;
        const recKeyRow = $('#gRecKeyRow');
        if (recKeyRow) recKeyRow.hidden = true;
        setNotice(`Resetting local password for ${esc(email)}. Enter your new password below.`);
      }
    });

    $('#gRecCancel')?.addEventListener('click', () => {
      const box = $('#gRecoveryBox');
      if (box) box.hidden = true;
    });

    $('#gRecSubmit')?.addEventListener('click', async () => {
      const email = ($('#gEmail') as HTMLInputElement | null)?.value.trim() || '';
      const recKey = ($('#gRecKey') as HTMLInputElement | null)?.value.trim() || '';
      const newPw = ($('#gRecPw') as HTMLInputElement | null)?.value || '';
      if (!email || newPw.length < 6) {
        setError('Provide your email and a new password of at least 6 characters.');
        return;
      }
      const btn = $('#gRecSubmit') as HTMLButtonElement | null;
      if (btn) btn.disabled = true;
      try {
        if (Net.mode === 'firebase') {
          if (!recKey) throw new Error('Enter your 30-character recovery key.');
          const me = await FB.signInWithRecovery(email, newPw, recKey);
          await finishAuth(me, 'Vault unlocked', `Welcome back to ${me.household.name}`);
        } else {
          const { Auth } = await import('./storage');
          if (!Auth.changePassword(email, newPw)) throw new Error('Account not found on this device.');
          const me = await Backend.login(email, newPw, true);
          await finishAuth(me, 'Password updated', `Signed in to ${me.household.name}`);
        }
      } catch (err: any) {
        setError(err?.message || 'Could not reset password.');
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    // 1-click Sample Household
    $('#gSampleBtn')?.addEventListener('click', async () => {
      try {
        const me = Backend.openSampleHousehold();
        await finishAuth(me, 'Household ledger ready', 'SYAM · August 2026 (49 transactions loaded)');
      } catch (err: any) {
        setError(err?.message || 'Could not open sample household.');
      }
    });

    // Main gate form submit
    $('#gateForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      setError('');

      if (Date.now() < lockUntil) {
        const sec = Math.ceil((lockUntil - Date.now()) / 1000);
        setError(`Too many failed attempts. Try again in ${sec}s.`);
        return;
      }

      const email = ($('#gEmail') as HTMLInputElement | null)?.value.trim() || '';
      const pw = ($('#gPw') as HTMLInputElement | null)?.value || '';
      const pw2 = ($('#gPw2') as HTMLInputElement | null)?.value || '';
      const name = ($('#gName') as HTMLInputElement | null)?.value.trim() || '';
      const houseName = ($('#gHouse') as HTMLInputElement | null)?.value.trim() || '';
      const code = ($('#gCode') as HTMLInputElement | null)?.value.trim() || '';
      const starter = !!($('#gSeed') as HTMLInputElement | null)?.checked;
      const keep = !!($('#gKeep') as HTMLInputElement | null)?.checked;

      if (!email || !email.includes('@')) {
        setError('Please enter a valid email address.');
        return;
      }
      if (pw.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }
      if (mode !== 'signin' && pw !== pw2) {
        setError('Passwords do not match.');
        return;
      }

      const subBtn = $('#gSub') as HTMLButtonElement | null;
      if (subBtn) subBtn.disabled = true;

      try {
        if (mode === 'create') {
          const me = await Backend.register(email, pw, name, houseName || 'My Household', starter, keep);
          fails = 0;
          await finishAuth(me, 'Household created', `${me.household.name} is ready.`);
        } else if (mode === 'join') {
          let hid = invitedHouseId;
          if (!hid && Net.mode !== 'firebase') {
            const lk = await Backend.lookup(email);
            if (lk.state === 'invited' && lk.household) hid = lk.household.id;
          }
          if (!hid && Net.mode !== 'firebase') {
            throw new Error('No pending invitation found for this email. Ask an admin to invite you first.');
          }
          const me = await Backend.accept(email, pw, name, hid, keep, code);
          fails = 0;
          await finishAuth(me, 'Joined household', `Welcome to ${me.household.name}`);
        } else {
          const me = await Backend.login(email, pw, keep);
          fails = 0;
          await finishAuth(me, 'Signed in', `${me.household.name} · ${me.role.toUpperCase()}`);
        }
      } catch (err: any) {
        fails++;
        if (fails >= 5) {
          lockUntil = Date.now() + 30000;
          fails = 0;
          setError('5 failed sign-in attempts. Locked for 30 seconds.');
        } else {
          setError(err?.message || 'Authentication failed.');
        }
      } finally {
        if (subBtn) subBtn.disabled = false;
      }
    });
  }

  return { showBoot, hideBoot, showGate, hideGate, showRecoveryKey, celebrate, wire };
}
