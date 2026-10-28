/* Release stamping, run by CI after tests pass: node scripts/stamp.js [dir]
   - reads the version from package.json and its notes from RELEASE_NOTES.md (fails if missing)
   - writes the version/build into app.js and sw.js
   - writes version.json (the update feed the installed app checks) */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), dir = path.resolve(process.argv[2] || path.join(root, 'www'));
const fail = m => { console.error('Release stamp failed: ' + m); process.exit(1); };
const ver = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(ver)) fail('package.json version must look like 2.1.0');
const md = fs.readFileSync(path.join(root, 'RELEASE_NOTES.md'), 'utf8').split(/\r?\n/);
const start = md.findIndex(l => l.trim() === '## ' + ver);
if (start < 0) fail(`add a "## ${ver}" section to RELEASE_NOTES.md`);
const notes = [], sec = [];
for (let i = start + 1; i < md.length && !md[i].startsWith('## '); i++) sec.push(md[i].trim());
sec.forEach(l => { if (l.startsWith('- ')) notes.push(l.slice(2).trim().slice(0, 200)); });
if (!notes.length) fail(`"## ${ver}" has no "- " release-note lines`);
const minLine = sec.find(l => /^requires:\s*\d/i.test(l)), minVersion = minLine ? minLine.split(':')[1].trim() : '';
const sha = (process.env.GITHUB_SHA || 'dev').slice(0, 40);
const stamp = (f, pairs) => { const p = path.join(dir, f); let s = fs.readFileSync(p, 'utf8'); for (const [a, b] of pairs) { if (!s.includes(a)) fail(`${f} has no ${a}`); s = s.split(a).join(b); } fs.writeFileSync(p, s); };
stamp('app.js', [['__VERSION__', ver]]); stamp('sw.js', [['__BUILD__', sha + '-' + ver]]);
fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify({ version: ver, minVersion, build: /^[0-9a-f]{7,40}$/.test(sha) ? sha : '', date: new Date().toISOString().slice(0, 10), notes }, null, 2) + '\n');
console.log(`Stamped ${ver} (${sha.slice(0, 7)}) with ${notes.length} notes`);
