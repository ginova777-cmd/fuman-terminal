# Freshness Gate Stash Policy

Do not run `git stash pop` blindly in this repository.

Stashes may contain generated `data/*.json` files, unrelated UI edits, or partially applied work from another Codex session. Before restoring any stash:

1. Inspect it first:

   ```powershell
   git stash show --name-status stash@{N}
   git stash show -p stash@{N} -- <path>
   ```

2. Restore only explicitly needed paths:

   ```powershell
   git checkout stash@{N} -- path\to\file
   ```

3. Never restore `data/*.json` from a stash for publishing. Fresh terminal data must come from:

   ```powershell
   npm run freshness:gate
   ```

4. After any stash restore that touches data flow code, run:

   ```powershell
   npm run verify:publish-gate
   npm run verify:data-freshness:live
   ```
