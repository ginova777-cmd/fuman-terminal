# Terminal Unattended Final Audit

The authoritative daily result is:

`outputs/terminal-final-audit/terminal-unattended-final-audit.json`

The runtime mirror is written to:

`C:\fuman-runtime\state\unattended-final-audit.json`

The manifest receipt is also mirrored at:

`C:\fuman-runtime\state\terminal-daily-manifest.json`

The Final Audit runner requires that manifest to carry the same `trade_date` and `daily_run_id`, the `terminal-daily-manifest-v2` contract, and `ok` parity before it can claim success.

## Execution contract

`scripts/run-terminal-unattended-final-audit.js` creates or reuses one `daily_run_id`, acquires the single orchestrator lock, runs the five core verifiers plus read-only power-recovery, daily-OHLCV, source/data-chain, strategy/chip, and API/desktop/mobile/scorecard/source-report surface receipt collection, writes the recovery queue and manifest, releases the lock, and writes one final JSON. It still does not run scanners, backfills, publishers, or repair actions; Canary, RunId Closure, route-88, Watchdog, and Auto Roll Forward are represented by structured read-only verifier receipts, while Control Plane and Recovery Queue are checked through read-only receipts.

Every required item must have a receipt for the same `trade_date` and `daily_run_id`. Missing, stale, fallback, warning-bearing, or not-yet-due evidence keeps the result `NO`.


## Shared lock ownership

The scheduled Autonomous Root Monitor (run-terminal-autonomous-root.ps1) uses the same C:\fuman-runtime\state\terminal-daily-orchestrator.lock for its full preflight/scanner/readback window. It writes the same daily_run_id and a private owner_token into the lock. The child Final Audit invoked by that root runner may acquire a re-entrant lease only when both values match; its release marks the child lease released but retains the parent lock. The parent releases the actual file after its receipt is written. Any unrelated process remains fail-closed with a lock-contention NO artifact.

## Lock contention

If another daily runner already holds the single orchestrator lock, the new invocation writes a complete NO artifact with first_blocker=orchestrator_lock, reason_code=orchestrator_lock_held, and allowed_action=wait_for_active_orchestrator_to_finish_then_retry. Core and module receipts are intentionally absent because this invocation did no work; the contract verifier accepts this explicit contention state, while --require-yes still fails. This is a blocked audit, not a successful run.

If execution aborts after lock acquisition, the runner writes an execution_aborted NO artifact and records the released lock; the verifier accepts only that explicit exception shape.
## Power recovery

`scripts/verify-terminal-power-recovery.js` is read-only. It records the latest boot time, Kernel-Power 41/EventLog 6008 evidence, Task Scheduler registration, proof that the Final Audit task ran after the latest boot, StartWhenAvailable, and the single-lock state. A power recovery receipt is `PASS` only after the task is registered as S4U/Highest, StartWhenAvailable=true, has run after boot, and the lock is safe. If an older registration receipt still shows a historical non-elevated failure, the live scheduled-task readback is authoritative and the receipt declares that explicitly.

The release owner may install the task from the source clone with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-terminal-full-unattended-final-audit-task.ps1
```

Installation is intentionally not performed by the Final Audit runner. The task starts at 07:00, 09:00, 16:00, and 22:30, starts when available after downtime, and ignores overlapping instances.

For a complete post-outage setup, run the unified bootstrap from an elevated PowerShell session:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\fuman-terminal\scripts\register-terminal-unattended-tasks.ps1 -ProjectRoot C:\fuman-terminal -RuntimeRoot C:\fuman-runtime
```

It registers both tasks as `S4U/Highest`, verifies the registered principals, and writes `C:\fuman-runtime\state\power-recovery-task-registration.json`. A non-elevated invocation fails closed with `administrator_elevation_required`; it never falls back to Interactive/Limited.

The bootstrap also disables the legacy Fuman Terminal Autonomous Ops 5m task so it cannot become a second writer of the daily runtime Final Audit.

## Verification

```powershell
node scripts/verify-terminal-final-audit-contract.js
node scripts/verify-terminal-final-audit-contract.js --require-yes
```

The first command validates the artifact contract even when the operational decision is `NO`. The second command is the release gate and must only succeed when the final JSON says `YES`.
## Single daily orchestration contract

The Final Audit runner is the one daily orchestration boundary. It owns the daily_run_id, lock, stage order, active module registry, receipt collection, recovery queue, manifest, and final decision. Every required module is represented in the same date/run namespace; a missing receipt is never interpreted as success. The daily registry records requirement_state (required/optional/disabled/not_required) and today_state (REQUIRED/OPTIONAL/DISABLED/NOT_REQUIRED/NOT_DUE), and rejects missing or duplicate module configuration. Collector source payloads keep their own identity; the collector does not manufacture source trade dates or run ids.

The boundary is fail-closed and does not silently substitute scanners, backfills, publishers, or repair actions. It records the first blocker, reason code, and allowed action. A recovery action must be idempotent, followed by a fresh receipt, and then re-verified before a later audit can become YES. Read-only receipt adapters are exposed by verify:terminal-ui-receipt, verify:terminal-control-plane:receipt, and verify:terminal-recovery-queue:receipt.

