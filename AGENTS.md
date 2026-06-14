# Codex Operating Rule

Mobile-readable summary: `FRESHNESS-GATE-MOBILE.md`

Strategy2 data governance: `STRATEGY2-FRESHNESS-GOVERNANCE.md`

Realtime radar data governance: `REALTIME-RADAR-FRESHNESS-GOVERNANCE.md`

Strategy5 data governance: `STRATEGY5-FRESHNESS-GOVERNANCE.md`

Every Codex touching this project must first sync and read the operating rules:

```powershell
git pull --ff-only origin main
npm run verify:publish-gate
```

Read `AGENTS.md`, `FRESHNESS-GATE-MOBILE.md`, `STRATEGY2-FRESHNESS-GOVERNANCE.md`, `REALTIME-RADAR-FRESHNESS-GOVERNANCE.md`, and `STRATEGY5-FRESHNESS-GOVERNANCE.md` before changing data flow, scheduled tasks, publish scripts, strategy2 A-zone output, realtime radar output, strategy5 output, or freshness rules.

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

Main release/deploy must use the guarded release chain:

```powershell
npm run release:main
```

This wrapper enforces: sync `origin/main` -> bump version if needed -> deploy -> verify live version -> push GitHub.

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

