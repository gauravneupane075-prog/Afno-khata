/* Khata core: money maths, accounting rules, validation, migrations, IndexedDB access.
   No DOM access here, so it can be unit-tested in Node. */
(function (root) {
'use strict';
const SCHEMA = 3, MAX_TX = 200000, MAX_IMPORTS = 20000;
const pad = n => String(n).padStart(2, '0');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const DEF_EXP = ['Food & groceries','Rent & housing','Electricity & utilities','Internet & phone','Transport & fuel','Health & medicine','Education','Shopping & clothing','Entertainment','Family expenses','Travel','Personal care','Debt payments','Subscriptions','Gifts & donations','Other expenses'];
const DEF_INC = ['Salary','Freelancing','Business income','Side income','Interest','Investment income','Rental income','Gifts received','Refunds & reimbursements','Other income'];
const PAY = ['Cash','Bank transfer','Debit card','Credit card','Digital wallet'];

/* Money is integer paisa (1/100). Never floats. Returns null when invalid. */
function toMinor(v) {
  const s = String(v).replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [a, b = ''] = s.split('.');
  const n = +a * 100 + +(b + '00').slice(0, 2);
  return Number.isSafeInteger(n) && n <= 1e13 ? n : null;
}
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const defaultAuto = () => ({ mode: 'review', minConf: 0.85, paused: false });
/* A brand-new install starts with zero balances and no transactions. */
function defaultCfg() {
  return { schema: SCHEMA, cur: 'रु', theme: 'auto', warn: 80, defAcc: 'cash', weekStart: 0, lastBackup: null,
    exp: [...DEF_EXP], inc: [...DEF_INC], budgets: {}, goals: [], auto: defaultAuto(),
    accs: [
      { id: 'cash', name: 'Cash', kind: 'asset', open: 0 },
      { id: 'bank', name: 'Bank account', kind: 'asset', open: 0 },
      { id: 'wallet', name: 'Digital wallet', kind: 'asset', open: 0 },
      { id: 'savings', name: 'Savings account', kind: 'asset', open: 0 }] };
}
/* Upgrade an older stored config in place of resetting it. Existing values always win. */
const STEPS = { 2: c => { if (!Array.isArray(c.goals)) c.goals = []; }, 3: c => { c.auto = { ...defaultAuto(), ...(c.auto && typeof c.auto === 'object' ? c.auto : {}) }; } };
function migrate(old) {
  const d = defaultCfg(), c = { ...d, ...old };
  if (!Array.isArray(c.accs) || !c.accs.length) c.accs = d.accs;
  ['exp', 'inc'].forEach(k => { if (!Array.isArray(c[k])) c[k] = d[k]; });
  if (!c.budgets || typeof c.budgets !== 'object') c.budgets = {};
  for (let v = (Number(old && old.schema) || 1) + 1; v <= SCHEMA; v++) if (STEPS[v]) STEPS[v](c);
  c.schema = SCHEMA;
  return c;
}

/* Accounting rules:
   income -> +income; expense -> +expense; transfer -> moves money between accounts only.
   Refunds are recorded as income ("Refunds & reimbursements"). Savings goals are separate. */
const sumT = (a, t) => a.reduce((s, x) => x.type === t ? s + x.amt : s, 0);
function balances(cfg, tx) {
  const b = {}; cfg.accs.forEach(a => b[a.id] = a.open);
  tx.forEach(t => {
    if (!(t.acc in b)) return;
    if (t.type === 'income') b[t.acc] += t.amt;
    else if (t.type === 'expense') b[t.acc] -= t.amt;
    else if (t.type === 'transfer') { b[t.acc] -= t.amt; if (t.to in b) b[t.to] += t.amt; }
  });
  return b;
}
function byCat(arr, type) {
  const m = {}; arr.filter(t => t.type === type).forEach(t => m[t.cat] = (m[t.cat] || 0) + t.amt);
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}
function monthSeries(tx, y) {
  const r = [];
  for (let m = 1; m <= 12; m++) { const a = tx.filter(t => t.date.startsWith(`${y}-${pad(m)}`)); r.push({ m, inc: sumT(a, 'income'), exp: sumT(a, 'expense') }); }
  return r;
}

/* Validation of anything that comes from outside (imports). Returns sanitised copies or null. */
function cleanTx(t, accIds) {
  if (!t || typeof t !== 'object') return null;
  if (typeof t.id !== 'string' || !t.id || t.id.length > 40) return null;
  if (!['income', 'expense', 'transfer'].includes(t.type)) return null;
  if (!Number.isInteger(t.amt) || t.amt <= 0 || t.amt > 1e13) return null;
  if (!validDate(t.date) || typeof t.acc !== 'string' || !accIds.has(t.acc)) return null;
  const s = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
  const o = { id: t.id, type: t.type, amt: t.amt, date: t.date, acc: t.acc, note: s(t.note, 500), tags: s(t.tags, 200) };
  if (t.type === 'transfer') { if (typeof t.to !== 'string' || !accIds.has(t.to) || t.to === t.acc) return null; o.to = t.to; }
  else { o.cat = s(t.cat, 60) || 'Other'; o.pay = s(t.pay, 30); o.party = s(t.party, 100); }
  return o;
}
function cleanCfg(c) {
  if (!c || typeof c !== 'object' || !Array.isArray(c.accs)) return null;
  const accs = c.accs.filter(a => a && typeof a.id === 'string' && a.id && typeof a.name === 'string' && ['asset', 'recv'].includes(a.kind) && Number.isInteger(a.open) && Math.abs(a.open) < 1e13)
    .slice(0, 100).map(a => ({ id: a.id.slice(0, 40), name: a.name.slice(0, 60), kind: a.kind, open: a.open }));
  if (!accs.length) return null;
  const strs = x => Array.isArray(x) ? [...new Set(x.filter(s => typeof s === 'string' && s.trim()).map(s => s.slice(0, 60)))].slice(0, 200) : null;
  const budgets = {};
  if (c.budgets && typeof c.budgets === 'object') for (const [k, v] of Object.entries(c.budgets)) {
    if (!/^\d{4}-\d{2}$/.test(k) || !v || !Number.isInteger(v.total) || v.total < 0) continue;
    const cats = {}; if (v.cats && typeof v.cats === 'object') for (const [ck, cv] of Object.entries(v.cats)) if (Number.isInteger(cv) && cv > 0) cats[ck.slice(0, 60)] = cv;
    budgets[k] = { total: v.total, cats };
  }
  const goals = (Array.isArray(c.goals) ? c.goals : []).filter(g => g && typeof g.name === 'string' && Number.isInteger(g.target) && g.target > 0 && Number.isInteger(g.saved) && g.saved >= 0)
    .slice(0, 100).map(g => ({ id: String(g.id || uid()).slice(0, 40), name: g.name.slice(0, 60), target: g.target, saved: g.saved, date: validDate(g.date || '') ? g.date : '' }));
  const d = defaultCfg();
  return { ...d, cur: typeof c.cur === 'string' && c.cur && c.cur.length <= 6 ? c.cur : d.cur,
    theme: ['auto', 'light', 'dark'].includes(c.theme) ? c.theme : 'auto',
    warn: Number.isInteger(c.warn) && c.warn >= 1 && c.warn <= 100 ? c.warn : 80,
    defAcc: accs.some(a => a.id === c.defAcc) ? c.defAcc : accs[0].id,
    lastBackup: Number.isFinite(c.lastBackup) ? c.lastBackup : null,
    exp: strs(c.exp) || d.exp, inc: strs(c.inc) || d.inc, budgets, goals, accs, auto: cleanAuto(c.auto) };
}
function cleanAuto(a) {
  const d = defaultAuto(); if (!a || typeof a !== 'object') return d;
  return { mode: ['review', 'auto', 'manual'].includes(a.mode) ? a.mode : d.mode, minConf: typeof a.minConf === 'number' && a.minConf >= 0.7 && a.minConf <= 0.99 ? a.minConf : d.minConf, paused: a.paused === true };
}
/* Imported-message records (metadata for duplicate protection and review). Text is never restored from a backup. */
function cleanImport(r) {
  if (!r || typeof r !== 'object' || typeof r.key !== 'string' || !r.key || r.key.length > 160) return null;
  if (!['pending', 'saved', 'rejected'].includes(r.status)) return null;
  const p = r.parsed && typeof r.parsed === 'object' ? r.parsed : {}, s = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
  if (r.status === 'pending' && !(Number.isInteger(p.amt) && p.amt > 0)) return null;
  return { key: r.key, ref: s(r.ref, 30), sender: s(r.sender, 40), src: ['paste', 'notification', 'demo'].includes(r.src) ? r.src : 'paste', conf: typeof r.conf === 'number' ? Math.max(0, Math.min(1, r.conf)) : 0,
    at: Number.isFinite(r.at) ? r.at : 0, status: r.status, txId: s(r.txId, 40), text: '', flags: Array.isArray(r.flags) ? r.flags.filter(x => typeof x === 'string').slice(0, 8).map(x => x.slice(0, 30)) : [],
    parsed: { type: ['income', 'expense'].includes(p.type) ? p.type : '', amt: Number.isInteger(p.amt) && p.amt > 0 && p.amt <= 1e13 ? p.amt : 0, date: validDate(p.date || '') ? p.date : '', party: s(p.party, 40), bank: s(p.bank, 30), acc: s(p.acc, 40), refund: p.refund === true } };
}
function planImport(curCfg, curTx, data, curImports = []) {
  if (!data || typeof data !== 'object' || data.app !== 'khata' || !Array.isArray(data.tx)) return { ok: false, error: 'This is not a Khata backup.' };
  if (!Number.isInteger(data.version) || data.version < 1 || data.version > SCHEMA) return { ok: false, error: 'This backup version is not supported.' };
  if (data.tx.length > MAX_TX) return { ok: false, error: 'This backup has too many records.' };
  const cfg = cleanCfg(data.cfg);
  if (!cfg) return { ok: false, error: 'The backup settings are missing or damaged.' };
  const ids = new Set(cfg.accs.map(a => a.id));
  const good = data.tx.map(t => cleanTx(t, ids)).filter(Boolean);
  const key = t => [t.date, t.type, t.amt, t.cat, t.acc, t.note].join('|');
  const have = new Set(curTx.map(key)), haveId = new Set(curTx.map(t => t.id));
  const seen = new Set(), fresh = [];
  good.forEach(t => { if (!haveId.has(t.id) && !have.has(key(t)) && !seen.has(t.id)) { seen.add(t.id); fresh.push(t); } });
  const imports = (Array.isArray(data.imports) ? data.imports : []).slice(0, MAX_IMPORTS).map(cleanImport).filter(Boolean);
  const haveKeys = new Set(curImports.map(r => r.key)), newImports = imports.filter(r => !haveKeys.has(r.key));
  return { ok: true, cfg, good, bad: data.tx.length - good.length, fresh, dups: good.length - fresh.length, imports, newImports };
}
function mergeCfg(cur, inc) {
  const c = JSON.parse(JSON.stringify(cur));
  const a = new Set(c.accs.map(x => x.id)); inc.accs.forEach(x => { if (!a.has(x.id)) c.accs.push(x); });
  ['exp', 'inc'].forEach(k => inc[k].forEach(x => { if (!c[k].includes(x)) c[k].push(x); }));
  Object.entries(inc.budgets).forEach(([k, v]) => { if (!c.budgets[k]) c.budgets[k] = v; });
  const g = new Set(c.goals.map(x => x.id)); inc.goals.forEach(x => { if (!g.has(x.id)) c.goals.push(x); });
  c.auto = c.auto || defaultAuto();
  return c;
}
function toCsv(tx, accName) {
  const q = v => { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
  const money = m => Math.floor(m / 100) + '.' + pad(m % 100);
  const H = ['Date', 'Type', 'Amount', 'Category', 'Account', 'To account', 'Payment', 'Party', 'Note', 'Tags'];
  const rows = [...tx].sort((a, b) => a.date.localeCompare(b.date)).map(t => [t.date, t.type, money(t.amt), t.cat || '', accName(t.acc), t.to ? accName(t.to) : '', t.pay || '', t.party || '', t.note || '', t.tags || '']);
  return '\ufeff' + [H, ...rows].map(r => r.map(q).join(',')).join('\r\n');
}

/* IndexedDB. Every write goes through one transaction; failures reject (never a silent success). */
const DB = {
  ok: false, db: null,
  open(name = 'khata') {
    return new Promise((res, rej) => {
      const idb = root.indexedDB; if (!idb) return rej(new Error('IndexedDB is not available in this browser'));
      const r = idb.open(name, 2);
      r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('tx')) d.createObjectStore('tx', { keyPath: 'id' }); if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'k' }); if (!d.objectStoreNames.contains('imports')) d.createObjectStore('imports', { keyPath: 'key' }); };
      r.onsuccess = () => { this.db = r.result; this.ok = true; this.db.onversionchange = () => { this.db.close(); this.ok = false; }; res(); };
      r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('Database is blocked by another tab'));
    });
  },
  close() { if (this.db) this.db.close(); this.db = null; this.ok = false; },
  run(stores, mode, fn) {
    return new Promise((res, rej) => {
      if (!this.ok) return rej(new Error('Storage is unavailable, so nothing was saved'));
      let t, out; try { t = this.db.transaction(stores, mode); } catch (e) { return rej(e); }
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Transaction aborted'));
      try { fn(t, v => out = v); } catch (e) { try { t.abort(); } catch (_) {} rej(e); }
    });
  },
  all(st) { return this.run(st, 'readonly', (t, o) => { const q = t.objectStore(st).getAll(); q.onsuccess = () => o(q.result); }); },
  put(st, v) { return this.run(st, 'readwrite', t => t.objectStore(st).put(v)); },
  del(st, k) { return this.run(st, 'readwrite', t => t.objectStore(st).delete(k)); },
  commit({ clearTx = false, putTx = [], delTx = [], cfg = null, putImports = [], clearImports = false }) {
    return this.run(['tx', 'kv', 'imports'], 'readwrite', t => {
      const s = t.objectStore('tx'), im = t.objectStore('imports');
      if (clearTx) s.clear(); if (clearImports) im.clear();
      delTx.forEach(id => s.delete(id)); putTx.forEach(x => s.put(x)); putImports.forEach(x => im.put(x));
      if (cfg) t.objectStore('kv').put({ k: 'cfg', v: cfg });
    });
  }
};
/* Start-up: new install -> zero defaults; existing data (update or restore) is kept and migrated. */
async function loadOrInit(D) {
  const rec = (await D.all('kv')).find(x => x.k === 'cfg'), tx = await D.all('tx'), imports = await D.all('imports');
  let cfg, fresh = false;
  if (rec && rec.v) { cfg = migrate(rec.v); if (rec.v.schema !== SCHEMA) await D.put('kv', { k: 'cfg', v: cfg }); }
  else { cfg = defaultCfg(); fresh = tx.length === 0; await D.put('kv', { k: 'cfg', v: cfg }); }
  return { cfg, tx, fresh, imports };
}
/* Update metadata (version.json) is untrusted input: strict shape, no markup, bounded sizes. */
const VER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
function cmpVer(a, b) {
  const p = s => String(s).split('.').map(Number), x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
function validateRelease(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  if (typeof o.version !== 'string' || !VER.test(o.version)) return null;
  if (o.minVersion != null && o.minVersion !== '' && (typeof o.minVersion !== 'string' || !VER.test(o.minVersion))) return null;
  if (!Array.isArray(o.notes) || o.notes.length > 12 || o.notes.some(n => typeof n !== 'string' || n.length > 200)) return null;
  if (o.date != null && o.date !== '' && !validDate(o.date)) return null;
  if (o.build != null && o.build !== '' && !/^[0-9a-f]{7,40}$/.test(o.build)) return null;
  return { version: o.version, minVersion: o.minVersion || '', notes: o.notes.slice(), date: o.date || '', build: o.build || '' };
}
const Core = { uid, defaultAuto, cleanAuto, cleanImport, cmpVer, validateRelease, SCHEMA, DEF_EXP, DEF_INC, PAY, toMinor, validDate, defaultCfg, migrate, sumT, balances, byCat, monthSeries, cleanTx, cleanCfg, planImport, mergeCfg, toCsv, DB, loadOrInit };
root.Core = Core; if (typeof module !== 'undefined') module.exports = Core;
})(typeof self !== 'undefined' ? self : globalThis);
