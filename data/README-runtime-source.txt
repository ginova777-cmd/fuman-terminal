Fuman data source note
======================

This repo data directory is a synced backup, not the primary intraday live source.

Primary runtime data:
- C:\fuman-runtime\data

Online live cache:
- Supabase fuman_realtime_radar_cache

Use repo data only to verify sync/publish backup state. For intraday patrol freshness, check C:\fuman-runtime\data and the latest C:\fuman-runtime\logs patrol log first.
