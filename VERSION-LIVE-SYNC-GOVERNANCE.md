# Version / Live Sync Governance

This file is for Codex agents working on the Fuman terminal.

## Goal

Keep these three surfaces aligned:

- official source repo: `C:\fuman-terminal-sync`
- deploy repo: `C:\fuman-terminal`
- live site: `https://fuman-terminal.vercel.app`

The live site is considered current only when local version, live `version.json`, versioned frontend assets, and live `terminal-app.js` hash all match.

## Automatic Detection

Use this command to detect version drift:

```powershell
npm run verify:live-version
```

It automatically:

- detects the local frontend version from `terminal-core.js`
- checks live `version.json`
- checks live `index.html` asset version query strings
- checks live service worker cache version
- fetches live `terminal-app.js?v=<local-version>`
- compares live `terminal-app.js` hash with local `terminal-app.js`
- verifies market event reminders still exist:
  - `台指期大結算`
  - `美股四巫日`
  - `installMarketSettlementTitleBadgeGuard`
  - order: `台指期大結算` before `美股四巫日`

If this command passes, the live frontend is aligned with the official source.

## If Version Drift Is Detected

Common failures:

- `version-json check failed`
- `terminal-app hash mismatch`
- live asset missing current version query string

Do not manually change the source version backwards to match live.

Correct fix: publish the current official source forward.

If the working tree is clean and GitHub should be updated, run:

```powershell
npm run release:main
```

This is the guarded daily chain:

```text
main -> bump -> deploy -> live verify -> push GitHub
```

If the user explicitly needs an urgent live UI repair while the repo has unrelated dirty data files, run only the live repair path:

```powershell
npm run verify:version
npm run verify:sw
npm run sync:source
npm run deploy
npm run verify:live-version
```

Then tell the user that GitHub push is still pending until the repo is clean enough for `npm run release:main`.

## Freshness Gate Relationship

The total freshness gate is:

```powershell
npm run freshness:gate
```

`freshness:gate` runs `verify:live-version`, so market event reminders and live/source version alignment are part of the gate.

The fast gate is:

```powershell
npm run freshness:gate:fast
```

It is for scheduled intraday refreshes, but publishing must still end with live verification.

## Market Event Reminder Contract

The market event reminder must remain protected by live verification.

Required live `terminal-app.js` markers:

- `installMarketSettlementTitleBadgeGuard`
- `台指期大結算`
- `美股四巫日`
- `market-nav-label`

Required order:

```text
台指期大結算 -> 美股四巫日
```

If these markers disappear from live JS, `npm run verify:live-version` must fail.

## AI Panel Contract

The AI panel must keep:

- `installMarketAiLoadingGuard`
- `installMarketAiRuntimeLine`
- visible text: `AI 判讀運作時間`

If AI panel loading stalls, the loading guard should force:

```text
terminal-home-bundle -> market-summary -> stock fallback -> render AI panel
```

## Codex Rule

Before claiming a release is complete, report which of these passed:

```powershell
npm run verify:version
npm run verify:sw
npm run verify:live-version
```

For a full daily publish, also require:

```powershell
npm run release:main
```

Do not claim `push GitHub` happened unless `npm run release:main` completed and pushed `origin/main`.
