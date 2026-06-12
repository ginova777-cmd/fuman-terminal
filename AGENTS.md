# Codex Operating Rule

Mobile-readable summary: `FRESHNESS-GATE-MOBILE.md`

Every Codex touching this project must first sync and read the operating rules:

```powershell
git pull --ff-only origin main
npm run verify:publish-gate
```

Read `AGENTS.md` and `FRESHNESS-GATE-MOBILE.md` before changing data flow, scheduled tasks, publish scripts, or freshness rules.

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
