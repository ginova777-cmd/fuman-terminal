# Fuman Terminal Release Owner Runbook

Last updated: 2026-07-01 Asia/Taipei.

This is the production release contract. It exists to prevent multiple Codex agents from pushing `main`, deploying Vercel, or changing the production mirror at the same time.

## Scope

The release owner is the only role allowed to push `main` or run production deploys.

Marker: `main is release-owner-only`

Other Codex agents may fix strategy code, source-chain code, Supabase SQL, UI, or verifiers, but they must hand off evidence instead of deploying directly.

## Agent Handoff

Every non-release Codex must work on a branch, not on the formal `main` release channel.

Branch format:

```text
agent/<scope>-<yyyymmdd>
```

Examples:

```text
agent/strategy3-source-snapshot-20260701
agent/strategy5-api-audit-20260701
agent/shared-source-quote-coverage-20260701
```

Required handoff fields:

- branch name
- commit SHA
- changed file list
- read-only scorecard
- whether the work wrote Supabase, cache, or runtime state
- exact commands run
- exact blockers still present

Marker: `Do not push main`

## Daily Merge Queue

Production merges happen through one queue.

Default release window:

```text
22:00 Asia/Taipei merge queue
```

During the merge queue, the release owner integrates one branch at a time:

1. Fetch latest `origin/main`.
2. Rebase or merge the candidate branch.
3. Resolve conflicts by preserving newer production gates and strategy evidence.
4. Run read-only verification first when the change touches source freshness, strategy APIs, or schedules.
5. Run publish/deploy gates only after the worktree is clean.
6. Push `main` only after gates pass.

If a branch is stale or conflicts with another strategy/source fix, it returns to the owner with the conflict evidence. It must not be force-pushed over `main`.

## Deploy Lock

When the release owner is integrating or deploying, all other agents are in read-only mode.

Forbidden during deploy lock:

- pushing `main`
- running `npm run deploy`
- running `vercel --prod`
- editing `C:\fuman-terminal`
- starting full scan, snapshot writer, receipt writer, or Supabase/cache/runtime writers unless the release owner explicitly includes them in the window

The deploy wrapper lock file is:

```text
FUMAN_DEPLOY_LOCK_FILE
```

## Formal Source And Mirror

Formal source changes must be made in the release clone.

`C:\fuman-terminal` is production mirror only.

Marker: `Do not deploy from C:\fuman-terminal`

The production mirror must be clean and fast-forwarded from `origin/main`; it is not a place for strategy agents to patch files.

## Production Deploy Command

The only allowed deploy command is:

```powershell
npm run deploy
```

Direct Vercel production deploy is forbidden:

```powershell
vercel --prod
```

`npm run deploy` is the guarded wrapper. It must check:

- worktree is clean
- branch is `main`
- local `HEAD` equals `origin/main`
- release SHA is fixed
- publish gate passed
- Vercel cost/project guards passed
- schedule registry does not reintroduce retired tasks
- production mirror is not dirty

## Release Evidence

A finished release report must include:

- production SHA
- deploy id
- production manifest result
- `npm run verify:source-sync`
- `npm run verify:publish-gate`
- `npm run monitor:production`
- schedule check result
- API unattended scorecard result
- exact remaining blockers, if any

Do not mark the whole terminal unattended `YES` when only deploy hygiene passed.

## API Read-Only Patrol

The all-strategy API unattended patrol is a release identity check and a strategy API check.

It must run from the current production mirror/source with a fixed release SHA:

```powershell
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File .\run-api-unattended-scorecard.ps1
```

The runner sets `FUMAN_RELEASE_SHA` from `git rev-parse HEAD`, then the scorecard reads `/api/release-manifest`. A valid scorecard must report:

- expectedReleaseSha
- liveGitSha
- deployId
- matchedExpectedRelease=true
- unattendedStatus=YES
- blockers=0

If the live manifest SHA differs from the fixed release SHA, this is not an API strategy failure; it is a release identity failure and the result is `NO`.

Valid layered status examples:

- deploy hygiene: YES
- old schedule rollback defense: YES
- global schedule registry: YES/PARTIAL/NO
- all strategy API unattended: YES/PARTIAL/NO

## Emergency Rule

If two agents push or prepare conflicting production changes, stop deploying. The release owner must fetch, inspect both commits, rebase intentionally, rerun gates, and only then push a single integrated `main`.
