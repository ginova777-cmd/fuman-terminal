# Vercel Cost And Upload Guard

This repository must use one production upload path only:

```powershell
npm run verify:upload-gate
npm run deploy
```

Do not call `vercel --prod` directly. `npm run deploy` is the guarded wrapper that locks the deploy, blocks duplicate uploads, checks the production mirror, checks Vercel cron cost, checks project inventory, and then calls `scripts/deploy-production-with-release-env.js` so the production bundle is pinned to a release SHA.

Production deploy authority is defined in `RELEASE-OWNER-RUNBOOK.md`. `main` is release-owner-only; other Codex agents must hand off branches, commit SHAs, changed files, read-only scorecards, and whether Supabase/cache/runtime was written.

## Source Rules

- Formal source must be a clean GitHub `main` worktree.
- `C:\fuman-terminal` is production mirror only.
- Never deploy from a dirty worktree.
- Never deploy from a preview URL, temporary clone, or stale branch.
- Never bypass the `22:00 Asia/Taipei merge queue` unless the user explicitly opens an emergency release window.

## Cost Rules

- Vercel cron budget is capped by `FUMAN_VERCEL_CRON_DAILY_BUDGET`, default `30`.
- Allowed production crons are `/api/desktop-route-snapshot-refresh` and `/api/production-health`.
- `.vercelignore` must exclude runtime logs, outputs, local caches, and heavy local images.
- Do not add `@vercel/analytics` or `@vercel/speed-insights` unless the cost policy is reviewed.

## Inventory Rules

`npm run verify:vercel-projects` checks that `fuman-terminal` is the primary project and reports transitional projects:

- `fuman-terminal-strategy3`
- `fuman-terminal-strategy4`
- `fuman-terminal-strategy5-unattended`
- `fuman-strategy1-clean`
- `fuman-watchlist-limit`

Set `FUMAN_VERCEL_PROJECT_STRICT=1` only after transitional projects are removed.

## Daily Monitor

After this guard is deployed to the production mirror, install the monitor from the mirror:

```powershell
npm run monitor:vercel-cost:install
```

The monitor writes `C:\fuman-runtime\state\vercel-cost-health-status.json` and raises a cost alert with code `vercel_cost_health_failed` on critical failures.
