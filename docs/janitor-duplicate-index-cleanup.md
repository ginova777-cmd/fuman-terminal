# Duplicate index maintenance

Owner authorized duplicate index cleanup on 2026-09-30. The exact allowlist is in `data/contracts/duplicate-index-cleanup-v1.json`, embedded in `ops/public-slot/DuplicateIndexCleanupV1.sql`. Sixteen redundant indexes in nine groups were removed; application rows were not deleted.

`cleanup-extended-retention.js` calls `scripts/cleanup-duplicate-indexes.cjs` inside its existing extended stage. The five scheduled stages and nine authorized-maintenance steps retain their order. Existing task `Fuman Daily Retention Maintenance 1625` currently starts at 19:10 Taipei. The global cost janitor reads `status/duplicate-index-cleanup-status.json`; daily verification requires the dated applied receipt, and authorized maintenance hashes it into the extended-step journal. The 18:10 scorecard may display a preceding receipt within its 36-hour display freshness limit, but it cannot satisfy the daily verifier's current-day requirement.

The extended verifier invokes the index child with `--verify`, requires zero remaining duplicates, and writes a separate verifier receipt without overwriting the applied receipt. Parent receipts record the child file hash. The user-supplied 2026-09-24 cleanup acceptance contract remains applicable; this isolated child result does not prove the complete cleanup chain or natural unattended success.

Each run previews the fixed names, saves restoration DDL, applies once, and independently reads back remaining candidates. It does not retry writes after a timeout. Database code rejects execution between 06:00 and 14:00 Taipei, uses an advisory transaction lock, short table-lock timeout, and DROP INDEX RESTRICT. All index properties except identity must match the retained index; constraints, unique, primary, clustered and replica-identity indexes are protected. Missing survivor or schema drift aborts the transaction. Only service_role can invoke the RPC; anon and authenticated have no permission.

Strategies 2 historical runs/results and FinMind raw data remain review-only candidates. They are not automatic deletion targets until retention needs and downstream dependencies are established. Existing 15-day 1M retention remains unchanged. 5M is retired by PR #332 and must not be recreated by cleanup.

Index file bytes reclaimed do not measure reduction in Disk IO Budget or billed disk allocation. Natural unattended execution and later IO metrics must be assessed separately.
