# Root verification authority and retired standalone audit

Updated 2026-09-12 Asia/Taipei.

## Single scheduled authority

The only scheduled controller is `Fuman Terminal Autonomous Root Monitor`, running `run-terminal-master-control.ps1` from `C:\fuman-release-owner\fuman-terminal` with `-RequireProtectedReadback`. The 23:10 checkpoint performs the full-day read-only audit. Cleanup acceptance is delegated to `scripts/verify-daily-retention-maintenance.js`, including the extended cleanup independent readback.

The old standalone Full Unattended Final Audit Windows task is retired and must be absent, even when disabled. Its installer has been deleted. Registry schedule rows and success-code allowances for that task have been removed; its name remains in the retirement deny list. Do not re-create it under another name.

## Recovery registration

The release-owner recovery bootstrap is `scripts/register-terminal-unattended-tasks.ps1`, from the formal source authority. It registers only the canonical Root, removes retired standalone and legacy Ops tasks, verifies S4U/Highest, and runs the retirement guard against live Windows tasks. Administrative execution is required; there is no Interactive/Limited fallback.

`scripts/verify-terminal-power-recovery.js` reads the actual master-control action, post-boot run evidence, task settings and lock state. A present or unreadable retired standalone task blocks power-recovery success. The bootstrap itself is never invoked just to perform read-only verification.

## Retained verification components

`scripts/run-terminal-unattended-final-audit.js`, `scripts/verify-terminal-final-audit-contract.js` and `lib/terminal-final-audit-contract.js` remain required by existing manual/internal orchestration, manifest, recovery and protected-readback contracts. They are not a second scheduled controller. Removing their code would discard active verification checks, so their internal consumers remain intact.

Their artifact `outputs/terminal-final-audit/terminal-unattended-final-audit.json` and runtime mirrors retain their own trade-date/run-id contract. A legacy/internal artifact never substitutes for the current scheduled Root or a cleanup canonical receipt. Lock contention, missing evidence and aborted execution remain failures, not success.

## Drift guard

`node scripts/verify-verifier-retirement.js` checks source wiring during publication. `--require-live` additionally queries Windows tasks; query failures fail closed.

The guard rejects restored retired installers, active registry entries, recovery reinstallation references, old audit/root scheduled actions (including renamed tasks), duplicate master tasks, wrong formal Root paths, and removal of the cleanup/extended independent verifier wiring.

Both the canonical Root and daily cleanup verifier run the live guard before normal or holiday handling. A drift raises `VERIFIER_AUTHORITY_DRIFT` / `verifier_authority_drift`; publication or acceptance stops. No script automatically fabricates a complete receipt to bypass the guard.

Validation includes negative fixtures for restored installer, disabled retired task, renamed old task, duplicate Root, wrong Root action, unreadable inventory and removed extended readback. Live validation must separately prove the actual Windows task inventory.
