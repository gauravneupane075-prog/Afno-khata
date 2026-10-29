/* Khata auto-detection: turns a bank/wallet message into a draft transaction.
   Pure functions only (no DOM, no storage, no network) so everything here is unit-tested.
   Message text is never logged and never leaves the device. */
(function (root) {
'use strict';
const Core = root.Core || require('./core.js');
const pad = n => String(n).padStart(2, '0');
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/* Known financial senders. Unknown senders are never auto-saved. */
const BANKS = [['nabil', ['nabil']], ['ebl', ['ebl', 'everest bank']], ['nic asia', ['nic asia', 'nicasia']], ['esewa', ['esewa']], ['khalti', ['khalti']],
  ['imepay', ['ime pay', 'imepay']], ['global ime', ['global ime', 'gibl']], ['nmb', ['nmb']], ['sanima', ['sanima']], ['siddhartha', ['siddhartha']],
  ['prabhu', ['prabhu']], ['citizens', ['citizens bank']], ['nabil', ['nabil bank']], ['fonepay', ['fonepay']], ['connectips', ['connectips', 'connect ips']],
  ['laxmi sunrise', ['laxmi sunrise']], ['kumari', ['kumari bank']], ['machhapuchchhre', ['machhapuchchhre', 'mbl']], ['hdfc', ['hdfc']], ['sbi', ['sbi']], ['icici', ['icici']]];

const normText = t => String(t == null ? '' : t).replace(/[\u0966-\u096F]/g, d => String(d.charCodeAt(0) - 0x966)).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000);
function cyrb53(str) {  // fast non-cryptographic fingerprint, used only to recognise a repeated message
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
const isoLocal = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const RE = {
  otp: /\b(otp|one[- ]time (?:password|pin)|verification code|passcode|do not share|never share|cvv|mpin|login code)\b/i,
  failed: /\b(failed|declined|unsuccessful|not successful|unable to|insufficient|rejected|cancell?ed|could not|not processed)\b|असफल/i,
  pending: /\b(pending|processing|in progress|initiated|under process|will be (?:debited|credited)|to be (?:debited|credited))\b/i,
  reminder: /\b(due (?:date|on|by)|bill is due|reminder|please pay|kindly pay|outstanding|statement|minimum (?:amount )?due|overdue)\b/i,
  promo: /\b(offer|discount|cashback up|apply now|pre[- ]approved|eligible|limited time|lucky|congratulations|win)\b/i,
  refund: /\b(refund(?:ed)?|reversal|reversed)\b/i,
  debit: /\b(debited|withdrawn|withdrawal|spent|purchased?|paid|deducted|sent to|transferred to|payment of)\b|डेबिट|निकालिएको|भुक्तानी|कट्टा/i,
  credit: /\b(credited|received|deposited|refund(?:ed)?|reversal|reversed|added to your)\b|क्रेडिट|जम्मा|प्राप्त/i,
  link: /(https?:\/\/|www\.|bit\.ly)/i,
  skipAmt: /(bal(?:ance)?|avl|available|limit|fee|charge|commission|outstanding)[^\d]{0,14}$/i
};
const AMT = /(?<![a-z])(?:rs\.?|npr\.?|nrs\.?|inr|usd|रु\.?|रू\.?|₹|\$)\s*(\d[\d,]*(?:\.\d{1,3})?)|(?<![\d.,])(\d[\d,]*(?:\.\d{1,3})?)\s*(?:rs\.?|npr|nrs|inr|रु|रू)(?![a-z])/gi;

function findAmounts(t) {
  const out = []; AMT.lastIndex = 0; let m;
  while ((m = AMT.exec(t))) {
    if (RE.skipAmt.test(t.slice(Math.max(0, m.index - 22), m.index))) continue;
    const v = Core.toMinor(m[1] || m[2]); if (v) out.push(v);
  }
  return out;
}
function findDate(t, now) {
  const flags = []; let y, mo, d, hit = false;
  let m = t.match(/\b(\d{1,2})[\s\-\/.]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-\/.,]*(\d{2,4})\b/i);
  if (m) { d = +m[1]; mo = MON[m[2].toLowerCase()]; y = +m[3]; hit = true; }
  if (!hit && (m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) { y = +m[1]; mo = +m[2]; d = +m[3]; hit = true; }
  if (!hit && (m = t.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/))) {
    let a = +m[1], b = +m[2]; y = +m[3]; hit = true;
    if (b > 12 && a <= 12) { mo = a; d = b; } else { d = a; mo = b; if (a <= 12 && b <= 12 && a !== b) flags.push('date-ambiguous'); }
  }
  if (hit) { if (y < 100) y += 2000; const s = `${y}-${pad(mo)}-${pad(d)}`; if (Core.validDate(s)) {
    if (now && s > isoLocal(now + 36e5 * 36)) flags.push('date-future'); return { date: s, flags, found: true }; } flags.push('date-invalid'); }
  return { date: isoLocal(now || Date.now()), flags, found: false };
}
function findBank(sender, t) {
  const hay = (String(sender || '') + ' ' + t).toLowerCase();
  for (const [k, names] of BANKS) for (const n of names) if (new RegExp('(?<![a-z])' + n.replace(/ /g, '\\s*') + '(?![a-z])').test(hay)) return k;
  return '';
}
function findParty(t, credit) {
  const re = credit ? /\bfrom\s+([A-Za-z0-9][A-Za-z0-9 .&'_-]{1,40}?)(?=\s+(?:on|via|at|ref|txn|using|to|with|through|for|dated|a\/c|acct|account)\b|[.,;:]|$)/i
    : /\b(?:paid to|sent to|transferred to|to|at)\s+([A-Za-z0-9][A-Za-z0-9 .&'_-]{1,40}?)(?=\s+(?:on|via|ref|txn|using|with|through|for|dated|a\/c|acct|account)\b|[.,;:]|$)/i;
  const m = t.match(re); if (!m) return '';
  const p = m[1].trim().replace(/[.\-\s]+$/, '');
  return /^(your|my|a\/c|ac|acct|account|the account|bank)\b/i.test(p) || /^\d{1,2}\s/.test(p) ? '' : p.slice(0, 40);
}

/* parseSms(text, {sender, now}) -> {kind:'transaction'|'review'|'ignored', reason?, type, amt, date, party, bank, ref, refund, conf, flags[]} */
function parseSms(text, opt = {}) {
  const t = normText(text), ign = reason => ({ kind: 'ignored', reason, flags: [] });
  if (!t) return ign('empty');
  if (RE.otp.test(t)) return ign('otp');
  if (RE.failed.test(t) && !RE.refund.test(t)) return ign('failed');
  if (RE.pending.test(t)) return ign('pending');
  if (RE.reminder.test(t)) return ign('reminder');
  if (RE.promo.test(t) && !/\b(debited|credited)\b/i.test(t)) return ign('promotional');
  const isDebit = RE.debit.test(t), isCredit = RE.credit.test(t);
  if (!isDebit && !isCredit) return ign('no-direction');
  const amts = findAmounts(t); if (!amts.length) return ign('no-amount');
  const flags = [], bank = findBank(opt.sender, t), known = !!bank;
  let type = '';
  if (isDebit && isCredit && !RE.refund.test(t)) flags.push('direction-ambiguous'); else type = isCredit ? 'income' : 'expense';
  if (new Set(amts).size > 1) flags.push('multiple-amounts');
  if (RE.link.test(t)) flags.push('link');
  const d = findDate(t, opt.now); flags.push(...d.flags);
  const rm = t.match(/\b(?:ref(?:erence)?(?:\s*(?:no|id|number))?\.?|txn(?:\s*(?:id|no))?\.?|transaction\s*(?:id|no|number)|utr|rrn|trace(?:\s*no)?)\s*[:#\-]?\s*([A-Za-z0-9]{5,24})\b/i);
  const refund = RE.refund.test(t) && isCredit;
  let conf = 0.5 + (flags.includes('multiple-amounts') ? 0 : 0.2) + (flags.includes('direction-ambiguous') ? 0 : 0.15) + (known ? 0.1 : 0) + (rm ? 0.05 : 0) + (d.found ? 0.04 : 0);
  if (!known) conf = Math.min(conf, 0.7);
  if (flags.length) conf = Math.min(conf, 0.6);
  if (flags.includes('link')) conf = Math.min(conf, 0.4);
  conf = Math.round(Math.min(conf, 0.99) * 100) / 100;
  return { kind: flags.length ? 'review' : 'transaction', type, amt: amts[0], cur: 'NPR', date: d.date, dateFromReceipt: !d.found,
    party: type ? findParty(t, type === 'income') : '', bank, ref: rm ? rm[1] : '', refund, conf, flags };
}

/* Duplicate detection. Same reference+amount, or same notification id, or same exact text => same message. */
function importKey(msg, p) {
  if (p.ref) return `ref:${p.ref.toLowerCase()}:${p.amt}`;
  if (msg.id) return 'n:' + String(msg.id).slice(0, 120);
  return 'h:' + cyrb53(normText(msg.text).toLowerCase());
}
function resolveAccount(bank, accs) {
  if (!bank) return '';
  const hit = accs.filter(a => a.kind === 'asset' && a.name.toLowerCase().includes(bank));
  return hit.length === 1 ? hit[0].id : '';
}
function buildTx(p, key) {
  return { id: Core.uid(), type: p.type, amt: p.amt, date: p.date, acc: p.acc, cat: p.cat || (p.refund ? 'Refunds & reimbursements' : p.type === 'income' ? 'Other income' : 'Other expenses'),
    pay: '', party: p.party || '', note: 'Auto-detected', tags: 'auto-import' };
}
/* processMessage(msg, ctx) -> {outcome:'ignored'|'duplicate'|'saved'|'pending', rec?, tx?}
   msg: {text, sender, id, at, src, force}   ctx: {imports: Map(key->rec), accs, mode:'auto'|'review', minConf} */
function processMessage(msg, ctx) {
  const p = parseSms(msg.text, { sender: msg.sender, now: msg.at });
  if (p.kind === 'ignored') return { outcome: 'ignored', reason: p.reason };
  let key = importKey(msg, p);
  if (ctx.imports.has(key)) { if (!msg.force) return { outcome: 'duplicate', key }; key += '#' + (msg.at || Date.now()); }
  const acc = resolveAccount(p.bank, ctx.accs);
  const parsed = { type: p.type, amt: p.amt, cur: p.cur, date: p.date, party: p.party, bank: p.bank, acc, refund: p.refund, dateFromReceipt: p.dateFromReceipt };
  const base = { key, ref: p.ref, sender: String(msg.sender || '').slice(0, 40), src: msg.src || 'paste', conf: p.conf, at: msg.at || Date.now(), parsed, flags: p.flags };
  if (ctx.mode === 'auto' && p.kind === 'transaction' && p.conf >= (ctx.minConf || 0.85) && acc && msg.src !== 'demo') {
    const tx = buildTx(parsed, key); return { outcome: 'saved', tx, rec: { ...base, status: 'saved', txId: tx.id, text: '' } };
  }
  return { outcome: 'pending', rec: { ...base, status: 'pending', text: normText(msg.text).slice(0, 500) } };
}
const Sms = { normText, parseSms, importKey, resolveAccount, buildTx, processMessage, cyrb53 };
root.Sms = Sms; if (typeof module !== 'undefined') module.exports = Sms;
})(typeof self !== 'undefined' ? self : globalThis);
