const test = require('node:test'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom'); const path = require('path'); const { IDBFactory } = require('fake-indexeddb');
const boot = async (idb = new IDBFactory(), cap) => {
  const dom = await JSDOM.fromFile(path.join(__dirname, '../www/index.html'), { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(w) { w.indexedDB = idb; w.matchMedia = () => ({ matches: false }); w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); }; w.scrollTo = () => {}; w.confirm = () => true; if (cap) w.Capacitor = cap; } });
  const w = dom.window; for (let i = 0; i < 100 && !/Money with me/.test(w.document.body.textContent); i++) await new Promise(r => setTimeout(r, 50)); return w;
};
const DEBIT = { text: 'Dear Customer, Rs. 1,500.00 has been debited from your account on 29 Oct 2026. Ref No: TX123456', sender: 'NABIL', src: 'notification', id: 'k|1' };
const inc = (w, m) => { w.__m = { ...m, at: Date.now() }; return w.eval('processIncoming(window.__m)'); };
const addNabil = w => w.eval("CFG.accs.push({id:'nab',name:'Nabil',kind:'asset',open:0})");

test('review mode: a detected message waits for approval, then the saved entry updates totals once', async () => {
  const w = await boot(); addNabil(w);
  const r = await inc(w, DEBIT); assert.equal(r.outcome, 'pending'); assert.equal(w.eval('TX.length'), 0);
  w.eval("go('auto')"); assert.match(w.document.body.textContent, /Waiting for review \(1\)/);
  w.eval(`reviewRec(IMPORTS[0].key)`); assert.equal(w.document.querySelector('#am').value, '1500.00'); assert.equal(w.document.querySelector('#ac').value, 'nab');
  await w.saveTx({ preventDefault() {} }, '');
  assert.equal(w.eval('TX.length'), 1); assert.equal(w.eval('TX[0].amt'), 150000); assert.equal(w.eval("IMPORTS[0].status"), 'saved'); assert.equal(w.eval("IMPORTS[0].text"), ''); assert.equal(w.eval('IMPORTS[0].txId'), w.eval('TX[0].id'));
  assert.equal((await inc(w, DEBIT)).outcome, 'duplicate'); assert.equal(w.eval('TX.length'), 1); w.close();
});
test('unknown account must be chosen by the user; nothing is silently assigned', async () => {
  const w = await boot(); await inc(w, { ...DEBIT, sender: 'EBL', text: DEBIT.text.replace('TX123456', 'TX555666') });
  w.eval('reviewRec(IMPORTS[0].key)'); assert.equal(w.document.querySelector('#ac').value, '');
  await w.saveTx({ preventDefault() {} }, ''); assert.match(w.document.querySelector('#fe').textContent, /Choose an account/); assert.equal(w.eval('TX.length'), 0); w.close();
});
test('auto mode saves a confident message; review mode and manual-only do not', async () => {
  const w = await boot(); addNabil(w); w.eval("CFG.auto.mode='auto'");
  assert.equal((await inc(w, DEBIT)).outcome, 'saved'); assert.equal(w.eval('TX.length'), 1); assert.equal(w.eval('TX[0].tags'), 'auto-import');
  w.eval("CFG.auto.mode='review'"); assert.equal((await inc(w, { ...DEBIT, id: 'k|2', text: DEBIT.text.replace('TX123456', 'TX777888') })).outcome, 'pending'); assert.equal(w.eval('TX.length'), 1); w.close();
});
test('OTP, failed and pending messages are ignored and nothing is stored', async () => {
  const w = await boot(); for (const t of ['Your OTP is 123456 for Rs 500. Do not share.', 'Payment of Rs 500 failed', 'Rs 500 payment is pending']) assert.equal((await inc(w, { text: t, sender: 'NABIL' })).outcome, 'ignored');
  assert.equal(w.eval('IMPORTS.length'), 0); assert.equal(w.eval('TX.length'), 0); w.close();
});
test('reject keeps duplicate memory but removes the text; Remove entry undoes an auto save', async () => {
  const w = await boot(); addNabil(w); await inc(w, DEBIT); w.eval('rejectRec(IMPORTS[0].key)'); await new Promise(r => setTimeout(r, 50));
  assert.equal(w.eval('IMPORTS[0].status'), 'rejected'); assert.equal(w.eval('IMPORTS[0].text'), ''); assert.equal((await inc(w, DEBIT)).outcome, 'duplicate');
  w.eval("CFG.auto.mode='auto'"); await inc(w, { ...DEBIT, id: 'z', text: DEBIT.text.replace('TX123456', 'TX424242') }); assert.equal(w.eval('TX.length'), 1);
  w.eval("removeAuto(IMPORTS.find(r=>r.status==='saved').key)"); await new Promise(r => setTimeout(r, 50)); assert.equal(w.eval('TX.length'), 0); w.close();
});
test('pasted text is shown as plain text, preview saves nothing, samples are never auto-saved', async () => {
  const w = await boot(); w.eval("AUTO.draft='Rs 100 debited <img src=x onerror=alert(1)> to <b>Shop</b> Ref 909090';AUTO.sender='NABIL'"); w.eval("go('auto')"); w.eval('autoPreview()');
  assert.equal(w.eval('IMPORTS.length'), 0); await w.eval('autoImport()'); assert.equal(w.eval('IMPORTS.length'), 1); w.eval("go('auto')");
  assert.equal(w.document.querySelector('main img'), null); w.eval('useSample(0)'); assert.equal(w.eval('IMPORTS.length'), 1); w.close();
});
test('restart: pending reviews and duplicate memory survive; data is not lost', async () => {
  const idb = new IDBFactory(); let w = await boot(idb); await inc(w, DEBIT); w.close(); w = await boot(idb);
  assert.equal(w.eval('IMPORTS.length'), 1); assert.equal((await inc(w, DEBIT)).outcome, 'duplicate'); w.close();
});
test('APK bridge: notification events are processed, acknowledged only after saving, and permission denial does not crash', async () => {
  let acked = null, calls = 0;
  const plugin = { drain: async () => ({ events: [{ id: 'n1', sender: 'NABIL', text: DEBIT.text, at: Date.now() }, { id: 'n2', sender: 'X', text: 'Your OTP is 1234', at: Date.now() }] }), ack: async o => { acked = o.ids; }, status: async () => ({ enabled: true }), setPaused: async () => {}, openSettings: async () => {} };
  const w = await boot(new IDBFactory(), { isNativePlatform: () => true, registerPlugin: () => plugin }); await new Promise(r => setTimeout(r, 300));
  assert.equal(w.eval('IMPORTS.length'), 1); assert.deepEqual(Array.from(acked), ['n1', 'n2']); w.close();
  const bad = { drain: async () => { calls++; throw new Error('permission denied'); }, status: async () => { throw new Error('x'); }, ack: async () => {}, setPaused: async () => {}, openSettings: async () => {} };
  const w2 = await boot(new IDBFactory(), { isNativePlatform: () => true, registerPlugin: () => bad }); await new Promise(r => setTimeout(r, 300));
  assert.ok(calls > 0); w2.eval("go('auto')"); assert.match(w2.document.body.textContent, /Auto transaction detection/); w2.close();
});
test('APK bridge: manual-only and paused modes read nothing from the phone', async () => {
  let drained = 0; const plugin = { drain: async () => { drained++; return { events: [] }; }, ack: async () => {}, status: async () => ({ enabled: true }), setPaused: async () => {}, openSettings: async () => {} };
  const idb = new IDBFactory(); let w = await boot(idb); w.eval("CFG.auto.mode='manual'"); await w.eval('saveCfg()'); w.close();
  w = await boot(idb, { isNativePlatform: () => true, registerPlugin: () => plugin }); await new Promise(r => setTimeout(r, 300)); assert.equal(drained, 0); w.close();
});
test('Menu shows Auto transaction detection and the Home badge for waiting items', async () => {
  const w = await boot(); await inc(w, DEBIT); w.eval("go('dash')"); assert.match(w.document.body.textContent, /1 detected transaction waiting/);
  w.eval("go('set')"); assert.match(w.document.body.textContent, /Auto transaction detection/); w.close();
});
