# API-Only Publish Governance

Fuman Terminal no longer uses the old daily data freshness verifier.

Removed legacy authority:

```text
npm run verify:data-freshness
npm run verify:data-freshness:live
scripts/verify-data-freshness.js
run-verify-data-freshness.ps1
data/live-freshness-ok.json as a gate
/data/*.json as freshness authority
```

Official data authority:

```text
scanner / writer
-> Supabase complete run or snapshot
-> no-store API
-> frontend polling by runId / snapshotId / bootHash
```

Official daily governance:

```powershell
npm run verify:publish-gate
```

Targeted data verifiers remain valid:

```powershell
npm run verify:warrant-freshness:live
npm run verify:cb-detect-live
npm run verify:live-version
```

Rules:

```text
Do not restore scripts/verify-data-freshness.js.
Do not add verify:data-freshness back to package.json.
Do not make run-cache-sync.ps1, run-local-freshness-repair.ps1, run-flow.ps1, or run-live-freshness-gate.ps1 call verify:data-freshness.
Do not use live-freshness-ok.json as a publish gate.
Do not use Vercel deploy, version bump, service worker cache bump, or browser refresh as data freshness proof.
```

If an old script complains that `verify-data-freshness.js` is missing, fix that old script by removing the dependency. Do not recreate the verifier.

