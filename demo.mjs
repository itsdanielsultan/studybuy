import { OfflineStudyBuy, inspectQuote, quoteFingerprint } from './policy.mjs';
import { offerA, offerB, limits, NOW, receiptFor } from './fixtures.mjs';

console.log('StudyBuy OFFLINE SIMULATION — fictional offers; no network or payment.');
console.log('Offer A:', inspectQuote(offerA, limits, NOW));
console.log('Offer B:', inspectQuote(offerB, limits, NOW));
const engine = new OfflineStudyBuy();
const approval = engine.approveSimulation(offerA, limits, {
  action: 'approve-simulation', fingerprint: quoteFingerprint(offerA, limits),
}, NOW);
const attempt = engine.claimSimulation(approval.token, offerA, limits, NOW);
console.log('Explicit fictional approval:', attempt.status);
console.log('Replay blocked:', engine.claimSimulation(approval.token, offerA, limits, NOW));
console.log('Timeout does not retry:', engine.reconcileSimulation(attempt.attemptId, { kind: 'timeout' }));
console.log('Fixture reconciliation:', engine.reconcileSimulation(attempt.attemptId, receiptFor()));
console.log('This is not a merchant receipt or a qualifying Agnic submission.');
