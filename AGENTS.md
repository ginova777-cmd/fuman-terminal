# Codex Operating Rule

The only approved data publish entrypoint is:

```powershell
npm run freshness:gate
```

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

Before claiming the terminal is current, run:

```powershell
npm run verify:publish-gate
npm run verify:data-freshness:live
```
