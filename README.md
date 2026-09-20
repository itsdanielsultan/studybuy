# StudyBuy

A study-book order checker built for the Agnic Pioneers sprint by Daniel Sultan.

The learner sets a budget, required edition and delivery deadline. StudyBuy compares two fictional offers, explains which one fits and asks for approval of the exact order. The demo can then show a fictional receipt, a changed price or an uncertain result.

## Try locally

Node.js 22 or later is required. No dependencies, credentials or payment method are needed.

```sh
npm test
npm start
```

Open http://127.0.0.1:4187. Check the offers, review an order, tick the simulation approval and choose a scenario. The reset button clears only the fictional demo session.

## What works

- Checks the total price, edition, format, quantity, delivery date and quote expiry.
- Binds approval to the exact quote and learner requirements.
- Rejects a changed quote and repeated use of the same approval within a running session.
- Keeps a timeout unresolved instead of automatically retrying.
- Matches a fictional receipt to the approved item and amount.

The test suite contains 30 automated checks. The browser interface has also been checked on desktop and a narrow phone viewport.

## What is simulated

All products, merchants and receipts are fictional. The examples use reserved `.test` domains and a fixed September 19, 2026 clock. There is no Agnic API integration, real checkout, card handling, wallet, payment or merchant order. This is a policy and interface prototype, not a completed shopping agent.

Session state exists only in memory. It can disappear on a server restart or a serverless cold start, and it is not shared between server instances. Duplicate protection is limited to one running instance. Real purchases would require durable state, authentication, a reviewed provider integration and reliable transaction reconciliation. Do not use this prototype for real purchases.

The deployment adapter uses the same policy code with a small serverless wrapper. A hosted preview is not available yet. No credentials or external service calls are required for the simulation. The local server exposes only an explicit list of public assets.

Daniel Sultan is the project owner. AI assistance produced substantial implementation and application material.

Inter fonts are distributed under the SIL Open Font License in `public/INTER-LICENSE.txt`.
