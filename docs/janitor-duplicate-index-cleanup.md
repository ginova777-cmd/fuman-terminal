# Duplicate index maintenance

Owner authorized duplicate index cleanup on 2026-09-30. The exact allowlist is in `data/contracts/duplicate-index-cleanup-v1.json`, embedded in `ops/public-slot/DuplicateIndexCleanupV1.sql`. Sixteen redundant indexes in nine groups were removed; application rows were not deleted.

`run-daily-retention-maintenance.ps1` calls `scripts/cleanup-duplicate-indexes.cjs` before other maintenance. Existing task `Fuman Daily Retention Maintenance 1625` currently starts at 19:10 Taipei. The global cost janitor reads `status/duplicate-index-cleanup-status.json`; daily verification also requires the dated applied receipt. The 18:10 scorecard can read the preceding day's receipt within its existing 36-hour freshness limit.

Each run previews the fixed names, saves restoration DDL, applies once, and independently reads back remaining candidates. It does not retry writes after a timeout. Database code rejects execution between 06:00 and 14:00 Taipei, uses an advisory transaction lock, short table-lock timeout, and DROP INDEX RESTRICT. All index properties except identity must match the retained index; constraints, unique, primary, clustered and replica-identity indexes are protected. Missing survivor or schema drift aborts the transaction. Only service_role can invoke the RPC; anon and authenticated have no permission.

Strategies 2 historical runs/results and FinMind raw data remain review-only candidates. They are not automatic deletion targets until retention needs and downstream dependencies are established. Existing 15-day 1M retention remains unchanged. 5M is retired by PR #332 and must not be recreated by cleanup.

Index file bytes reclaimed do not measure reduction in Disk IO Budget or billed disk allocation. Natural unattended execution and later IO metrics must be assessed separately.
