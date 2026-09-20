import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OfflineStudyBuy, inspectQuote, quoteFingerprint } from './policy.mjs';
import { offerA as A, offerB as B, limits as C, NOW, receiptFor } from './fixtures.mjs';

function prepared(q = A, c = C) {
  const engine = new OfflineStudyBuy();
  const approval = engine.approveSimulation(q, c, { action: 'approve-simulation', fingerprint: quoteFingerprint(q, c) }, NOW);
  return { engine, token: approval.token, q, c };
}
function reserved() {
  const p = prepared();
  return { ...p, attempt: p.engine.claimSimulation(p.token, A, C, NOW) };
}

test('1. Unapproved quote is display-only; no token or attempt', () => {
  assert.deepEqual(inspectQuote(A, C, NOW), { status: 'display_only', reason: 'approval_required' });
  const e = new OfflineStudyBuy();
  for (const approval of [null, {}, { action: 'approve-simulation' }, { action: 'general-permission', fingerprint: quoteFingerprint(A, C) }]) {
    assert.equal(e.approveSimulation(A, C, approval, NOW).reason, 'explicit_approval_required');
  }
  assert.equal(e.claimSimulation(undefined, A, C, NOW).reason, 'invalid_approval');
});
test('2. A ceiling cannot be approved as settled payment', () => {
  const q = { ...A, amountIsFinal: false };
  assert.equal(inspectQuote(q, C, NOW).reason, 'ceiling_not_final');
  assert.equal(prepared(q).token, undefined);
});
test('3. Budget cannot round up by a cent', () => {
  assert.equal(inspectQuote(A, { ...C, budget: 3954 }, NOW).reason, 'over_budget');
  assert.equal(inspectQuote(A, { ...C, budget: 3955 }, NOW).reason, 'approval_required');
});
test('4. Late delivery and missing edition or terms block', () => {
  assert.equal(inspectQuote(B, C, NOW).reason, 'late_delivery');
  for (const k of ['edition', 'returns', 'fulfillment']) {
    assert.equal(inspectQuote({ ...A, [k]: '' }, C, NOW).status, 'blocked');
  }
  assert.equal(inspectQuote({ ...A, format: 'ebook' }, C, NOW).reason, 'wrong_product');
});
test('5. Complete approved quote reserves one fictional attempt', () => {
  const p = prepared();
  assert.equal(p.engine.claimSimulation(p.token, A, C, NOW).status, 'simulation_reserved');
  assert.equal(prepared({ ...A, state: 'choose_delivery' }).token, undefined);
});
test('6. A same-price different offer invalidates approval', () => {
  const c = { ...C, deliveryBy: '2026-09-23' };
  const p = prepared(A, c);
  assert.equal(p.engine.claimSimulation(p.token, B, c, NOW).reason, 'quote_changed');
});
test('7. Every changed quote field needs fresh approval', () => {
  const changes = {
    id: 'DEMO-OTHER', merchant: 'Another Demo', productUrl: 'https://another.example.test/book',
    sku: 'DEMO-OTHER', fulfillment: 'OTHER', title: 'Other fictional title',
    currency: 'USD', item: 3100, shipping: 200, tax: 400, total: 3900,
    quantity: 2, format: 'ebook', edition: '2025', delivery: '2026-09-21',
    returns: 'No fictional return', expiresAt: A.expiresAt + 1000,
    amountIsFinal: false, state: 'choose_delivery',
  };
  for (const [key, value] of Object.entries(changes)) {
    const p = prepared();
    assert.notEqual(p.engine.claimSimulation(p.token, { ...A, [key]: value }, C, NOW).status, 'simulation_reserved', key);
  }
  const p = prepared();
  assert.equal(p.engine.claimSimulation(p.token, A, { ...C, budget: 5000 }, NOW).reason, 'quote_changed');
});
test('8. Expiry is inclusive and clocks must be valid', () => {
  for (const now of [A.expiresAt, A.expiresAt + 1]) {
    const p = prepared();
    assert.equal(p.engine.claimSimulation(p.token, A, C, now).reason, 'quote_expired');
  }
  for (const now of [NaN, Infinity, 1.5, '2026-09-19']) assert.equal(inspectQuote(A, C, now).reason, 'invalid_clock');
});
test('9. Repeated clicks and replays never create a second attempt', () => {
  const p = prepared();
  const again = p.engine.approveSimulation(A, C, { action: 'approve-simulation', fingerprint: quoteFingerprint(A, C) }, NOW);
  assert.equal(p.token, again.token);
  assert.equal(p.engine.claimSimulation(p.token, A, C, NOW).status, 'simulation_reserved');
  assert.equal(p.engine.claimSimulation(again.token, A, C, NOW).reason, 'attempt_already_claimed');
});
test('10. Concurrent claims reserve once; tampering and cross-instance tokens fail', async () => {
  const p = prepared();
  const results = await Promise.all(Array.from({ length: 50 }, async () => p.engine.claimSimulation(p.token, A, C, NOW)));
  assert.equal(results.filter(r => r.status === 'simulation_reserved').length, 1);
  const invalid = p.token.slice(0, -1) + (p.token.endsWith('0') ? '1' : '0');
  assert.equal(p.engine.claimSimulation(invalid, A, C, NOW).reason, 'invalid_approval');
  assert.equal(new OfflineStudyBuy().claimSimulation(p.token, A, C, NOW).reason, 'invalid_approval');
});
test('11. Timeout means unknown; no second attempt even after timeout', () => {
  const p = reserved();
  assert.deepEqual(p.engine.reconcileSimulation(p.attempt.attemptId, { kind: 'timeout' }), { status: 'unconfirmed', reason: 'status_check_required' });
  assert.equal(p.engine.claimSimulation(p.token, A, C, NOW).reason, 'attempt_already_claimed');
});
test('12. Receipt must exactly match approved quote, SKU, quantity, currency, total', () => {
  for (const change of [{ quoteId: B.id }, { sku: B.sku }, { quantity: 2 }, { currency: 'USD' }, { total: 3956 }, { total: 3954 }, { total: NaN }, { orderId: '' }]) {
    const p = reserved();
    assert.equal(p.engine.reconcileSimulation(p.attempt.attemptId, { ...receiptFor(), ...change }).reason, 'receipt_mismatch');
  }
  const p = reserved();
  assert.equal(p.engine.reconcileSimulation(p.attempt.attemptId, receiptFor()).status, 'simulation_confirmed');
});
test('13. Processing, 202, and missing receipts do not claim success', () => {
  for (const event of [{ httpStatus: 202 }, { status: 'processing' }, { retry_action: 'poll' }, {}]) {
    const p = reserved();
    assert.equal(p.engine.reconcileSimulation(p.attempt.attemptId, event).status, 'unconfirmed');
  }
});
test('14. Unknown attempts and failures cannot create approval', () => {
  const p = prepared();
  assert.equal(p.engine.reconcileSimulation('missing', { kind: 'timeout' }).reason, 'unknown_attempt');
  assert.equal(p.engine.claimSimulation('failed-network', A, C, NOW).reason, 'invalid_approval');
});
test('15. Raw errors, card data, approval tokens and URLs are never returned by reconciliation', () => {
  const p = reserved();
  const secret = 'SENSITIVE-DEMO-MARKER';
  const output = p.engine.reconcileSimulation(p.attempt.attemptId, {
    error: secret, card: secret, token: secret, approval_url: `https://example.test/?token=${secret}`,
  });
  assert.equal(JSON.stringify(output).includes(secret), false);
  assert.deepEqual(Object.keys(output).sort(), ['reason', 'status']);
});
test('16. Malformed money and unsafe sums reject before approval', () => {
  for (const value of [-1, 0.5, NaN, Infinity, '3200', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(inspectQuote({ ...A, item: value }, C, NOW).reason, 'invalid_money');
  }
  assert.equal(inspectQuote({ ...A, total: 1 }, C, NOW).reason, 'invalid_total');
  assert.equal(inspectQuote({ ...A, item: Number.MAX_SAFE_INTEGER }, C, NOW).reason, 'invalid_total');
});
test('Only fictional HTTPS hosts without session data are allowed', () => {
  for (const productUrl of ['https://real.example.com/book', 'http://paper.example.test/book', 'https://name:secret@paper.example.test/book', 'https://paper.example.test/book?token=SECRET', 'https://paper.example.test/book#SECRET']) {
    assert.equal(inspectQuote({ ...A, productUrl }, C, NOW).reason, 'fictional_hosts_only');
  }
});
test('Reject extra fields and invalid dates rather than silently dropping them', () => {
  assert.equal(inspectQuote({ ...A, privateCard: 'never-copy' }, C, NOW).reason, 'invalid_schema');
  for (const delivery of ['2026-02-30', 'tomorrow', '', '2026-13-01']) {
    assert.equal(inspectQuote({ ...A, delivery }, C, NOW).reason, 'invalid_requirements');
  }
});
test('Provider retry_action takes precedence over retryable:null', () => {
  const p = reserved();
  assert.equal(p.engine.reconcileSimulation(p.attempt.attemptId, { retry_action: 'poll', retryable: null }).reason, 'poll_status_only');
  assert.equal(p.engine.reconcileSimulation(p.attempt.attemptId, { retry_action: 'handoff', retryable: null }).reason, 'human_required');
});
test('Caller mutations cannot change the reserved quote', () => {
  const q = { ...A };
  const p = prepared(q);
  const attempt = p.engine.claimSimulation(p.token, q, C, NOW);
  q.total = 100;
  assert.equal(p.engine.reconcileSimulation(attempt.attemptId, receiptFor(A)).status, 'simulation_confirmed');
});
test('Core contains no network or payment adapter and imports only crypto', () => {
  const source = readFileSync(new URL('./policy.mjs', import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/from '([^']+)'/g)].map(m => m[1]), ['node:crypto']);
  assert.equal(/\b(fetch|XMLHttpRequest|WebSocket|process\.env|eval)\s*[.(]/.test(source), false);
});
