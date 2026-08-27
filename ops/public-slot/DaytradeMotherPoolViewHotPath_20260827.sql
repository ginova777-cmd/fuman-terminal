-- Daytrade Mother Pool hot-path repair.
--
-- The former view aggregates the entire 2 GB intraday table through
-- v_fugle_daytrade_intraday_1m_status before joining the 300-600 row pool.
-- That makes even count(*) time out under live writes. The status cache is
-- written from the same formal Fugle candle chain and is complete for the
-- current pool; join it by symbol instead. This retains DATA_GAP fields and
-- keeps the expensive raw-table verifier as a separate formal-source check.
--
-- This migration preserves the existing view column order. It is intentionally
-- additive/idempotent and fails loudly if an unreviewed view definition is
-- encountered.

create index if not exists fugle_daytrade_intraday_1m_formal_status_hotpath_idx
  on public.fugle_daytrade_intraday_1m (trade_date, symbol, candle_time desc)
  where synthetic is not true
    and volume_strategy_usable is not false
    and (
      source in (
        'fugle_daytrade_writer:websocket_candles',
        'fugle_daytrade_writer:fugle_rest_candle_seed',
        'fugle_daytrade_writer:websocket_candle_0901'
      )
      or (source_channel = 'rest' and candle_origin = 'rest_candle')
    );

do $$
declare
  definition text;
  join_before text := E'LEFT JOIN v_fugle_daytrade_intraday_1m_status s ON s.symbol = p.symbol\n     LEFT JOIN v_fugle_daytrade_intraday_1m_technical_status si ON si.symbol = p.symbol';
  join_after text := E'LEFT JOIN fugle_daytrade_intraday_1m_status_cache s\n       ON s.symbol = p.symbol\n      AND (s.trade_date = (now() AT TIME ZONE ''Asia/Taipei'')::date OR s.trade_date IS NULL)\n     LEFT JOIN fugle_daytrade_intraday_1m_status_cache si\n       ON si.symbol = p.symbol\n      AND (si.trade_date = (now() AT TIME ZONE ''Asia/Taipei'')::date OR si.trade_date IS NULL)';
  formal_before text := E'p.priority_rank <= 40 AND (p.payload ->> ''basePoolEligible''::text) = ''true''::text AND q.symbol IS NOT NULL AND COALESCE(EXTRACT(epoch FROM now() - q.quote_seen_at)::integer, 999999) <= 120 AND COALESCE(d.avg_volume5, d.avg5_volume, 0::numeric) > 0::numeric AS is_formal_entry_eligible';
  formal_after text := E'COALESCE(NULLIF(p.payload ->> ''formal_pool_eligible''::text, ''''::text)::boolean, false) AND q.symbol IS NOT NULL AND COALESCE(EXTRACT(epoch FROM now() - q.quote_seen_at)::integer, 999999) <= 120 AND COALESCE(d.avg_volume5, d.avg5_volume, 0::numeric) > 0::numeric AS is_formal_entry_eligible';
  where_at integer;
begin
  select pg_get_viewdef('public.v_fugle_daytrade_mother_pool'::regclass, true)
    into definition;

  if position(join_before in definition) = 0 then
    raise exception 'mother_pool_hotpath_join_signature_not_found';
  end if;
  if position(formal_before in definition) = 0 then
    raise exception 'mother_pool_legacy_top40_signature_not_found';
  end if;

  definition := replace(definition, join_before, join_after);
  definition := replace(definition, formal_before, formal_after);

  where_at := strpos(definition, E'  WHERE (p.payload ->> ''basePoolEligible''::text) = ''true''::text');
  if where_at = 0 then
    raise exception 'mother_pool_where_signature_not_found';
  end if;
  definition := substr(definition, 1, where_at - 1)
    || E'  WHERE (p.payload ->> ''basePoolEligible''::text) = ''true''::text\n'
    || E'    AND COALESCE(q.price, 0::numeric) >= 50::numeric\n'
    || E'    AND p.priority_rank >= 1\n'
    || E'    AND p.priority_rank <= 1000';

  execute 'create or replace view public.v_fugle_daytrade_mother_pool as ' || definition;
end $$;

comment on view public.v_fugle_daytrade_mother_pool is
  'Dynamic Mother Pool readback: no TOP40 gate; status cache hot path; formal Fugle raw 1m is verified separately.';