# Deployment Policy

Primary deployment path:

1. Edit only in `C:\fuman-terminal-sync`.
2. For frontend asset changes, run `npm run bump:version`.
3. Run `npm run verify:version`.
4. Commit and push to `origin/main`.
5. Let GitHub -> Vercel automatic deployment publish the site.
6. Run `npm run verify:live-version` after the deployment.

Manual Vercel CLI deployment is backup only.

If `npm run deploy` fails with an invalid token:

```powershell
vercel logout
vercel login
cd C:\fuman-terminal-sync
npm run deploy
```

Or set a fresh token:

```powershell
$env:VERCEL_TOKEN="YOUR_NEW_TOKEN"
cd C:\fuman-terminal-sync
vercel --prod --token $env:VERCEL_TOKEN
```

Do not deploy or push from `C:\fuman-terminal` unless it has been intentionally cleaned and re-approved.
