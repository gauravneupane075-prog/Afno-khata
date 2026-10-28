const test = require('node:test'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom'); const path = require('path');
const { IDBFactory } = require('fake-indexeddb');
const boot = async (idb = new IDBFactory()) => {
  const dom = await JSDOM.fromFile(path.join(__dirname, '../www/index.html'), { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(w) { w.indexedDB = idb; w.matchMedia = () => ({ matches: false }); w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); }; w.scrollTo = () => {}; } });
  const w = dom.window;
  for (let i = 0; i < 100 && !/Money with me/.test(w.document.body.textContent); i++) await new Promise(r => setTimeout(r, 50));
  return w;
};
const add = async (w, type, amt) => { w.openForm(null, type); w.document.querySelector('#am').value = amt; await w.saveTx({ preventDefault() {} }, ''); };
test('UI: fresh install shows zero everywhere, then totals follow real entries', async () => {
  const w = await boot(), txt = () => w.document.body.textContent.replace(/\s+/g, ' ');
  assert.match(txt(), /Add your first transaction/); assert.doesNotMatch(txt(), /27,978|12,688|15,290/);
  assert.match(txt(), /all time\)\s*रु 0\.00/); assert.match(txt(), /Income · \w+\s*रु 0\.00/); assert.match(txt(), /Transactions\s*0/);
  await add(w, 'income', '50000'); assert.match(txt(), /Income · \w+\s*रु 50,000\.00/); assert.doesNotMatch(txt(), /Add your first transaction/);
  await add(w, 'expense', '2000'); assert.match(txt(), /Net cash flow\s*रु 48,000\.00/); assert.match(txt(), /Transactions\s*2/);
  assert.match(txt(), /all time\)\s*रु 48,000\.00/);
  w.document.querySelector('#dlg').removeAttribute('open'); w.close();
});
test('UI: invalid amount is rejected with a message and nothing is saved', async () => {
  const w = await boot(); w.openForm(null, 'expense'); w.document.querySelector('#am').value = 'abc';
  await w.saveTx({ preventDefault() {} }, ''); assert.match(w.document.querySelector('#fe').textContent, /greater than zero/);
  assert.equal(w.eval('TX.length'), 0); w.close();
});
test('UI: closing and reopening the app keeps saved records (same storage, new page load)', async () => {
  const idb = new IDBFactory(); let w = await boot(idb); await add(w, 'income', '1234.50'); w.close();
  w = await boot(idb); assert.equal(w.eval('TX.length'), 1); assert.match(w.document.body.textContent, /1,234\.50/); w.close();
});
