# B11 fixed snapshot candidate verification

Status: isolated verification passed; production deployment and production anon generation-switch acceptance remain unproven. Overall complete=false.

## Current checks

- `node scripts/test-daytrade-snapshot-membership-integrity.js`: empty summary accepted; duplicate/mixed sequence/unlisted/removed active membership rejected. Malformed removed lists, duplicate removed symbols, non-string symbols and invalid input dates fail closed without an iterator/date exception.
- `node scripts/test-mother-pool-snapshot-readback.js`: exact header/member fields, mixed identity, duplicates, missing rows, read role and empty snapshot.
- `node scripts/test-mother-pool-writer-snapshot-immutability.js`: actual Writer function preserves the entire snapshot when membership is unchanged; new member advances identity; invalid reuse rejected.
- `node scripts/test-mother-pool-snapshot-publication-order.js`: actual Writer waits for database publication and matching readback before local publication; failure or mismatched acknowledgement preserves previous local latest; dry-run does not write.
- `node scripts/test-mother-pool-snapshot-recovery.js`: isolated recovery after database commit, local disk failure and acknowledgement persistence failure; cross-date reuse rejected.
- `node scripts/test-writer-exact-pagination.js`: exact totals, zero rows, truncated pages, unknown totals, malformed body, count drift and Content-Range mismatch.

All six commands passed in the current integration worktree. These use isolated inputs/injected database operations and do not assert a production migration, live atomically published generation, or receiver acceptance.

## Remaining acceptance

Deploy the reviewed SQL and Writer through the release flow; verify owner/anon exact fixed-generation membership; read an old generation across publication of a new generation; retain both receipts and pagination evidence. Natural member changes require actual subsequent market observations, not fixtures or reconstructed historical entry times.
