require('fake-indexeddb/auto');
const test = require('node:test'), assert = require('node:assert/strict');
const Core = require('../www/core.js'), Sms = require('../www/sms.js'); const { DB } = Core;
const NOW = Date.UTC(2026, 9, 29, 6, 0, 0);
const MSG = { text: 'Rs. 1,500.00 has been debited from your account on 29 Oct 2026. Ref No: TX123456', sender: 'NABIL', at: NOW, src: 'notification', id: 'k|1' };
let n = 0; const fresh = async () => { DB.close(); await DB.open('a' + (++n)); };

test('database upgrade v1 -> v2 keeps every old record and adds the imports store', async () => {
  const name = 'old' + (++n);
  await new Promise((res, rej) => { const r = indexedDB.open(name, 1); r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('tx', { keyPath: 'id' }); d.createObjectStore('kv', { keyPath: 'k' }); };
    r.onsuccess = () => { const t = r.result.transaction(['tx', 'kv'], 'readwrite'); t.objectStore('tx').put({ id: 'old1', type: 'expense', amt: 999, date: '2026-01-02', acc: 'ebl', cat: 'Food' });
      t.objectStore('kv').put({ k: 'cfg', v: { cur: 'रु', accs: [{ id: 'ebl', name: 'EBL', kind: 'asset', open: 720834 }], exp: ['Food'], inc: ['Salary'], budgets: {} } });
      t.oncomplete = () => { r.result.close(); res(); }; t.onerror = () => rej(t.error); }; });
  DB.close(); await DB.open(name); const r = await Core.loadOrInit(DB);
  assert.equal(r.fresh, false); assert.equal(r.tx.length, 1); assert.equal(r.tx[0].amt, 999); assert.equal(r.cfg.accs[0].open, 720834);
  assert.equal(r.cfg.schema, Core.SCHEMA); assert.deepEqual(r.cfg.auto, { mode: 'review', minConf: 0.85, paused: false }); assert.deepEqual(r.imports, []);
});
test('new installs default to review mode', async () => { await fresh(); const r = await Core.loadOrInit(DB); assert.equal(r.cfg.auto.mode, 'review'); assert.equal(r.fresh, true); });
test('saving an auto entry writes transaction and import record together; reprocessing after restart is idempotent', async () => {
  await fresh(); const { cfg } = await Core.loadOrInit(DB); cfg.accs.push({ id: 'nab', name: 'Nabil', kind: 'asset', open: 0 });
  const run = async () => { const imports = new Map((await DB.all('imports')).map(r => [r.key, r]));
    const r = Sms.processMessage(MSG, { imports, accs: cfg.accs, mode: 'auto', minConf: 0.85 }); if (r.outcome === 'saved') await DB.commit({ putTx: [r.tx], putImports: [r.rec] }); return r.outcome; };
  assert.equal(await run(), 'saved'); assert.equal(await run(), 'duplicate');
  DB.close(); await DB.open('a' + n); assert.equal(await run(), 'duplicate');   // app restart
  const tx = await DB.all('tx'), im = await DB.all('imports'); assert.equal(tx.length, 1); assert.equal(im.length, 1); assert.equal(im[0].txId, tx[0].id); assert.equal(im[0].text, '');
});
test('a failed save leaves neither a transaction nor an import record (no half state)', async () => {
  await fresh(); await assert.rejects(DB.commit({ putTx: [{ id: 't1', type: 'expense', amt: 1, date: '2026-01-01', acc: 'cash' }], putImports: [{ noKey: true }] }));
  assert.equal((await DB.all('tx')).length, 0); assert.equal((await DB.all('imports')).length, 0);
});
test('removing an auto entry deletes the transaction and marks the import rejected in one step', async () => {
  await fresh(); await Core.loadOrInit(DB); const t = { id: 't9', type: 'expense', amt: 100, date: '2026-10-29', acc: 'cash', cat: 'Other expenses' };
  const rec = { key: 'ref:1:100', status: 'saved', txId: 't9', parsed: { amt: 100 } };
  await DB.commit({ putTx: [t], putImports: [rec] }); await DB.commit({ delTx: ['t9'], putImports: [{ ...rec, status: 'rejected', txId: '' }] });
  assert.equal((await DB.all('tx')).length, 0); assert.equal((await DB.all('imports'))[0].status, 'rejected');
});
test('backup: imports travel as metadata only, are validated, and malformed ones are dropped', () => {
  const cfg = Core.defaultCfg(), good = { key: 'ref:1:100', status: 'pending', text: 'SECRET MESSAGE', parsed: { type: 'expense', amt: 100, date: '2026-10-29' }, conf: 0.9, src: 'paste' };
  const p = Core.planImport(cfg, [], { app: 'khata', version: 3, cfg, tx: [], imports: [good, { key: 5 }, { key: 'x', status: 'weird' }, { key: 'y', status: 'pending', parsed: { amt: -1 } }] }, []);
  assert.ok(p.ok); assert.equal(p.imports.length, 1); assert.equal(p.imports[0].text, ''); assert.equal(p.newImports.length, 1);
  assert.equal(Core.planImport(cfg, [], { app: 'khata', version: 3, cfg, tx: [], imports: [good] }, [{ key: 'ref:1:100' }]).newImports.length, 0);
  const bad = Core.cleanCfg({ ...cfg, auto: { mode: 'hack', minConf: 5, paused: 'yes' } }); assert.deepEqual(bad.auto, Core.defaultAuto());
  assert.ok(Core.planImport(cfg, [], { app: 'khata', version: 2, cfg: { accs: cfg.accs }, tx: [] }).ok);   // old backups still restore
});
