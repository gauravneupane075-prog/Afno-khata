const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const { JSDOM } = require('jsdom'); const { IDBFactory } = require('fake-indexeddb');
const Core = require('../www/core.js');
const www = path.join(__dirname, '../www'), stampJs = path.join(__dirname, '../scripts/stamp.js');

test('version comparison', () => {
  assert.equal(Core.cmpVer('2.1.0', '2.0.9'), 1); assert.equal(Core.cmpVer('2.0.0', '2.0.0'), 0);
  assert.equal(Core.cmpVer('1.9.9', '2.0.0'), -1); assert.equal(Core.cmpVer('2.10.0', '2.9.0'), 1);
});
test('release metadata validation rejects anything unexpected', () => {
  const ok = { version: '2.1.0', notes: ['a'], date: '2026-10-28', build: 'abc1234' };
  assert.ok(Core.validateRelease(ok));
  for (const bad of [null, [], 'x', { ...ok, version: '2.1' }, { ...ok, version: '2.1.0<script>' }, { ...ok, notes: 'no' }, { ...ok, notes: [5] },
    { ...ok, notes: Array(13).fill('x') }, { ...ok, notes: ['x'.repeat(201)] }, { ...ok, date: '2026-02-31' }, { ...ok, build: 'zzzz' }, { ...ok, minVersion: 'abc' }])
    assert.equal(Core.validateRelease(bad), null);
});
test('stamp script: stamps files, writes a valid version.json, and refuses a release without notes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'khata-')); ['app.js', 'sw.js'].forEach(f => fs.copyFileSync(path.join(www, f), path.join(tmp, f)));
  execFileSync('node', [stampJs, tmp], { env: { ...process.env, GITHUB_SHA: 'abcdef1234567890' } });
  const pkg = require('../package.json').version, rel = JSON.parse(fs.readFileSync(path.join(tmp, 'version.json'), 'utf8'));
  assert.equal(rel.version, pkg); assert.ok(Core.validateRelease(rel)); assert.ok(rel.notes.length > 0);
  assert.match(fs.readFileSync(path.join(tmp, 'app.js'), 'utf8'), new RegExp(`APP_VERSION='${pkg.replace(/\./g, '\\.')}'`));
  assert.doesNotMatch(fs.readFileSync(path.join(tmp, 'sw.js'), 'utf8'), /__BUILD__/);
  const root = path.join(__dirname, '..'), notes = fs.readFileSync(path.join(root, 'RELEASE_NOTES.md'), 'utf8');
  fs.writeFileSync(path.join(root, 'RELEASE_NOTES.md'), notes.replace('## ' + pkg, '## 0.0.1'));
  try { assert.throws(() => execFileSync('node', [stampJs, tmp], { stdio: 'pipe' })); } finally { fs.writeFileSync(path.join(root, 'RELEASE_NOTES.md'), notes); }
});
test('version.json is never precached (so the update check always sees the latest)', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(www, 'sw.js'), 'utf8'), /version\.json/);
});

const boot = async (idb = new IDBFactory()) => {
  const dom = await JSDOM.fromFile(path.join(www, 'index.html'), { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(w) { w.indexedDB = idb; w.matchMedia = () => ({ matches: false }); w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); }; w.scrollTo = () => {}; } });
  const w = dom.window; for (let i = 0; i < 100 && !/Money with me/.test(w.document.body.textContent); i++) await new Promise(r => setTimeout(r, 50));
  w.eval("APP_VERSION='2.0.0'"); return w;
};
const feed = (w, o) => { w.fetch = async () => ({ ok: true, text: async () => JSON.stringify(o) }); };
const sheet = w => !w.document.querySelector('#upd').hidden;
const REL = { version: '2.1.0', notes: ['New update screen', '<img src=x onerror=alert(1)>'], date: '2026-10-28', build: 'abc1234' };

test('UI: newer release shows version and notes as plain text; Later hides it and is remembered; manual check shows it again', async () => {
  const w = await boot(); feed(w, REL);
  assert.equal(await w.checkRelease(false), 'newer'); assert.ok(sheet(w));
  assert.match(w.document.querySelector('#updV').textContent, /2\.1\.0.*2\.0\.0/);
  assert.equal(w.document.querySelectorAll('#updN li').length, 2); assert.equal(w.document.querySelector('#updN img'), null);
  w.document.querySelector('#updL').click(); assert.ok(!sheet(w));
  await w.checkRelease(false); assert.ok(!sheet(w), 'no repeated prompt for the same version');
  await w.checkRelease(true); assert.ok(sheet(w), 'manual check always shows it'); w.close();
});
test('UI: same or older version shows nothing; invalid feed shows an error, not a prompt', async () => {
  const w = await boot(); feed(w, { ...REL, version: '2.0.0' }); await w.checkRelease(false); assert.ok(!sheet(w));
  await w.checkRelease(true); assert.match(w.document.querySelector('#toast').textContent, /latest version/);
  feed(w, { ...REL, version: '9.9.9<b>' }); await w.checkRelease(true); assert.ok(!sheet(w)); assert.match(w.document.querySelector('#toast').textContent, /invalid/); w.close();
});
test('UI: mandatory update (minVersion) has no Later button and ignores earlier Later', async () => {
  const w = await boot(); feed(w, REL); await w.checkRelease(false); w.document.querySelector('#updL').click();
  feed(w, { ...REL, minVersion: '2.1.0' }); await w.checkRelease(false); assert.ok(sheet(w)); assert.ok(w.document.querySelector('#updL').hidden); w.close();
});
test('UI: Update now activates the waiting worker; nothing else is touched', async () => {
  const w = await boot(); feed(w, REL); await w.checkRelease(false); let msg = null, updated = 0;
  w.eval("swReg=null"); w.swMock = { update: async () => { updated++; }, waiting: { postMessage: m => { msg = m; } } }; w.eval("swReg=window.swMock");
  w.document.querySelector('#updB').click(); await new Promise(r => setTimeout(r, 50));
  assert.equal(msg, 'SKIP_WAITING'); assert.equal(updated, 1); assert.match(w.document.querySelector('#updS').textContent, /Installing/); w.close();
});
test('UI: offline, timeout and open-form cases show an error with Retry and never claim success', async () => {
  const w = await boot(); feed(w, REL); await w.checkRelease(false); const S = () => w.document.querySelector('#updS').textContent, B = () => w.document.querySelector('#updB').textContent;
  Object.defineProperty(w.navigator, 'onLine', { value: false, configurable: true });
  w.document.querySelector('#updB').click(); assert.match(S(), /offline/); assert.equal(B(), 'Retry');
  Object.defineProperty(w.navigator, 'onLine', { value: true, configurable: true });
  w.swMock = { update: async () => {}, addEventListener() {} }; w.eval("swReg=window.swMock;UPD_TIMEOUT=30");
  w.document.querySelector('#updB').click(); await new Promise(r => setTimeout(r, 120));
  assert.match(S(), /not available yet/); assert.equal(B(), 'Retry'); assert.equal(w.eval('updBusy'), false);
  w.openForm(null, 'expense'); w.document.querySelector('#updB').click(); assert.match(S(), /open entry/); w.close();
});
test('UI: updating never touches stored records (same storage across a simulated update)', async () => {
  const idb = new IDBFactory(); let w = await boot(idb);
  w.openForm(null, 'income'); w.document.querySelector('#am').value = '5000'; await w.saveTx({ preventDefault() {} }, ''); w.close();
  w = await boot(idb); assert.equal(w.eval('TX.length'), 1); w.close();
});
