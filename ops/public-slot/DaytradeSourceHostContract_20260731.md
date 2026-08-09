# Daytrade Source Host Contract

There are exactly two roles:

- Writer/source host: the approved qutie daytrade machine. It owns the Fugle WebSocket trades/aggregates/candles collector, service-role writer, lease, and all writes to dedicated daytrade tables.
- Reader/viewer host: the ginov terminal, PS1 readback computer, strategy viewer, and UI hosts. They are read-only. They must not start a Fugle collector, use service_role, write Supabase, change gate values, or upgrade a gate from local/cache data.

The writer sets FUMAN_DAYTRADE_SOURCE_HOST_ID and claims the Supabase lease before each writer tick. If the lease is held by another host, the writer fails closed and preserves previous good. A read-only host may query the lease view and source contracts but cannot claim the lease.

Required source payload fields:

- source_host_id
- source_host_role=writer
- writer_instance_id
- writer_lease_status
- writer_heartbeat_at
- writer_lease_expires_at
- source_authority=dedicated_daytrade_source_host
- reader_policy=supabase_read_only_no_writer_no_fugle_fallback

Apply DaytradeSourceWriterLease_20260731.sql on Supabase before enabling the source writer. On the approved qutie source host, run `pwsh -File C:\fuman-terminal\ops\public-slot\Approve-DaytradeSourceHost.ps1 -ConfirmWriterHost` once. The writer wrapper refuses `-Apply` without this host approval. Non-Apply/read-only mode never starts the collector. Install and run the writer and WebSocket task only on the approved source host. On every other computer run only read-only verifiers.
