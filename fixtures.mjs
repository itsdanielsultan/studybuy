// Fictional fixtures only. These are not merchant offers or exam products.
export const NOW = Date.parse('2026-09-19T12:00:00Z');
export const limits = Object.freeze({
  currency: 'CAD', budget: 4000, deliveryBy: '2026-09-21',
  format: 'paperback', edition: '2026', quantity: 1,
});
export const offerA = Object.freeze({
  id: 'DEMO-A-001', merchant: 'Paper Demo',
  productUrl: 'https://paper.example.test/book', sku: 'DEMO-PAPER-2026',
  fulfillment: 'DEMO-A-STANDARD', title: 'Fictional CIRE Study Guide',
  currency: 'CAD', item: 3200, shipping: 300, tax: 455, total: 3955,
  quantity: 1, format: 'paperback', edition: '2026', delivery: '2026-09-20',
  returns: '14-day fictional return', expiresAt: NOW + 300000,
  amountIsFinal: true, state: 'ready',
});
export const offerB = Object.freeze({
  ...offerA, id: 'DEMO-B-001', merchant: 'Study Demo',
  productUrl: 'https://study.example.test/book', sku: 'DEMO-STUDY-2026',
  fulfillment: 'DEMO-B-STANDARD', item: 3000, shipping: 500,
  delivery: '2026-09-22', returns: '7-day fictional return',
});
export const receiptFor = (quote = offerA) => ({
  kind: 'simulation', status: 'confirmed', orderId: 'DEMO-ORDER-001',
  quoteId: quote.id, sku: quote.sku, quantity: quote.quantity,
  currency: quote.currency, total: quote.total,
});
