# Codex Operating Rule

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

Before claiming the terminal is current, run:

```powershell
npm run verify:publish-gate
npm run verify:data-freshness:live
```
