# Official Fuman Terminal Source

Use this folder for official edits, commits, pushes, and deploys:

`C:\fuman-terminal-sync`

Do not use old Codex work copies as the source of truth.

Automation publish/sync jobs use a separate disposable repository:

`C:\fuman-terminal-publish-sync`

That publish sync repo may be reset with `git reset --hard origin/main`. Do not edit there.
Run these before deploy:

```
npm run guard:source
npm run verify:version
```
