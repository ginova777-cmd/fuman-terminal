# Stop preservation contract review

The existing consumer rejects any nonempty proof.prior_error. This candidate retains that rule.
SAFE_STOP_SAVED means the producer's current pending buffers were saved; it is not proof that historical input was complete or free of errors.
TXF_SESSION_OR_DATE_MISMATCH remains a data-quality blocker. groups is an inventory count; dirty_groups and pending_records are the flush counters.
No historical error is erased, ACK forged, or artifact hash check removed.

The corrected failure path saves exit code, raw stdout and parsed failure even if STOP may already have been requested. StopNotRequested is granted only from the existing explicit boolean contract.
Collector launch uses a shell-isolated broker, preserving explicit child environment overrides and rejecting NODE_OPTIONS. The broker hashes its exact specification and executable entry and reports PID/start ticks. The Owner reads these back and retains its existing repeated inventory checks.

Acceptance scope: isolated broker lifetime/environment/PID test and stop-failure evidence branches. Full administrative Owner stop/recovery/task handback remains required before formal release. Existing failure recovery receipts from production are not acceptance of this changed launcher.
