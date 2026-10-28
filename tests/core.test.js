require('fake-indexeddb/auto');
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const Core = require('../www/core.js');
const { DB } = Core;
let n = 0;
const fresh = async () => { DB.close(); await DB.open('t' + (++n)); };
const T = (o) => ({ id: 'x' + Math.random().toString(36).slice(2), type: 'expense', amt: 100, date: '2026-10-05', acc: 'cash', cat: 'Food & groceries', pay: 'Cash', party: '', note: '', tags: '', ...o });
const accName = id => ({ cash: 'Cash', bank: 'Bank account' }[id] || id);

test('fresh database: every balance and total is zero, no transactions', async () => {
  await fresh(); const r = await Core.loadOrInit(DB);
  assert.equal(r.fresh, true); assert.equal(r.tx.length, 0);
  assert.ok(r.cfg.accs.every(a => a.open === 0));
  assert.ok(Object.values(Core.balances(r.cfg, r.tx)).every(v => v === 0));
  assert.equal(Core.sumT(r.tx, 'income'), 0); assert.equal(Core.sumT(r.tx, 'expense'), 0);
  assert.deepEqual(r.cfg.budgets, {}); assert.deepEqual(r.cfg.goals, []);
});
test('toMinor is exact and rejects bad input', () => {
  assert.equal(Core.toMinor('2,500.50'), 250050); assert.equal(Core.toMinor('0.1'), 10);
  assert.equal(Core.toMinor('19.99') + Core.toMinor('0.01'), 2000);
  for (const bad of ['', 'abc', '-5', '1.234', '1e5', '1..2']) assert.equal(Core.toMinor(bad), null);
});
test('income 50,000 and expense 2,000 give net 48,000; edit to 2,500; delete', async () => {
  await fresh(); const { cfg } = await Core.loadOrInit(DB);
  const inc = T({ type: 'income', amt: 5000000, cat: 'Salary' }), ex = T({ amt: 200000 });
  await DB.put('tx', inc); await DB.put('tx', ex);
  let tx = await DB.all('tx');
  assert.equal(Core.sumT(tx, 'income') - Core.sumT(tx, 'expense'), 4800000);
  assert.equal(Core.balances(cfg, tx).cash, 4800000);
  await DB.put('tx', { ...ex, amt: 250000 }); tx = await DB.all('tx');
  assert.equal(Core.sumT(tx, 'expense'), 250000); assert.equal(Core.balances(cfg, tx).cash, 4750000);
  await DB.del('tx', ex.id); tx = await DB.all('tx');
  assert.equal(Core.sumT(tx, 'expense'), 0); assert.equal(Core.balances(cfg, tx).cash, 5000000);
});
test('transfers move balances but never income or expenses', async () => {
  await fresh(); const { cfg } = await Core.loadOrInit(DB);
  const tx = [T({ type: 'income', amt: 100000, cat: 'Salary' }), T({ type: 'transfer', amt: 40000, acc: 'cash', to: 'bank' })];
  const b = Core.balances(cfg, tx);
  assert.equal(b.cash, 60000); assert.equal(b.bank, 40000);
  assert.equal(Core.sumT(tx, 'income'), 100000); assert.equal(Core.sumT(tx, 'expense'), 0);
  assert.equal(Object.values(b).reduce((a, c) => a + c, 0), 100000);
});
test('monthly and yearly filters keep periods apart', () => {
  const tx = [T({ date: '2026-01-31', amt: 100 }), T({ date: '2026-02-01', amt: 200 }), T({ date: '2025-02-01', amt: 400 })];
  const s26 = Core.monthSeries(tx, 2026), s25 = Core.monthSeries(tx, 2025);
  assert.equal(s26[0].exp, 100); assert.equal(s26[1].exp, 200); assert.equal(s25[1].exp, 400);
  assert.equal(s26.reduce((a, m) => a + m.exp, 0), 300);
});
test('migration keeps an old (v1) install: accounts, balances, budgets and transactions survive', async () => {
  await fresh();
  const old = { cur: 'रु', theme: 'dark', warn: 90, defAcc: 'ebl', exp: ['Food', 'Custom'], inc: ['Salary'], budgets: { '2026-10': { total: 500000, cats: { Food: 100000 } } },
    accs: [{ id: 'ebl', name: 'EBL', kind: 'asset', open: 720834 }, { id: 'r1', name: 'Receivable', kind: 'recv', open: 150000 }] };
  await DB.put('kv', { k: 'cfg', v: old }); const t = T({ acc: 'ebl', amt: 1000 }); await DB.put('tx', t);
  const r = await Core.loadOrInit(DB);
  assert.equal(r.fresh, false); assert.equal(r.cfg.schema, Core.SCHEMA);
  assert.equal(r.cfg.accs[0].open, 720834); assert.equal(r.cfg.theme, 'dark'); assert.equal(r.cfg.warn, 90);
  assert.equal(r.cfg.budgets['2026-10'].total, 500000); assert.deepEqual(r.cfg.goals, []);
  assert.equal(r.tx.length, 1);
  DB.close(); await DB.open('t' + n); const r2 = await Core.loadOrInit(DB);   // reopen = app restart / update
  assert.equal(r2.fresh, false); assert.equal(r2.tx.length, 1); assert.equal(r2.cfg.accs[0].open, 720834);
});
test('restart preserves data and does not re-initialise a non-empty database', async () => {
  await fresh(); await Core.loadOrInit(DB); await DB.put('tx', T({ amt: 777 }));
  DB.close(); await DB.open('t' + n); const r = await Core.loadOrInit(DB);
  assert.equal(r.fresh, false); assert.equal(r.tx.length, 1); assert.equal(r.tx[0].amt, 777);
});
test('JSON backup round-trips (replace) and merge detects duplicates', async () => {
  await fresh(); const { cfg } = await Core.loadOrInit(DB);
  const tx = [T({ amt: 1234, note: 'a' }), T({ type: 'income', amt: 99900, cat: 'Salary' }), T({ type: 'transfer', amt: 500, acc: 'cash', to: 'bank' })];
  await DB.commit({ putTx: tx, cfg });
  const backup = JSON.parse(JSON.stringify({ app: 'khata', version: 2, cfg, tx: await DB.all('tx') }));
  await DB.commit({ clearTx: true, cfg: Core.defaultCfg() });
  assert.equal((await DB.all('tx')).length, 0);
  const p = Core.planImport(Core.defaultCfg(), [], backup);
  assert.ok(p.ok); assert.equal(p.good.length, 3); assert.equal(p.bad, 0);
  await DB.commit({ clearTx: true, putTx: p.good, cfg: p.cfg });
  const back = await DB.all('tx'); assert.equal(back.length, 3);
  assert.equal(Core.sumT(back, 'income'), 99900);
  const again = Core.planImport(p.cfg, back, backup); assert.equal(again.fresh.length, 0); assert.equal(again.dups, 3);
});
test('a v1 backup (old app) is accepted', () => {
  const p = Core.planImport(Core.defaultCfg(), [], { app: 'khata', version: 1, cfg: { accs: [{ id: 'a', name: 'A', kind: 'asset', open: 5 }] }, tx: [T({ acc: 'a' })] });
  assert.ok(p.ok); assert.equal(p.good.length, 1);
});
test('malformed backups are rejected or sanitised and never touch existing data', async () => {
  await fresh(); const { cfg } = await Core.loadOrInit(DB); await DB.put('tx', T({ amt: 4242 }));
  const cur = await DB.all('tx');
  for (const bad of [null, 5, 'x', {}, { app: 'khata', version: 9, cfg, tx: [] }, { app: 'khata', version: 2, cfg: { accs: [] }, tx: [] }, { app: 'khata', version: 2, cfg, tx: 'no' }])
    assert.equal(Core.planImport(cfg, cur, bad).ok, false);
  const mixed = Core.planImport(cfg, cur, { app: 'khata', version: 2, cfg, tx: [T(), { id: 1 }, T({ amt: -5 }), T({ date: '2026-02-31' }), T({ acc: 'ghost' }), T({ note: '<img src=x onerror=alert(1)>'.repeat(100) })] });
  assert.equal(mixed.good.length, 2); assert.equal(mixed.bad, 4); assert.ok(mixed.good.every(t => (t.note || '').length <= 500));
  assert.equal((await DB.all('tx')).length, 1);
});
test('a failed restore rolls back completely (no half-written data)', async () => {
  await fresh(); const { cfg } = await Core.loadOrInit(DB); await DB.put('tx', T({ amt: 4242 }));
  await assert.rejects(DB.commit({ clearTx: true, putTx: [T({ amt: 1 }), { noId: true }], cfg }));
  const tx = await DB.all('tx'); assert.equal(tx.length, 1); assert.equal(tx[0].amt, 4242);
});
test('writes fail loudly when storage is unavailable', async () => {
  DB.close(); await assert.rejects(DB.put('tx', T()), /unavailable/);
});
test('CSV values are exact, quoted, and formula-safe', () => {
  const csv = Core.toCsv([T({ amt: 250050, note: 'say "hi", ok' }), T({ type: 'income', amt: 5000000, cat: 'Salary', note: '=HYPERLINK("x")', date: '2026-01-02' })], accName);
  const lines = csv.replace('\ufeff', '').split('\r\n');
  assert.equal(lines[0].split(',')[2], '"Amount"');
  assert.match(lines[1], /"2026-01-02","income","50000.00","Salary"/);
  assert.match(lines[1], /"'=HYPERLINK\(""x""\)"/); assert.match(lines[2], /"2500.50"/); assert.match(lines[2], /"say ""hi"", ok"/);
});
test('service worker precache list matches real files and is build-stamped', () => {
  const sw = fs.readFileSync(path.join(__dirname, '../www/sw.js'), 'utf8');
  assert.match(sw, /__BUILD__/);
  const list = [...sw.match(/ASSETS = \[(.*?)\]/s)[1].matchAll(/'([^']+)'/g)].map(m => m[1]).filter(f => f !== './');
  for (const f of list) assert.ok(fs.existsSync(path.join(__dirname, '../www', f)), f);
  const html = fs.readFileSync(path.join(__dirname, '../www/index.html'), 'utf8');
  assert.match(html, /connect-src 'self'/); assert.doesNotMatch(html, /https?:\/\/(?!localhost)/);
});
