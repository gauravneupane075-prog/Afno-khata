require('fake-indexeddb/auto');
const test = require('node:test'), assert = require('node:assert/strict');
const Core = require('../www/core.js'), Sms = require('../www/sms.js');
const NOW = Date.UTC(2026, 9, 29, 6, 0, 0);
const P = (t, sender = '') => Sms.parseSms(t, { sender, now: NOW });

test('debit message: amount, direction, date, ref and bank', () => {
  const p = P('Dear Customer, Rs. 1,500.00 has been debited from your account on 29 Oct 2026. Ref No: TX123456', 'NABIL');
  assert.equal(p.kind, 'transaction'); assert.equal(p.type, 'expense'); assert.equal(p.amt, 150000); assert.equal(p.date, '2026-10-29');
  assert.equal(p.ref, 'TX123456'); assert.equal(p.bank, 'nabil'); assert.ok(p.conf >= 0.85); assert.deepEqual(p.flags, []);
});
test('credit message with sender name', () => {
  const p = P('You have received Rs. 2,000 from Ram. Txn ID 998877 on 29-10-2026', 'eSewa');
  assert.equal(p.type, 'income'); assert.equal(p.amt, 200000); assert.equal(p.party, 'Ram'); assert.equal(p.date, '2026-10-29'); assert.equal(p.bank, 'esewa');
});
test('amount formats and currencies', () => {
  assert.equal(P('NPR 1,50,000.50 credited to your A/c on 29 Oct 2026 Ref 1234567', 'EBL').amt, 15000050);
  assert.equal(P('रु 2,500 credited to your account', 'NABIL').amt, 250000);
  assert.equal(P('Rs.75 debited at Bhat-Bhateni. Ref 5555555', 'NIC ASIA').amt, 7500);
  assert.equal(P('Your account is debited with 300 NPR', 'NMB').amt, 30000);
});
test('Nepali text with Devanagari digits', () => {
  const p = P('तपाईंको खाताबाट रु. १,५०० निकालिएको छ। Ref 123456', 'Nabil');
  assert.equal(p.type, 'expense'); assert.equal(p.amt, 150000);
});
test('balance and fee amounts are not mistaken for the transaction amount', () => {
  const p = P('Rs 500.00 debited from A/c. Avl Bal Rs 12,000.00. Ref 777777', 'EBL'); assert.equal(p.amt, 50000); assert.deepEqual(p.flags, []);
  assert.equal(P('Your balance is Rs 12,000.00', 'EBL').reason, 'no-direction');
});
test('refund and reversal are income, tagged as refund', () => {
  const p = P('Refund of Rs 800 has been credited to your account. Ref 424242', 'Khalti');
  assert.equal(p.type, 'income'); assert.equal(p.refund, true); assert.equal(p.amt, 80000);
  assert.equal(P('Reversal: Rs 250 credited to your account. Ref 12121212', 'NABIL').refund, true);
});
test('failed, pending, OTP, reminders and promos are never recorded', () => {
  const ign = (t, r) => { const p = P(t, 'NABIL'); assert.equal(p.kind, 'ignored', t); assert.equal(p.reason, r, t); };
  ign('Transaction of Rs 500 failed. Amount not debited.', 'failed'); ign('Your payment of Rs 500 is pending and will be debited soon', 'pending');
  ign('Your OTP is 123456 for payment of Rs 500. Do not share.', 'otp'); ign('Bill is due on 5 Nov. Please pay Rs 1,200', 'reminder');
  ign('Congratulations! Win Rs 50,000 lucky draw. Apply now', 'promotional'); ign('', 'empty'); ign('hello how are you', 'no-direction');
});

test('ambiguous or risky messages become review drafts, never silent saves', () => {
  assert.ok(P('Rs 500 debited from your account and credited to Ram. Ref 5656565', 'EBL').flags.includes('direction-ambiguous'));
  assert.ok(P('Rs 500 debited, Rs 20 debited as charge fee? Rs 600 debited. Ref 767676', 'EBL').flags.includes('multiple-amounts'));
  const l = P('Rs 5,000 debited. Click http://evil.example/dispute now. Ref 898989', 'NABIL'); assert.ok(l.flags.includes('link')); assert.equal(l.kind, 'review'); assert.ok(l.conf <= 0.4);
  assert.ok(P('Rs 100 debited on 05/06/2026 Ref 989898', 'NABIL').flags.includes('date-ambiguous'));
  assert.equal(P('Rs 100 debited on 29/10/2026 Ref 989898', 'NABIL').date, '2026-10-29');
  assert.ok(P('Rs 100 debited on 31 Dec 2027 Ref 989898', 'NABIL').flags.includes('date-future'));
  assert.equal(P('Rs 100 debited on 30 Feb 2026 Ref 989898', 'NABIL').flags.includes('date-invalid'), true);
});
test('unknown sender is capped below the auto-save threshold; missing amount is ignored, not guessed', () => {
  const p = P('Rs 900 debited from your account on 29 Oct 2026. Ref 4545454', 'MYSTERY'); assert.ok(p.conf <= 0.7); assert.equal(p.bank, '');
  assert.equal(P('Amount has been debited from your account', 'NABIL').reason, 'no-amount');
});
test('date falls back to the receive time (flagged), not a guess', () => {
  const p = P('Rs 100 debited from A/c. Ref 111222', 'EBL'); assert.equal(p.date, '2026-10-29'); assert.equal(p.dateFromReceipt, true);
});
test('message text is not executed or interpreted: markup stays plain text', () => {
  const p = P('Rs 100 debited. <img src=x onerror=alert(1)> paid to <b>Shop</b>. Ref 232323', 'EBL'); assert.equal(typeof p.amt, 'number'); assert.ok(!/[<>]/.test(p.party));
});

const accs = [{ id: 'ebl', name: 'EBL', kind: 'asset', open: 0 }, { id: 'nab', name: 'Nabil', kind: 'asset', open: 0 }, { id: 'c', name: 'Cash', kind: 'asset', open: 0 }];
const ctx = (o = {}) => ({ imports: new Map(), accs, mode: 'review', minConf: 0.85, ...o });
const MSG = { text: 'Dear Customer, Rs. 1,500.00 has been debited from your account on 29 Oct 2026. Ref No: TX123456', sender: 'NABIL', at: NOW, src: 'notification', id: 'k|1' };

test('review mode (default) creates a pending draft and no transaction', () => {
  const r = Sms.processMessage(MSG, ctx()); assert.equal(r.outcome, 'pending'); assert.equal(r.tx, undefined); assert.equal(r.rec.status, 'pending'); assert.equal(r.rec.parsed.acc, 'nab');
});
test('auto mode saves only confident, known-account messages', () => {
  const r = Sms.processMessage(MSG, ctx({ mode: 'auto' })); assert.equal(r.outcome, 'saved'); assert.equal(r.tx.amt, 150000); assert.equal(r.tx.type, 'expense'); assert.equal(r.tx.acc, 'nab'); assert.equal(r.rec.text, '');
  assert.equal(r.tx.note, 'Auto-detected');
  assert.equal(Sms.processMessage({ ...MSG, sender: 'Mystery', text: MSG.text.replace('Ref No: TX123456', 'Ref No: TX999999') }, ctx({ mode: 'auto' })).outcome, 'pending');   // unknown sender
  assert.equal(Sms.processMessage({ ...MSG, sender: 'Global IME', text: 'Rs 5 debited on 29 Oct 2026 Ref 8888888' }, ctx({ mode: 'auto' })).outcome, 'pending');   // no matching account
  assert.equal(Sms.processMessage(MSG, ctx({ mode: 'auto', accs: [{ id: 'a', name: 'Nabil A', kind: 'asset', open: 0 }, { id: 'b', name: 'Nabil B', kind: 'asset', open: 0 }] })).outcome, 'pending');   // ambiguous account
});
test('duplicates: same reference, repeated notification, and identical pasted text are not imported twice', () => {
  const imports = new Map(); const first = Sms.processMessage(MSG, ctx({ imports })); imports.set(first.rec.key, first.rec);
  assert.equal(Sms.processMessage(MSG, ctx({ imports })).outcome, 'duplicate');
  assert.equal(Sms.processMessage({ ...MSG, id: 'other|2', text: MSG.text + ' ' }, ctx({ imports })).outcome, 'duplicate');   // same ref+amount via another app
  assert.equal(Sms.processMessage({ ...MSG, force: true }, ctx({ imports })).outcome, 'pending');
});
test('two legitimate payments with the same amount are not merged', () => {
  const imports = new Map(), a = Sms.processMessage({ text: 'Rs 100 debited from A/c on 29 Oct 2026. Ref 1111111', sender: 'EBL', at: NOW, id: 'a|1' }, ctx({ imports })); imports.set(a.rec.key, a.rec);
  assert.equal(Sms.processMessage({ text: 'Rs 100 debited from A/c on 29 Oct 2026. Ref 2222222', sender: 'EBL', at: NOW, id: 'a|2' }, ctx({ imports })).outcome, 'pending');
  const n1 = Sms.processMessage({ text: 'Rs 50 debited from A/c', sender: 'EBL', at: NOW, id: 'n|1' }, ctx({ imports })); imports.set(n1.rec.key, n1.rec);
  assert.equal(Sms.processMessage({ text: 'Rs 50 debited from A/c', sender: 'EBL', at: NOW + 60000, id: 'n|2' }, ctx({ imports })).outcome, 'pending');   // no ref, different notification
});
test('demo source is never auto-saved', () => {
  assert.equal(Sms.processMessage({ ...MSG, src: 'demo' }, ctx({ mode: 'auto' })).outcome, 'pending');
});
test('ignored messages store nothing and return only a reason', () => {
  const r = Sms.processMessage({ text: 'Your OTP is 445566. Do not share.', sender: 'NABIL' }, ctx()); assert.deepEqual(r, { outcome: 'ignored', reason: 'otp' });
});
