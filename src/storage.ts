import { MAX_MEMBERS, ROLES, SEED } from './constants';
import type { Household, Member, Role, Transaction, UserProfile } from './types';
import { toast } from './utils';

/* ============================================================
   LOCAL DATABASE (localStorage with memory fallback)
   ============================================================ */
interface StoredUser {
  email: string;
  name: string;
  householdId: string;
  salt: string;
  hash: string;
  rounds: number;
  created: number;
}

export const DB = (() => {
  const K = { users: 'budget2026.users', houses: 'budget2026.households' };
  const dataKey = (hid: string) => 'budget2026.data.' + hid;
  const mem: Record<string, unknown> = {};
  let ok = true;
  try {
    localStorage.setItem('__t', '1');
    localStorage.removeItem('__t');
  } catch {
    ok = false;
  }

  const get = <T>(k: string): T | null => {
    if (!ok) return (mem[k] as T) ?? null;
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return (mem[k] as T) ?? null;
    }
  };
  const set = (k: string, v: unknown): void => {
    mem[k] = v;
    if (!ok) return;
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      ok = false;
    }
  };
  const del = (k: string): void => {
    delete mem[k];
    if (ok) {
      try {
        localStorage.removeItem(k);
      } catch {}
    }
  };

  const tidy = (e: string) => String(e || '').trim().toLowerCase();

  const api = {
    get available() {
      return ok;
    },
    users(): Record<string, StoredUser> {
      return get<Record<string, StoredUser>>(K.users) || {};
    },
    houses(): Record<string, Household> {
      return get<Record<string, Household>>(K.houses) || {};
    },
    saveUsers(u: Record<string, StoredUser>) {
      set(K.users, u);
    },
    saveHouses(x: Record<string, Household>) {
      set(K.houses, x);
    },
    user(email: string): StoredUser | null {
      return api.users()[tidy(email)] || null;
    },
    house(hid: string): Household | null {
      return api.houses()[hid] || null;
    },

    lookup(email: string): {
      state: 'active' | 'invited' | 'unknown';
      user?: StoredUser;
      member?: Member;
      house?: Household | null;
    } {
      const e = tidy(email);
      const u = api.user(e);
      if (u) return { state: 'active', user: u, house: api.house(u.householdId) };
      const houses = api.houses();
      for (const hid in houses) {
        const m = (houses[hid].members || []).find(x => x.email === e);
        if (m) return { state: 'invited', member: m, house: houses[hid] };
      }
      return { state: 'unknown' };
    },

    member(hid: string, email: string): Member | null {
      const hs = api.house(hid);
      return hs ? (hs.members || []).find(m => m.email === tidy(email)) || null : null;
    },

    createHousehold(name: string, ownerEmail: string): string {
      const hid = 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const houses = api.houses();
      houses[hid] = {
        id: hid,
        name: name || 'Household',
        owner: tidy(ownerEmail),
        created: Date.now(),
        members: []
      };
      api.saveHouses(houses);
      return hid;
    },

    addMember(hid: string, email: string, role: Role, status: 'active' | 'invited' = 'invited', personName = ''): boolean {
      const houses = api.houses();
      const hs = houses[hid];
      if (!hs) return false;
      hs.members = hs.members || [];
      const e = tidy(email);
      if (hs.members.some(m => m.email === e)) return false;
      if (hs.members.length >= MAX_MEMBERS) return false;
      hs.members.push({ email: e, role, status, name: personName, addedAt: Date.now() });
      api.saveHouses(houses);
      return true;
    },

    updateMember(hid: string, email: string, patch: Partial<Member>): boolean {
      const houses = api.houses();
      const hs = houses[hid];
      if (!hs) return false;
      const m = (hs.members || []).find(x => x.email === tidy(email));
      if (!m) return false;
      Object.assign(m, patch);
      api.saveHouses(houses);
      return true;
    },

    removeMember(hid: string, email: string): boolean {
      const houses = api.houses();
      const hs = houses[hid];
      if (!hs) return false;
      const e = tidy(email);
      hs.members = (hs.members || []).filter(m => m.email !== e);
      api.saveHouses(houses);
      const us = api.users();
      if (us[e]) {
        delete us[e];
        api.saveUsers(us);
      }
      return true;
    },

    readData(hid: string | null): Transaction[] | null {
      return hid ? get<Transaction[]>(dataKey(hid)) : null;
    },
    writeData(hid: string | null, rows: Transaction[]) {
      if (hid) set(dataKey(hid), rows);
    },
    wipeData(hid: string | null) {
      if (hid) del(dataKey(hid));
    }
  };
  return api;
})();

/* ============================================================
   SHA-256 + LOCAL AUTH
   ============================================================ */
const SHA256 = (() => {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  const rr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  return function (msg: string): string {
    const b = new TextEncoder().encode(msg);
    const l = b.length;
    const p = new Uint8Array((((l + 8) >> 6) + 1) << 6);
    p.set(b);
    p[l] = 0x80;
    const dv = new DataView(p.buffer);
    dv.setUint32(p.length - 4, l * 8, false);
    const H = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]);
    const w = new Uint32Array(64);
    for (let i = 0; i < p.length; i += 64) {
      for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4, false);
      for (let t = 16; t < 64; t++) {
        const a1 = w[t - 15];
        const b1 = w[t - 2];
        const s0 = rr(a1, 7) ^ rr(a1, 18) ^ (a1 >>> 3);
        const s1 = rr(b1, 17) ^ rr(b1, 19) ^ (b1 >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      let a = H[0], b2 = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let t = 0; t < 64; t++) {
        const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
        const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
        const mj = (a & b2) ^ (a & c) ^ (b2 & c);
        const t2 = (S0 + mj) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + t1) >>> 0;
        d = c;
        c = b2;
        b2 = a;
        a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0;
      H[1] = (H[1] + b2) >>> 0;
      H[2] = (H[2] + c) >>> 0;
      H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0;
      H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0;
      H[7] = (H[7] + h) >>> 0;
    }
    return Array.from(H, x => x.toString(16).padStart(8, '0')).join('');
  };
})();

export const Auth = (() => {
  const SKEY = 'budget2026.session';
  const ROUNDS = 25000;
  const box = (store: Storage) => ({
    get<T>(k: string): T | null {
      try {
        const v = store.getItem(k);
        return v ? (JSON.parse(v) as T) : null;
      } catch {
        return null;
      }
    },
    set(k: string, v: unknown) {
      try {
        store.setItem(k, JSON.stringify(v));
      } catch {}
    },
    del(k: string) {
      try {
        store.removeItem(k);
      } catch {}
    }
  });
  let ls: ReturnType<typeof box>;
  let ss: ReturnType<typeof box>;
  try {
    ls = box(localStorage);
  } catch {
    ls = { get: () => null, set: () => {}, del: () => {} };
  }
  try {
    ss = box(sessionStorage);
  } catch {
    ss = ls;
  }

  function makeSalt(): string {
    const a = new Uint8Array(16);
    if (self.crypto && self.crypto.getRandomValues) self.crypto.getRandomValues(a);
    else for (let i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  }

  function derive(pw: string, salt: string): string {
    let h = salt + '\u241f' + pw;
    for (let i = 0; i < ROUNDS; i++) h = SHA256(h + i);
    return h;
  }

  const tidy = (e: string) => String(e || '').trim().toLowerCase();

  return {
    register(email: string, pw: string, personName: string, houseName: string): string {
      const e = tidy(email);
      const salt = makeSalt();
      const hid = DB.createHousehold(houseName, e);
      DB.addMember(hid, e, 'admin', 'active', personName);
      const us = DB.users();
      us[e] = {
        email: e,
        name: personName || '',
        householdId: hid,
        salt,
        hash: derive(pw, salt),
        rounds: ROUNDS,
        created: Date.now()
      };
      DB.saveUsers(us);
      return hid;
    },
    accept(email: string, pw: string, personName: string, hid: string) {
      const e = tidy(email);
      const salt = makeSalt();
      const us = DB.users();
      us[e] = {
        email: e,
        name: personName || '',
        householdId: hid,
        salt,
        hash: derive(pw, salt),
        rounds: ROUNDS,
        created: Date.now()
      };
      DB.saveUsers(us);
      DB.updateMember(hid, e, { status: 'active', name: personName || '' });
    },
    check(email: string, pw: string): boolean {
      const u = DB.user(email);
      return !!u && derive(pw, u.salt) === u.hash;
    },
    changePassword(email: string, pw: string): boolean {
      const us = DB.users();
      const e = tidy(email);
      if (!us[e]) return false;
      const salt = makeSalt();
      us[e].salt = salt;
      us[e].hash = derive(pw, salt);
      DB.saveUsers(us);
      return true;
    },
    open(email: string, hid: string, remember: boolean) {
      (remember ? ls : ss).set(SKEY, { email: tidy(email), hid, at: Date.now() });
    },
    session(): { email: string; hid: string; at: number } | null {
      return ss.get(SKEY) || ls.get(SKEY);
    },
    close() {
      ss.del(SKEY);
      ls.del(SKEY);
    }
  };
})();

/* ============================================================
   NETWORK + SERVER / FIREBASE ADAPTER
   ============================================================ */
export const FIREBASE_CONFIG: Record<string, string> = {};
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
export const LEDGER_LIMIT = 4000;

export const E2EE = {
  ITER: 310000,
  ALG: 'PBKDF2-SHA256/310k + AES-GCM-256',

  available(): boolean {
    return typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.subtle.importKey === 'function';
  },
  bytes(n: number): Uint8Array {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return a;
  },
  b64(buf: ArrayBuffer | Uint8Array): string {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  },
  unb64(str: string): Uint8Array {
    const s = atob(str);
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  },
  async kek(secret: string, saltB64: string, iter?: number): Promise<CryptoKey> {
    const base = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    const saltBytes = E2EE.unb64(saltB64);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes.buffer as ArrayBuffer, iterations: iter || E2EE.ITER, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  },
  async newDek(): Promise<CryptoKey> {
    return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  },
  async wrap(dek: CryptoKey, secret: string) {
    const salt = E2EE.b64(E2EE.bytes(16));
    const iv = E2EE.bytes(12);
    const kek = await E2EE.kek(secret, salt, E2EE.ITER);
    const raw = await crypto.subtle.exportKey('raw', dek);
    const blob = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv.buffer as ArrayBuffer }, kek, raw);
    return { wrap: E2EE.b64(blob), iv: E2EE.b64(iv), salt, iter: E2EE.ITER, alg: E2EE.ALG };
  },
  async unwrap(env: { wrap?: string; iv: string; salt: string; iter?: number }, secret: string): Promise<CryptoKey> {
    if (!env || !env.wrap) throw new Error('locked');
    const kek = await E2EE.kek(secret, env.salt, env.iter || E2EE.ITER);
    let raw: ArrayBuffer;
    try {
      const ivBytes = E2EE.unb64(env.iv);
      const wrapBytes = E2EE.unb64(env.wrap);
      raw = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes.buffer as ArrayBuffer },
        kek,
        wrapBytes.buffer as ArrayBuffer
      );
    } catch {
      const err = new Error("That password or key does not open this household's data.") as Error & { code?: string };
      err.code = 'bad-key';
      throw err;
    }
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  },
  async encrypt(value: unknown, dek: CryptoKey) {
    const iv = E2EE.bytes(12);
    const data = new TextEncoder().encode(JSON.stringify(value));
    const blob = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv.buffer as ArrayBuffer }, dek, data);
    return { cipher: E2EE.b64(blob), iv: E2EE.b64(iv), v: 1 };
  },
  async decrypt(box: { cipher?: string; iv?: string } | null, dek: CryptoKey) {
    if (!box || !box.cipher || !box.iv) return null;
    let plain: ArrayBuffer;
    try {
      const ivBytes = E2EE.unb64(box.iv);
      const cipherBytes = E2EE.unb64(box.cipher);
      plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes.buffer as ArrayBuffer },
        dek,
        cipherBytes.buffer as ArrayBuffer
      );
    } catch {
      const err = new Error('This ledger could not be decrypted with your key.') as Error & { code?: string };
      err.code = 'bad-key';
      throw err;
    }
    return JSON.parse(new TextDecoder().decode(plain));
  },
  code(groups: number, size: number): string {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const raw = E2EE.bytes(groups * size);
    const out: string[] = [];
    for (let g = 0; g < groups; g++) {
      let s = '';
      for (let i = 0; i < size; i++) s += A[raw[g * size + i] % A.length];
      out.push(s);
    }
    return out.join('-');
  },
  inviteCode() {
    return E2EE.code(4, 5);
  },
  recoveryKey() {
    return E2EE.code(6, 5);
  }
};

export const Net = {
  base: '',
  online: false,
  token: null as string | null,
  me: null as UserProfile | null,
  storage: '',
  mode: 'local' as 'local' | 'server' | 'firebase',

  remember(token: string | null, keep: boolean) {
    Net.token = token;
    try {
      (keep ? localStorage : sessionStorage).setItem('budget2026.token', token || '');
      (keep ? sessionStorage : localStorage).removeItem('budget2026.token');
    } catch {}
  },
  recall(): string | null {
    try {
      Net.token = sessionStorage.getItem('budget2026.token') || localStorage.getItem('budget2026.token') || null;
    } catch {}
    return Net.token;
  },
  forget() {
    Net.token = null;
    Net.me = null;
    try {
      localStorage.removeItem('budget2026.token');
      sessionStorage.removeItem('budget2026.token');
    } catch {}
  },
  savedBase(): string {
    try {
      return localStorage.getItem('budget2026.server') || '';
    } catch {
      return '';
    }
  },
  setBase(v: string) {
    try {
      localStorage.setItem('budget2026.server', v || '');
    } catch {}
  },

  async detect(): Promise<boolean> {
    if (FB.configured() && (await FB.init().catch(() => false))) {
      Net.mode = 'firebase';
      Net.online = true;
      Net.storage = 'firestore';
      Net.base = 'Firebase · ' + FIREBASE_CONFIG.projectId;
      return true;
    }
    const guesses: string[] = [];
    const saved = Net.savedBase();
    if (saved) guesses.push(saved.replace(/\/+$/, ''));
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      // Only probe current origin if it's not Vite static preview returning index.html on /api/health
      guesses.push(location.origin);
    }

    for (const b of guesses) {
      try {
        const ctrl = new AbortController();
        const timer = window.setTimeout(() => ctrl.abort(), 1600);
        const r = await fetch(b + '/api/health', { signal: ctrl.signal });
        window.clearTimeout(timer);
        const ct = r.headers.get('content-type') || '';
        if (r.ok && ct.includes('application/json')) {
          const info = await r.json();
          if (info && (info.ok || info.storage !== undefined)) {
            Net.base = b;
            Net.online = true;
            Net.mode = 'server';
            Net.storage = info.storage || '';
            return true;
          }
        }
      } catch {}
    }
    Net.online = false;
    Net.mode = 'local';
    return false;
  },

  async call(method: string, path: string, body?: unknown) {
    const r = await fetch(Net.base + path, {
      method,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        Net.token ? { Authorization: 'Bearer ' + Net.token } : {}
      ),
      body: body ? JSON.stringify(body) : undefined
    });
    let data: Record<string, any> = {};
    try {
      data = await r.json();
    } catch {}
    if (!r.ok) {
      const e = new Error(data.error || 'Server said ' + r.status) as Error & { status?: number };
      e.status = r.status;
      throw e;
    }
    return data;
  }
};

/* Runtime session state shared across modules */
export const SessionContext = {
  hid: null as string | null,
  me: null as { email: string; name: string; role: Role } | null,
  house: null as { id: string; name: string; owner: string } | null,
  dek: null as CryptoKey | null,
  members: [] as Member[]
};

export const FB = {
  ready: false,
  auth: null as any,
  db: null as any,
  uid: null as string | null,
  email: '',
  api: null as any,
  unsub: null as (() => void) | null,

  configured(): boolean {
    return !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
  },

  async init(): Promise<boolean> {
    if (FB.ready) return true;
    if (!FB.configured()) return false;
    const [app, auth, store] = await Promise.all([
      import(/* @vite-ignore */ SDK + 'firebase-app.js'),
      import(/* @vite-ignore */ SDK + 'firebase-auth.js'),
      import(/* @vite-ignore */ SDK + 'firebase-firestore.js')
    ]);
    const a = app.initializeApp(FIREBASE_CONFIG);
    FB.auth = auth.getAuth(a);
    FB.db = store.getFirestore(a);
    FB.api = Object.assign({}, auth, store);
    await FB.api.setPersistence(FB.auth, FB.api.browserLocalPersistence).catch(() => {});
    FB.ready = true;
    return true;
  },

  ref(...parts: string[]) {
    return FB.api.doc(FB.db, ...parts);
  },
  key(email: string) {
    return String(email || '').trim().toLowerCase();
  },
  keyRef(hid: string, uid: string) {
    return FB.ref('households', hid, 'keys', uid);
  },

  async unlock(hid: string, uid: string, secret: string, which: 'pw' | 'rec' = 'pw'): Promise<CryptoKey> {
    const snap = await FB.api.getDoc(FB.keyRef(hid, uid));
    if (!snap.exists()) {
      const e = new Error('No key is stored for you in this household. Ask an admin to add you again.') as Error & { code?: string };
      e.code = 'no-key';
      throw e;
    }
    return E2EE.unwrap(snap.data()[which], secret);
  },

  async storeKey(hid: string, uid: string, dek: CryptoKey, password: string, recovery: string | null) {
    const doc: Record<string, any> = { pw: await E2EE.wrap(dek, password) };
    if (recovery) doc.rec = await E2EE.wrap(dek, recovery);
    else {
      const old = await FB.api.getDoc(FB.keyRef(hid, uid));
      if (old.exists() && old.data().rec) doc.rec = old.data().rec;
    }
    await FB.api.setDoc(FB.keyRef(hid, uid), doc);
  },

  async profile(): Promise<UserProfile> {
    const uid = FB.auth.currentUser.uid;
    const email = FB.key(FB.auth.currentUser.email);
    const userSnap = await FB.api.getDoc(FB.ref('users', uid));
    if (!userSnap.exists()) throw new Error('Your account is not attached to a household yet.');
    const hid = userSnap.data().householdId;

    const [houseSnap, meSnap] = await Promise.all([
      FB.api.getDoc(FB.ref('households', hid)),
      FB.api.getDoc(FB.ref('households', hid, 'members', uid))
    ]);
    if (!meSnap.exists()) throw new Error('You were removed from that household.');
    const house = houseSnap.data() || { name: 'Household', owner: email };

    FB.uid = uid;
    FB.email = email;
    return {
      email,
      name: meSnap.data().name || userSnap.data().name || '',
      role: meSnap.data().role,
      household: { id: hid, name: house.name, owner: house.owner },
      members: await FB.members(hid, meSnap.data().role)
    };
  },

  async members(hid: string, role: Role): Promise<Member[]> {
    const joined = await FB.api.getDocs(FB.api.collection(FB.db, 'households', hid, 'members'));
    const list: Member[] = joined.docs.map((d: any) => Object.assign({ uid: d.id, status: 'active' }, d.data()));
    if (role === 'admin') {
      try {
        const q = FB.api.query(FB.api.collection(FB.db, 'invites'), FB.api.where('householdId', '==', hid));
        const pending = await FB.api.getDocs(q);
        pending.forEach((d: any) => {
          if (!list.some(m => m.email === d.id)) {
            list.push({ email: d.id, name: '', role: d.data().role, status: 'invited', addedAt: d.data().createdAt });
          }
        });
      } catch {}
    }
    return list;
  },

  async signIn(email: string, password: string): Promise<UserProfile> {
    await FB.api.signInWithEmailAndPassword(FB.auth, FB.key(email), password);
    const me = await FB.profile();
    SessionContext.dek = await FB.unlock(me.household.id, FB.uid!, password);
    return me;
  },

  async signInWithRecovery(email: string, password: string, recovery: string): Promise<UserProfile> {
    await FB.api.signInWithEmailAndPassword(FB.auth, FB.key(email), password);
    const me = await FB.profile();
    SessionContext.dek = await FB.unlock(me.household.id, FB.uid!, recovery.trim().toUpperCase(), 'rec');
    await FB.storeKey(me.household.id, FB.uid!, SessionContext.dek, password, null);
    return me;
  },

  async signUp(
    email: string,
    password: string,
    name: string,
    houseName: string,
    starter: boolean,
    inviteCode?: string
  ): Promise<UserProfile> {
    const e = FB.key(email);
    await FB.api.createUserWithEmailAndPassword(FB.auth, e, password);
    const uid = FB.auth.currentUser.uid;
    const recovery = E2EE.recoveryKey();

    const inviteRef = FB.ref('invites', e);
    let invite: any = null;
    try {
      const s = await FB.api.getDoc(inviteRef);
      if (s.exists()) invite = s.data();
    } catch {}

    if (invite) {
      if (!inviteCode) {
        const err = new Error('This email was invited. Enter the join code the admin sent you.') as Error & { code?: string };
        err.code = 'need-code';
        throw err;
      }
      const dek = await E2EE.unwrap(invite, String(inviteCode).trim().toUpperCase());
      const hid = invite.householdId;
      await FB.api.setDoc(FB.ref('households', hid, 'members', uid), {
        email: e,
        name,
        role: invite.role,
        addedAt: Date.now()
      });
      await FB.storeKey(hid, uid, dek, password, recovery);
      await FB.api.setDoc(FB.ref('users', uid), { email: e, name, householdId: hid, created: Date.now() });
      await FB.api.deleteDoc(inviteRef).catch(() => {});
      SessionContext.dek = dek;
      const me = await FB.profile();
      me.recoveryKey = recovery;
      return me;
    }

    if (inviteCode) {
      const err = new Error(
        `No invitation exists for ${e}. Ask the admin to add that exact email, or clear the join code to start your own household.`
      ) as Error & { code?: string };
      err.code = 'bad-code';
      throw err;
    }

    const hid = 'h' + uid.slice(0, 12) + Date.now().toString(36).slice(-4);
    const dek = await E2EE.newDek();
    await FB.api.setDoc(FB.ref('households', hid), {
      name: houseName || 'My household',
      owner: e,
      ownerUid: uid,
      created: Date.now()
    });
    await FB.api.setDoc(FB.ref('households', hid, 'members', uid), {
      email: e,
      name,
      role: 'admin',
      addedAt: Date.now()
    });
    await FB.storeKey(hid, uid, dek, password, recovery);
    await FB.api.setDoc(FB.ref('users', uid), { email: e, name, householdId: hid, created: Date.now() });
    await FB.api.setDoc(
      FB.ref('households', hid, 'ledger', 'current'),
      Object.assign(await E2EE.encrypt(starter ? SEED.slice() : [], dek), { updated: Date.now(), updatedBy: e })
    );
    SessionContext.dek = dek;
    const me = await FB.profile();
    me.recoveryKey = recovery;
    return me;
  },

  async loadTx(hid: string): Promise<Transaction[]> {
    const snap = await FB.api.getDoc(FB.ref('households', hid, 'ledger', 'current'));
    if (!snap.exists() || !SessionContext.dek) return [];
    return (await E2EE.decrypt(snap.data(), SessionContext.dek)) || [];
  },

  async saveTx(hid: string, rows: Transaction[]) {
    if (rows.length > LEDGER_LIMIT) {
      throw new Error(`This ledger has passed ${LEDGER_LIMIT} rows, which is the limit for one Firestore document.`);
    }
    if (!SessionContext.dek) throw new Error('The household key is not open. Sign in again.');
    await FB.api.setDoc(
      FB.ref('households', hid, 'ledger', 'current'),
      Object.assign(await E2EE.encrypt(rows, SessionContext.dek), { updated: Date.now(), updatedBy: FB.email })
    );
  },

  watch(hid: string, onRows: (rows: Transaction[], who: string) => void) {
    if (FB.unsub) FB.unsub();
    FB.unsub = FB.api.onSnapshot(
      FB.ref('households', hid, 'ledger', 'current'),
      async (snap: any) => {
        if (!snap.exists() || !SessionContext.dek) return;
        const d = snap.data();
        if (d.updatedBy === FB.email) return;
        try {
          onRows((await E2EE.decrypt(d, SessionContext.dek)) || [], d.updatedBy || 'someone');
        } catch {}
      },
      () => {}
    );
  },

  stopWatching() {
    if (FB.unsub) {
      FB.unsub();
      FB.unsub = null;
    }
  },

  async invite(hid: string, email: string, role: Role): Promise<string> {
    const e = FB.key(email);
    const existing = await FB.api.getDoc(FB.ref('invites', e)).catch(() => null);
    if (existing && existing.exists()) throw new Error('That email has already been invited.');
    if (!SessionContext.dek) throw new Error('The household key is not open. Sign in again.');
    const code = E2EE.inviteCode();
    const env = await E2EE.wrap(SessionContext.dek, code);
    await FB.api.setDoc(
      FB.ref('invites', e),
      Object.assign({ householdId: hid, role, createdBy: FB.email, createdAt: Date.now() }, env)
    );
    return code;
  },

  async setRole(hid: string, member: Member, role: Role) {
    if (member.uid) await FB.api.updateDoc(FB.ref('households', hid, 'members', member.uid), { role });
    else await FB.api.updateDoc(FB.ref('invites', member.email), { role });
  },

  async remove(hid: string, member: Member) {
    if (member.uid) {
      await FB.api.deleteDoc(FB.ref('households', hid, 'members', member.uid));
      await FB.api.deleteDoc(FB.keyRef(hid, member.uid)).catch(() => {});
    } else {
      await FB.api.deleteDoc(FB.ref('invites', member.email));
    }
  },

  async changePassword(oldPassword: string, newPassword: string) {
    const cred = FB.api.EmailAuthProvider.credential(FB.email, oldPassword);
    await FB.api.reauthenticateWithCredential(FB.auth.currentUser, cred);
    const dek = await FB.unlock(SessionContext.hid!, FB.uid!, oldPassword);
    await FB.api.updatePassword(FB.auth.currentUser, newPassword);
    await FB.storeKey(SessionContext.hid!, FB.uid!, dek, newPassword, null);
    SessionContext.dek = dek;
  },

  async current() {
    return new Promise(resolve => {
      const stop = FB.api.onAuthStateChanged(FB.auth, (u: any) => {
        stop();
        resolve(u);
      });
    });
  },

  signOut() {
    FB.stopWatching();
    SessionContext.dek = null;
    return FB.api.signOut(FB.auth).catch(() => {});
  }
};

export function localProfile(email: string, hid: string): UserProfile {
  const hs = DB.house(hid);
  if (!hs) throw new Error('That household could not be found on this device.');
  const m = DB.member(hid, email) || { email, role: 'viewer' as Role, name: '', status: 'active' as const };
  return {
    email: m.email,
    name: m.name || '',
    role: m.role,
    household: { id: hs.id, name: hs.name, owner: hs.owner },
    members: (hs.members || []).map(x => ({
      email: x.email,
      role: x.role,
      status: x.status,
      name: x.name || '',
      addedAt: x.addedAt
    }))
  };
}

export const Backend = {
  passwordFirst() {
    return Net.mode === 'firebase';
  },
  async lookup(email: string) {
    if (Net.mode === 'firebase') return { state: 'active' as const };
    if (Net.online) return Net.call('POST', '/api/lookup', { email });
    const f = DB.lookup(email);
    return {
      state: f.state,
      role: f.member ? f.member.role : undefined,
      household: f.house ? { id: f.house.id, name: f.house.name } : null
    };
  },
  async register(
    email: string,
    password: string,
    name: string,
    houseName: string,
    starter: boolean,
    keep: boolean,
    code?: string
  ): Promise<UserProfile> {
    if (Net.mode === 'firebase') return FB.signUp(email, password, name, houseName, starter, code);
    if (Net.online) {
      const r = await Net.call('POST', '/api/register', { email, password, name, houseName });
      Net.remember(r.token, keep);
      Net.me = r.me;
      if (starter) await Net.call('PUT', '/api/transactions', { transactions: SEED.slice() });
      return r.me;
    }
    const hid = Auth.register(email, password, name, houseName);
    DB.writeData(hid, starter ? SEED.slice() : []);
    Auth.open(email, hid, keep);
    return localProfile(email, hid);
  },
  async accept(
    email: string,
    password: string,
    name: string,
    hid: string,
    keep: boolean,
    code?: string
  ): Promise<UserProfile> {
    if (Net.mode === 'firebase') return FB.signUp(email, password, name, '', false, code);
    if (Net.online) {
      const r = await Net.call('POST', '/api/accept', { email, password, name });
      Net.remember(r.token, keep);
      Net.me = r.me;
      return r.me;
    }
    Auth.accept(email, password, name, hid);
    Auth.open(email, hid, keep);
    return localProfile(email, hid);
  },
  async login(email: string, password: string, keep: boolean): Promise<UserProfile> {
    if (Net.mode === 'firebase') return FB.signIn(email, password);
    if (Net.online) {
      const r = await Net.call('POST', '/api/login', { email, password });
      Net.remember(r.token, keep);
      Net.me = r.me;
      return r.me;
    }
    if (!Auth.check(email, password)) {
      const e = new Error('Email or password is wrong.') as Error & { status?: number };
      e.status = 401;
      throw e;
    }
    const hid = DB.user(email)!.householdId;
    Auth.open(email, hid, keep);
    return localProfile(email, hid);
  },
  /** Opens or creates a local sample household for instant exploration. */
  openSampleHousehold(): UserProfile {
    const email = 'syam@hem-household.local';
    const existing = DB.user(email);
    if (existing && DB.house(existing.householdId)) {
      Auth.open(email, existing.householdId, true);
      if (!DB.readData(existing.householdId)?.length) {
        DB.writeData(existing.householdId, SEED.slice());
      }
      return localProfile(email, existing.householdId);
    }
    const hid = Auth.register(email, 'hem-sample-2026', 'SYAM', 'Family Ledger 2026');
    DB.addMember(hid, 'madhuri@hem-household.local', 'editor', 'active', 'MADHURI');
    DB.addMember(hid, 'chinmayi@hem-household.local', 'viewer', 'active', 'CHINMAYI');
    DB.writeData(hid, SEED.slice());
    Auth.open(email, hid, true);
    return localProfile(email, hid);
  },
  async resume(): Promise<UserProfile | null> {
    if (Net.mode === 'firebase') {
      const u = await FB.current();
      if (!u) return null;
      try {
        return await FB.profile();
      } catch {
        await FB.signOut();
        return null;
      }
    }
    if (Net.online && Net.recall()) {
      try {
        const r = await Net.call('GET', '/api/me');
        Net.me = r.me;
        return r.me;
      } catch {
        Net.forget();
        return null;
      }
    }
    if (!Net.online) {
      const s = Auth.session();
      if (s && DB.user(s.email) && DB.house(s.hid)) return localProfile(s.email, s.hid);
    }
    return null;
  },
  signOut() {
    if (Net.mode === 'firebase') FB.signOut();
    Net.forget();
    Auth.close();
  },
  async loadTx(): Promise<Transaction[]> {
    if (Net.mode === 'firebase') return FB.loadTx(SessionContext.hid!);
    if (Net.online) {
      const r = await Net.call('GET', '/api/transactions');
      return r.transactions || [];
    }
    const rows = DB.readData(SessionContext.hid);
    return Array.isArray(rows) ? rows : [];
  },
  async saveTx(rows: Transaction[]) {
    if (Net.mode === 'firebase') return FB.saveTx(SessionContext.hid!, rows);
    if (Net.online) return Net.call('PUT', '/api/transactions', { transactions: rows });
    DB.writeData(SessionContext.hid, rows);
  },
  async addMember(email: string, role: Role): Promise<{ members: Member[]; code?: string }> {
    if (Net.mode === 'firebase') {
      if ((SessionContext.members || []).length >= MAX_MEMBERS) {
        throw new Error(`This household is full at ${MAX_MEMBERS} people.`);
      }
      const code = await FB.invite(SessionContext.hid!, email, role);
      return { members: await FB.members(SessionContext.hid!, 'admin'), code };
    }
    if (Net.online) {
      const res = await Net.call('POST', '/api/members', { email, role });
      return { members: res.members };
    }
    if (!DB.addMember(SessionContext.hid!, email, role, 'invited', '')) {
      throw new Error('Could not add that email (may already exist or household is full).');
    }
    return { members: DB.house(SessionContext.hid!)!.members || [] };
  },
  async setRole(email: string, role: Role): Promise<Member[]> {
    if (Net.mode === 'firebase') {
      const m = (SessionContext.members || []).find(x => x.email === email)!;
      const admins = (SessionContext.members || []).filter(x => x.role === 'admin' && x.status === 'active');
      if (m.role === 'admin' && role !== 'admin' && admins.length === 1) {
        throw new Error('A household needs at least one admin.');
      }
      await FB.setRole(SessionContext.hid!, m, role);
      return FB.members(SessionContext.hid!, 'admin');
    }
    if (Net.online) return (await Net.call('PATCH', '/api/members', { email, role })).members;
    DB.updateMember(SessionContext.hid!, email, { role });
    return DB.house(SessionContext.hid!)!.members || [];
  },
  async removeMember(email: string): Promise<Member[]> {
    if (Net.mode === 'firebase') {
      const m = (SessionContext.members || []).find(x => x.email === email)!;
      if (m.email === SessionContext.house!.owner) throw new Error('The owner cannot be removed.');
      await FB.remove(SessionContext.hid!, m);
      return FB.members(SessionContext.hid!, 'admin');
    }
    if (Net.online) return (await Net.call('DELETE', '/api/members', { email })).members;
    DB.removeMember(SessionContext.hid!, email);
    return DB.house(SessionContext.hid!)!.members || [];
  },
  async changePassword(oldPassword: string, newPassword: string) {
    if (Net.mode === 'firebase') return FB.changePassword(oldPassword, newPassword);
    if (Net.online) return Net.call('POST', '/api/password', { oldPassword, newPassword });
    if (!Auth.check(SessionContext.me!.email, oldPassword)) {
      const e = new Error('Your current password is wrong.') as Error & { status?: number };
      e.status = 401;
      throw e;
    }
    Auth.changePassword(SessionContext.me!.email, newPassword);
  }
};

export const Perm = {
  role(): Role {
    return (SessionContext.me && SessionContext.me.role) || 'viewer';
  },
  can(what: 'view' | 'export' | 'edit' | 'import' | 'manage'): boolean {
    const r = Perm.role();
    if (r === 'admin') return true;
    if (r === 'editor') return what === 'view' || what === 'export' || what === 'edit' || what === 'import';
    return what === 'view' || what === 'export';
  },
  demand(what: 'view' | 'export' | 'edit' | 'import' | 'manage', why?: string): boolean {
    if (Perm.can(what)) return true;
    toast(why || `Your role (${ROLES[Perm.role()].name}) cannot do that`, 'err');
    return false;
  }
};

export function migrateV1() {
  let legacyAuth: any = null;
  let legacyData: any = null;
  try {
    legacyAuth = JSON.parse(localStorage.getItem('budget2026.auth') || 'null');
    legacyData = JSON.parse(localStorage.getItem('budget2026.v1') || 'null');
  } catch {
    return;
  }
  if (!legacyAuth || Object.keys(DB.users()).length) return;
  const hid = DB.createHousehold('My household', legacyAuth.email);
  DB.addMember(hid, legacyAuth.email, 'admin', 'active', '');
  const us = DB.users();
  us[legacyAuth.email] = {
    email: legacyAuth.email,
    name: '',
    householdId: hid,
    salt: legacyAuth.salt,
    hash: legacyAuth.hash,
    rounds: legacyAuth.rounds,
    created: legacyAuth.created
  };
  DB.saveUsers(us);
  if (Array.isArray(legacyData)) DB.writeData(hid, legacyData);
  try {
    localStorage.removeItem('budget2026.auth');
    localStorage.removeItem('budget2026.v1');
  } catch {}
}
