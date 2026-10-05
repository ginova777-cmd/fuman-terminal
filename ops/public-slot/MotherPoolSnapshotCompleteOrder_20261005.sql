-- Preserve complete=true and latest generation ordering. No View or grants changed.
CREATE INDEX CONCURRENTLY IF NOT EXISTS fugle_daytrade_mp_complete_order_v1
ON public.fugle_daytrade_mother_pool_snapshots_v4_1
(trade_date, snapshot_sequence DESC, generated_at DESC) WHERE complete = true;
