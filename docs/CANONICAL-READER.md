# Canonical Reader v1

`lib/canonical-reader.js` is the shared read and publication-identity layer. It does not scan stocks and does not replace a strategy verifier.

Each strategy supplies a policy and its authoritative receipt. The reader resolves the Taipei trading session, validates the daily canonical and verification identities, receipt/contract/field versions, freshness, coverage, and fallback disclosure. It then requires desktop, mobile, `/88`, LINE, and Telegram to match the same immutable batch identity and result count.

```js
const { buildPublicationEnvelope, readCanonicalBatch } = require("./lib/canonical-reader");

const publication = buildPublicationEnvelope(strategyReceipt, { rows });
const result = readCanonicalBatch({
  now,
  calendar: marketCalendar,
  policy: {
    strategy: "strategy4",
    contract_version: "strategy4-v3",
    field_version: "fields-v2",
    requires_intraday_5m: false
  },
  receipt: strategyReceipt,
  surfaces: { desktop, mobile, route88, line, telegram }
});
```

Only a strategy that declares `requires_intraday_5m: true` must provide `resources.intraday_5m`. Selection rules and the final semantic verdict remain owned by that strategy and its verifier. The reader's `publish_allowed` only proves the shared delivery contract.
