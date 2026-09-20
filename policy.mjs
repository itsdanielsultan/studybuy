// Offline simulation only. No network, payment, browser or credential adapter.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const QUOTE_KEYS = [
  'id', 'merchant', 'productUrl', 'sku', 'fulfillment', 'title', 'currency',
  'item', 'shipping', 'tax', 'total', 'quantity', 'format', 'edition',
  'delivery', 'returns', 'expiresAt', 'amountIsFinal', 'state',
].sort();
const LIMIT_KEYS = ['currency', 'budget', 'deliveryBy', 'format', 'edition', 'quantity'].sort();
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x)
  && Object.getPrototypeOf(x) === Object.prototype;
const exactKeys = (x, keys) => plain(x) && JSON.stringify(Object.keys(x).sort()) === JSON.stringify(keys);
const money = x => Number.isSafeInteger(x) && x >= 0;
const text = x => typeof x === 'string' && x.trim().length > 0 && x.length <= 250;
const date = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)
  && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0, 10) === x;
const canonical = x => JSON.stringify(Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])));
const digest = x => createHash('sha256').update(canonical(x)).digest('hex');
const result = (status, reason) => Object.freeze({ status, reason });

// Return fixed codes, never raw provider errors, URLs or user-supplied content.
export function inspectQuote(q, c, now) {
  if (!exactKeys(q, QUOTE_KEYS) || !exactKeys(c, LIMIT_KEYS)) return result('blocked', 'invalid_schema');
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(q.expiresAt)) return result('blocked', 'invalid_clock');
  for (const k of ['id', 'merchant', 'productUrl', 'sku', 'fulfillment', 'title', 'format', 'edition', 'returns']) {
    if (!text(q[k])) return result('blocked', 'missing_quote_details');
  }
  if (!text(c.format) || !text(c.edition) || !date(q.delivery) || !date(c.deliveryBy)) return result('blocked', 'invalid_requirements');
  try {
    const u = new URL(q.productUrl);
    if (u.protocol !== 'https:' || !u.hostname.endsWith('.test') || u.username || u.password || u.search || u.hash) {
      return result('blocked', 'fictional_hosts_only');
    }
  } catch { return result('blocked', 'invalid_url'); }
  if (q.currency !== 'CAD' || c.currency !== 'CAD') return result('blocked', 'currency_mismatch');
  if (![q.item, q.shipping, q.tax, q.total, c.budget].every(money)) return result('blocked', 'invalid_money');
  const sum = q.item + q.shipping + q.tax;
  if (!Number.isSafeInteger(sum) || sum !== q.total) return result('blocked', 'invalid_total');
  if (q.quantity !== 1 || c.quantity !== 1) return result('blocked', 'one_item_only');
  if (q.total > c.budget) return result('blocked', 'over_budget');
  if (q.delivery > c.deliveryBy) return result('blocked', 'late_delivery');
  if (q.edition !== c.edition || q.format !== c.format) return result('blocked', 'wrong_product');
  if (q.expiresAt <= now) return result('blocked', 'quote_expired');
  if (typeof q.amountIsFinal !== 'boolean') return result('blocked', 'invalid_amount_status');
  if (q.state !== 'ready') return result('blocked', 'quote_not_ready');
  if (!q.amountIsFinal) return result('display_only', 'ceiling_not_final');
  return result('display_only', 'approval_required');
}

export function quoteFingerprint(q, c) {
  return digest({ quote: canonical(q), constraints: canonical(c) });
}

export class OfflineStudyBuy {
  #secret = randomBytes(32);
  #issued = new Map();
  #attempts = new Map();
  #sign(payload) { return createHmac('sha256', this.#secret).update(payload).digest('hex'); }

  approveSimulation(q, c, explicitApproval, now) {
    const check = inspectQuote(q, c, now);
    if (check.reason !== 'approval_required') return check;
    const fingerprint = quoteFingerprint(q, c);
    if (!plain(explicitApproval) || explicitApproval.action !== 'approve-simulation'
      || explicitApproval.fingerprint !== fingerprint) return result('blocked', 'explicit_approval_required');
    // Repeated clicks yield the same token, preventing multiple allowances for one quote.
    const existing = this.#issued.get(fingerprint);
    if (existing) return Object.freeze({ status: 'simulation_approved', token: existing });
    const payload = `${randomBytes(16).toString('hex')}.${fingerprint}.${q.expiresAt}`;
    const token = `${payload}.${this.#sign(payload)}`;
    this.#issued.set(fingerprint, token);
    return Object.freeze({ status: 'simulation_approved', token });
  }

  claimSimulation(token, q, c, now) {
    const check = inspectQuote(q, c, now);
    if (check.reason !== 'approval_required') return check;
    if (typeof token !== 'string' || token.length > 240) return result('blocked', 'invalid_approval');
    const parts = token.split('.');
    if (parts.length !== 4 || !/^[a-f0-9]{32}$/.test(parts[0])
      || !/^[a-f0-9]{64}$/.test(parts[1]) || !/^\d{13}$/.test(parts[2])
      || !/^[a-f0-9]{64}$/.test(parts[3])) return result('blocked', 'invalid_approval');
    const payload = parts.slice(0, 3).join('.');
    if (!timingSafeEqual(Buffer.from(parts[3], 'hex'), Buffer.from(this.#sign(payload), 'hex'))) {
      return result('blocked', 'invalid_approval');
    }
    const fingerprint = quoteFingerprint(q, c);
    if (parts[1] !== fingerprint || this.#issued.get(fingerprint) !== token) return result('blocked', 'quote_changed');
    if (Number(parts[2]) <= now) return result('blocked', 'approval_expired');
    const attemptId = `SIM-${parts[0]}`;
    if (this.#attempts.has(attemptId)) return result('blocked', 'attempt_already_claimed');
    // Atomic only inside this JS instance: there is no await between checking and setting.
    this.#attempts.set(attemptId, { quote: structuredClone(q), state: 'reserved' });
    return Object.freeze({ status: 'simulation_reserved', attemptId });
  }

  reconcileSimulation(attemptId, event) {
    const attempt = this.#attempts.get(attemptId);
    if (!attempt) return result('blocked', 'unknown_attempt');
    if (attempt.state === 'confirmed') return result('simulation_confirmed', 'already_reconciled');
    if (!plain(event)) { attempt.state = 'unknown'; return result('unconfirmed', 'status_check_required'); }
    if (event.retry_action === 'handoff') {
      attempt.state = 'unknown'; return result('handoff', 'human_required');
    }
    if (event.retry_action === 'poll' || event.httpStatus === 202 || event.status === 'processing') {
      attempt.state = 'processing'; return result('unconfirmed', 'poll_status_only');
    }
    if (event.kind === 'timeout' || event.retryable === null) {
      attempt.state = 'unknown'; return result('unconfirmed', 'status_check_required');
    }
    if (event.kind !== 'simulation' || event.status !== 'confirmed') {
      attempt.state = 'unknown'; return result('unconfirmed', 'receipt_required');
    }
    const q = attempt.quote;
    if (!/^DEMO-[A-Z0-9-]+$/.test(event.orderId ?? '') || event.quoteId !== q.id
      || event.sku !== q.sku || event.quantity !== q.quantity || event.currency !== q.currency
      || !money(event.total) || event.total !== q.total) {
      attempt.state = 'unknown'; return result('unconfirmed', 'receipt_mismatch');
    }
    attempt.state = 'confirmed';
    return Object.freeze({ status: 'simulation_confirmed', orderId: event.orderId, total: event.total, currency: event.currency });
  }
}
