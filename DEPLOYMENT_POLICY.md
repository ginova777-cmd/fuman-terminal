# Deployment Policy

Primary deployment path:

1. Edit only in `C:\fuman-terminal-sync`.
2. For frontend asset changes, run `npm run bump:version`.
3. Commit your changes.
4. Run `npm run release`.

`npm run release` runs `verify:all`, `verify:local-ops`, checks that the working tree is clean, pushes `origin/main`, and verifies the live version.

For data-only updates, run:

```powershell
npm run snapshot:data
npm run release
```

Frontend code changes and data snapshots should be committed separately.

Manual Vercel CLI deployment is backup only.

Prefer token-based CLI deploys on this Windows machine. `vercel login` can fail on Node 24 when the generated login header contains non-ASCII machine/user text.

If `npm run deploy` fails with an invalid token, create a fresh token in Vercel account settings and set it in the current PowerShell session:

```powershell
cd C:\fuman-terminal-sync
$env:VERCEL_TOKEN="YOUR_NEW_TOKEN"
vercel whoami --token $env:VERCEL_TOKEN
npm run deploy
```

To save the token for future PowerShell windows:

```powershell
[Environment]::SetEnvironmentVariable("VERCEL_TOKEN", "YOUR_NEW_TOKEN", "User")
```

Before important manual deploys, run the local operations audit:

```powershell
cd C:\fuman-terminal-sync
npm run verify:local-ops
```

If the audit prints scheduled-task warnings, open PowerShell as Administrator and run:

```powershell
cd C:\fuman-terminal-sync
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\repair-fuman-scheduled-tasks.ps1
```

Do not deploy or push from `C:\fuman-terminal` unless it has been intentionally cleaned and re-approved.

Scheduled cache/data publishing must use `C:\fuman-terminal-publish-sync`, not `C:\fuman-terminal-sync`. The publish sync repo is disposable and may be reset to `origin/main` by automation.
