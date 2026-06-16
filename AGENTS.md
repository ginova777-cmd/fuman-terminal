# Codex Operating Rule

Mobile-readable summary: `FRESHNESS-GATE-MOBILE.md`

Strategy2 data governance: `STRATEGY2-FRESHNESS-GOVERNANCE.md`

Realtime radar data governance: `REALTIME-RADAR-FRESHNESS-GOVERNANCE.md`

Strategy5 data governance: `STRATEGY5-FRESHNESS-GOVERNANCE.md`

Version/live sync governance: `VERSION-LIVE-SYNC-GOVERNANCE.md`

Every Codex touching this project must first sync and read the operating rules:

```powershell
git pull --ff-only origin main
npm run verify:publish-gate
```

Read `AGENTS.md`, `FRESHNESS-GATE-MOBILE.md`, `STRATEGY2-FRESHNESS-GOVERNANCE.md`, `REALTIME-RADAR-FRESHNESS-GOVERNANCE.md`, and `STRATEGY5-FRESHNESS-GOVERNANCE.md` before changing data flow, scheduled tasks, publish scripts, strategy2 A-zone output, realtime radar output, strategy5 output, or freshness rules.

Also read `VERSION-LIVE-SYNC-GOVERNANCE.md` before changing frontend version files, deploying UI changes, or responding to a live/source version mismatch.

`freshness:gate` also performs a repo sync preflight. If this checkout is behind `origin/main` or has unexpected dirty files, the gate must fail before publishing.

External data-source timeouts, HTTP 403/404, and fetch failures must remain observable in logs and health summary. They are source warnings unless the final live freshness verifier fails.

Do not modify Supabase-related code, tables, upload, readback, timeout, or retry behavior unless the user explicitly asks for Supabase work.

The only approved data publish entrypoint is:

```powershell
npm run freshness:gate
```

For routine scheduled refreshes, this fast gate is also approved:

```powershell
npm run freshness:gate:fast
```

Both gates must end with `verify:data-freshness:live` before the terminal is considered current.

`verify:data-freshness:live` must validate the terminal freshness gate artifact:

```text
data/live-freshness-ok.json
```

This artifact is the live, terminal-readable proof that the published data passed the gate. It must include a unique gateId for this publish, the current terminal version, manifest count, CB row count, manifest CB count, verifier name, and checked time. Do not treat a publish as terminal-current until this artifact is visible on Vercel and the live verifier accepts it.

Mobile UI is part of the release gate. The market heatmap on mobile must remain a two-column grid:

```css
#market-view #heatmap {
  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
}
```

Do not reintroduce a mobile one-column heatmap override. Any change touching mobile market overview, `styles.css`, `index.html`, service worker versioning, or release scripts must pass:

```powershell
npm run verify:mobile-layout
npm run verify:mobile-layout:live
```


## Auto Main Release Chain For Codex

Other Codex agents must keep terminal release automation on the guarded chain. Before claiming data or UI is current, automatically detect repo state first:

```powershell
git fetch origin main
git status -sb
npm run verify:publish-gate
```

If the checkout is behind `origin/main`, ahead/behind has diverged, or the tree has unexpected dirty files, stop and fix sync/dirty state before deploy. Do not manually copy data, manually bump versions, deploy from a stale tree, or push GitHub separately.

Codex must treat the release chain as an automated detection loop, not a manual checklist. The required order is:

```text
detect current main -> sync main -> detect version drift -> bump version if needed -> deploy production -> live verify -> push GitHub -> verify live freshness
```

Use the project scripts to do that detection. A Codex agent may not skip directly to `vercel --prod`, `git push`, or manual file copy unless it first proves the guarded chain is blocked and reports the blocker.

Required detection commands:

```powershell
git fetch origin main
git status -sb
npm run verify:publish-gate
npm run verify:version
npm run verify:live-version
```

If local version and live version differ, Codex must not edit version strings backwards and must not guess the correct cache key. Run the guarded chain so `scripts/bump-version.js` advances the version and all versioned assets move together:

```powershell
npm run release:main
```

When data freshness is part of the change, run the freshness gate first, then release main:

```powershell
npm run freshness:gate
npm run release:main
npm run verify:data-freshness:live
```

The terminal is current only when all of these are true:

- `npm run verify:version` passes locally.
- `npm run verify:live-version` passes against `https://fuman-terminal.vercel.app`.
- `npm run verify:data-freshness:live` passes.
- `data/live-freshness-ok.json` is visible on Vercel with the current version and gateId.
- `git status -sb` shows no unexpected source changes except explicitly acknowledged generated cache residue.
- `origin/main` contains the final release/gate commit.

The only normal release path is:

```text
sync main -> bump if needed -> deploy -> live verify -> push GitHub
```

Run it through:

```powershell
npm run release:main
```

`npm run release:main` is responsible for `git fetch`, `git pull --ff-only origin main`, version bump detection, `npm run sync:source`, Vercel production deploy, `npm run verify:live-version`, and final `git push origin HEAD:main`. If any step fails, the terminal is not current yet.
Main release/deploy must use the guarded release chain:

```powershell
npm run release:main
```

This wrapper enforces: sync `origin/main` -> bump version if needed -> deploy -> verify live version -> push GitHub.

Version detection and live alignment must be automatic. `npm run verify:live-version` detects the local frontend version, reads the live `version.json`, fetches versioned assets, compares live `terminal-app.js` against local `terminal-app.js`, and verifies market event reminders. If it fails with `version-json check failed` or `terminal-app hash mismatch`, do not edit version strings backwards. Re-align by running the guarded chain:

```powershell
npm run release:main
```

If the working tree is not clean and the user explicitly needs a UI-only live repair before GitHub push, sync and deploy the current official source, then immediately run live verification:

```powershell
npm run sync:source
npm run deploy
npm run verify:live-version
```

After the live repair, return to the guarded daily chain when the repo is clean so the final flow remains: main -> bump -> deploy -> live verify -> push GitHub.

Do not run scoped publishing commands such as:

```powershell
.\run-cache-sync.ps1 -Scope warrant
.\run-cache-sync.ps1 -Scope institution
.\run-cache-sync.ps1 -Scope strategy2
.\run-cache-sync.ps1 -Scope strategy3
.\run-cache-sync.ps1 -Scope strategy4
.\run-cache-sync.ps1 -Scope strategy5
.\run-cache-sync.ps1 -Scope cb
```

Those commands are intentionally blocked by `run-cache-sync.ps1`.

Raw scanners may refresh runtime data, but publishing must be centralized through `npm run freshness:gate` so `verify:data-freshness:live` is the final success condition.

Strategy3 data is a critical publish artifact. `strategy3-latest.json`, `strategy3-backup.json`, and `strategy3-scorecard-source.json` must be copied back into the official source repo by the freshness gate, committed with `npm run snapshot:data`, and then released through `npm run release:main` so the daily chain is: main -> bump -> deploy -> live verify -> push GitHub.

Strategy2 data is governed separately as well: strategy2 A-zone JSON, LINE alerts, intraday patrol output, and `strategy2-intraday-*.json` must not be published by scoped sync or manual copy. They must pass through the freshness gate and final live verifier.

Realtime radar data is governed separately as well: `realtime-radar-latest.json`, realtime radar scanner output, failed batch details, stale quote details, and radar filter rules must not be published by scoped sync or manual copy. They must pass through the freshness gate and final live verifier.

Strategy5 data is governed separately as well: `strategy5-latest.json`, `strategy5-backup.json`, `strategy-match-index.json`, 籌碼老K, 外資投信連買準突破, and multi-strategy confluence output must not be published by scoped sync or manual copy. They must pass through the freshness gate and final live verifier.

Windows Task Scheduler should use these official tasks:

- `Fuman Freshness Gate Fast 0845-1645`
- `Fuman Freshness Gate Full 0610 2010`
- `Fuman Terminal Local Freshness Verify 0830-2230`
- `Fuman Publish Gate Verify 0820`

Old data scripts are legacy shims only; they must redirect to `legacy-entrypoint-guard.ps1`.

Local terminal data repair is automated by:

```powershell
npm run freshness:local-repair
```

It verifies `C:\fuman-terminal\data`; if local data is stale, it runs `npm run freshness:gate:fast` and verifies again.

Before claiming the terminal is current, run:

```powershell
npm run verify:publish-gate
npm run verify:data-freshness:live
```


