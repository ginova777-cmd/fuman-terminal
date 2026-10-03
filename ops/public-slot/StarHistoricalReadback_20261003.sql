begin;
DO $guard$ BEGIN IF md5(pg_get_viewdef('public.v_fugle_daytrade_star_preopen_readback'::regclass,true)) <> '4c8517ebe4e4a583ec1c7f97d3164abe' THEN RAISE EXCEPTION 'STAR_VIEW_DRIFT'; END IF; END $guard$;
create or replace view public.v_fugle_daytrade_star_preopen_readback as
 WITH near_one AS (
 SELECT n.trade_date,n.symbol,n.fut_contract,n.resolved_at,
 n.payload->>'ticker_name' AS stock_name
 FROM public.v_fugle_daytrade_near_one_contract n
 WHERE n.is_near_one IS TRUE
 ), snapshots AS (
         SELECT s.trade_date,
            s.capture_slot,
            s.underlying_symbol,
            s.fut_contract,
            s.contract_month,
            s.expiry_date,
            s.captured_at,
            s.fut_price,
            s.fut_change_pct,
            s.fut_volume,
            s.trial_price,
            s.trial_change_pct,
            s.best_bid,
            s.best_ask,
            s.bid_ask_ratio,
            s.natural_schedule_evidence,
            s.source,
            s.payload, native_open.price AS native_open_price, native_open.event_at AS native_open_event_at
           FROM v_fugle_daytrade_preopen_snapshot_contract s
           LEFT JOIN LATERAL public.fuman_star_native_open_v1(s.payload->'native_open_evidence',s.fut_contract,s.trade_date,s.captured_at) native_open ON true
          WHERE s.natural_schedule_evidence IS TRUE AND s.capture_slot >= '0845'::text AND s.capture_slot <= '0859'::text
        ), snapshot_agg AS (
         SELECT snapshots.trade_date,
            snapshots.underlying_symbol, snapshots.fut_contract,
            count(*)::integer AS preopen_snapshot_count,
            min(snapshots.captured_at) AS first_preopen_seen_at,
            max(snapshots.captured_at) AS last_preopen_seen_at,
            (array_agg(snapshots.trial_price ORDER BY snapshots.captured_at DESC) FILTER (WHERE snapshots.trial_price > 0::numeric))[1] AS trial_price,
            (array_agg(snapshots.trial_change_pct ORDER BY snapshots.captured_at DESC) FILTER (WHERE snapshots.trial_price > 0::numeric))[1] AS trial_rise_percent,
            (array_agg(snapshots.best_bid ORDER BY snapshots.captured_at DESC) FILTER (WHERE snapshots.trial_price > 0::numeric))[1] AS best_bid_price,
            (array_agg(snapshots.best_ask ORDER BY snapshots.captured_at DESC) FILTER (WHERE snapshots.trial_price > 0::numeric))[1] AS best_ask_price,
            (array_agg(snapshots.bid_ask_ratio ORDER BY snapshots.captured_at DESC) FILTER (WHERE snapshots.trial_price > 0::numeric))[1] AS bid_ask_ratio,
            min(snapshots.fut_price) FILTER (WHERE snapshots.fut_price > 0::numeric) AS future_low_price,
            max(snapshots.fut_price) FILTER (WHERE snapshots.fut_price > 0::numeric) AS future_high_price,
            (array_agg(snapshots.native_open_price ORDER BY snapshots.captured_at) FILTER (WHERE snapshots.native_open_price IS NOT NULL))[1] AS future_open_price,
            (array_agg(snapshots.native_open_event_at ORDER BY snapshots.captured_at) FILTER (WHERE snapshots.native_open_price IS NOT NULL))[1] AS future_open_source_event_at,
            (array_agg(snapshots.fut_price ORDER BY snapshots.captured_at DESC) FILTER (WHERE snapshots.fut_price > 0::numeric))[1] AS futopt_last_price,
            (array_agg(snapshots.payload ->> 'websocket_quote_seen_at'::text ORDER BY snapshots.captured_at DESC) FILTER (WHERE snapshots.fut_price > 0::numeric))[1] AS future_last_source_event_at,
            (array_agg(snapshots.fut_change_pct ORDER BY snapshots.captured_at DESC) FILTER (WHERE snapshots.fut_price > 0::numeric))[1] AS futopt_change_percent,
            (array_agg(snapshots.fut_volume ORDER BY snapshots.captured_at DESC) FILTER (WHERE snapshots.fut_price > 0::numeric))[1] AS futopt_total_volume,
            (array_agg(NULLIF(snapshots.payload ->> 'txf_change_percent'::text, ''::text)::numeric ORDER BY snapshots.captured_at DESC) FILTER (WHERE snapshots.fut_price > 0::numeric))[1] AS txf_change_percent,
            (array_agg(NULLIF(snapshots.payload ->> 'relative_to_txf_percent'::text, ''::text)::numeric ORDER BY snapshots.captured_at DESC) FILTER (WHERE snapshots.fut_price > 0::numeric))[1] AS relative_to_txf_percent,
            (array_agg(snapshots.payload ORDER BY snapshots.captured_at DESC))[1] AS latest_payload
           FROM snapshots
          GROUP BY snapshots.trade_date, snapshots.underlying_symbol, snapshots.fut_contract
        ), base AS (
         SELECT n.trade_date,
            n.symbol,
            COALESCE(n.stock_name, n.symbol) AS stock_name,
            n.fut_contract AS future_symbol,
            true AS near_one_present,
            a.futopt_last_price,
            a.futopt_change_percent,
            a.relative_to_txf_percent,
            a.futopt_total_volume,
            a.future_open_price,
            a.future_high_price,
            a.future_low_price,
            a.trial_price,
            NULLIF(a.latest_payload ->> 'reference_price'::text, ''::text)::numeric AS reference_price,
            a.trial_rise_percent,
            a.best_bid_price,
            NULLIF(a.latest_payload ->> 'bid_volume'::text, ''::text)::numeric AS bid_volume,
            NULLIF(a.latest_payload ->> 'ask_volume'::text, ''::text)::numeric AS ask_volume,
            a.bid_ask_ratio,
            COALESCE((a.latest_payload ->> 'is_limit_up_bid'::text)::boolean, false) AS is_limit_up_bid,
            COALESCE(a.preopen_snapshot_count, 0) AS preopen_snapshot_count,
            a.first_preopen_seen_at,
            a.last_preopen_seen_at,
            GREATEST(n.resolved_at, COALESCE(a.last_preopen_seen_at, n.resolved_at)) AS updated_at
           FROM near_one n
             LEFT JOIN snapshot_agg a ON a.trade_date = n.trade_date AND a.underlying_symbol = n.symbol AND a.fut_contract = n.fut_contract
        ), rules AS (
         SELECT b.trade_date,
            b.symbol,
            b.stock_name,
            b.future_symbol,
            b.near_one_present,
            b.futopt_last_price,
            b.futopt_change_percent,
            b.relative_to_txf_percent,
            b.futopt_total_volume,
            b.future_open_price,
            b.future_high_price,
            b.future_low_price,
            b.trial_price,
            b.reference_price,
            b.trial_rise_percent,
            b.best_bid_price,
            b.bid_volume,
            b.ask_volume,
            b.bid_ask_ratio,
            b.is_limit_up_bid,
            b.preopen_snapshot_count,
            b.first_preopen_seen_at,
            b.last_preopen_seen_at,
            b.updated_at,
            b.future_symbol IS NOT NULL AND b.future_symbol <> ''::text AND b.future_symbol !~~ 'TXF%'::text AND b.futopt_last_price > 0::numeric AND b.futopt_change_percent >= 2::numeric AND b.relative_to_txf_percent >= 1::numeric AND b.futopt_total_volume >= 50::numeric AS future_ok,
            b.trial_price > 0::numeric AND b.reference_price > 0::numeric AND b.best_bid_price >= b.trial_price AND b.preopen_snapshot_count > 0 AS preopen_ok,
                CASE
                    WHEN b.future_open_price > 0::numeric AND b.futopt_last_price > 0::numeric AND (abs(b.futopt_last_price - b.future_open_price) / b.future_open_price * 100::numeric) <= 1::numeric AND b.futopt_last_price >= (b.future_open_price * 0.995) AND b.futopt_change_percent >= 2::numeric AND b.relative_to_txf_percent >= 1::numeric AND b.futopt_total_volume >= 50::numeric THEN '開盤回測守住'::text
                    ELSE NULL::text
                END AS future_pattern
           FROM base b
        )
 SELECT r.trade_date,
    r.symbol,
    r.stock_name,
    r.future_symbol,
    r.near_one_present,
    r.futopt_last_price,
    r.futopt_change_percent,
    r.relative_to_txf_percent,
    r.futopt_total_volume,
    r.future_open_price,
    r.future_high_price,
    r.future_low_price,
    r.trial_price,
    r.reference_price,
    r.trial_rise_percent,
    r.best_bid_price,
    r.bid_volume,
    r.ask_volume,
    r.bid_ask_ratio,
    r.is_limit_up_bid,
    r.preopen_snapshot_count,
    r.first_preopen_seen_at,
    r.last_preopen_seen_at,
    r.updated_at,
    r.future_ok,
    r.preopen_ok,
    r.future_pattern,
    r.future_symbol IS NULL OR r.future_symbol = ''::text OR r.futopt_last_price <= 0::numeric AS empty_shell_row,
        CASE
            WHEN r.future_open_price > 0::numeric AND r.futopt_last_price > 0::numeric AND r.futopt_change_percent IS NOT NULL AND r.relative_to_txf_percent IS NOT NULL AND r.futopt_total_volume IS NOT NULL THEN 'ready'::text
            ELSE 'DATA_GAP'::text
        END AS source_status,
    r.future_ok AS star_precheck_ok,
    COALESCE(r.future_pattern = '開盤回測守住'::text, false) AS star_type1_ok,
    r.future_ok AND r.preopen_ok AS star_blind_buy_ok,
    COALESCE(r.future_pattern = '開盤回測守住'::text, false) AND r.preopen_ok AS star_final_ok,
        CASE
            WHEN r.future_symbol IS NULL OR r.future_symbol = ''::text OR r.future_symbol ~~ 'TXF%'::text THEN 'NO_CONTRACT'::text
            WHEN r.futopt_last_price <= 0::numeric THEN 'FUTURE_PRICE_MISSING'::text
            WHEN r.preopen_snapshot_count = 0 THEN 'NATURAL_FUTURE_PREOPEN_DATA_GAP'::text
            WHEN r.future_open_price IS NULL OR r.futopt_last_price IS NULL THEN 'NATURAL_FUTURE_PREOPEN_DATA_GAP'::text
            WHEN r.futopt_change_percent IS NULL OR r.relative_to_txf_percent IS NULL OR r.futopt_total_volume IS NULL THEN 'NATURAL_FUTURE_PREOPEN_DATA_GAP'::text
            WHEN r.trial_price IS NULL OR r.trial_price <= 0::numeric THEN 'TRIAL_PRICE_MISSING'::text
            WHEN r.reference_price IS NULL OR r.reference_price <= 0::numeric THEN 'REFERENCE_PRICE_MISSING'::text
            WHEN r.best_bid_price IS NULL OR r.best_bid_price <= 0::numeric THEN 'BEST_BID_MISSING'::text
            ELSE NULL::text
        END AS data_gap_reason,
        CASE
            WHEN r.future_pattern = '開盤回測守住'::text AND r.preopen_ok THEN 'STAR'::text
            WHEN r.preopen_snapshot_count = 0 OR r.future_open_price IS NULL OR r.futopt_last_price IS NULL THEN 'DATA_GAP｜期貨自然時槽缺資料'::text
            WHEN r.trial_price IS NULL OR r.trial_price <= 0::numeric THEN 'DATA_GAP｜試撮價缺失'::text
            WHEN r.reference_price IS NULL OR r.reference_price <= 0::numeric THEN 'DATA_GAP｜參考價缺失'::text
            WHEN r.best_bid_price IS NULL OR r.best_bid_price <= 0::numeric THEN 'DATA_GAP｜最佳委買缺失'::text
            ELSE 'NO_MATCH｜條件未通過'::text
        END AS display_label,
    r.symbol AS underlying_symbol,
    r.stock_name AS name,
    r.future_open_price AS future_0845_open_price,
    r.future_high_price AS future_preopen_high_price,
    r.future_low_price AS future_preopen_low_price,
    r.futopt_last_price AS future_0859_last_price,
    r.futopt_change_percent AS future_change_percent,
    r.futopt_total_volume AS future_total_volume,
        CASE
            WHEN r.future_open_price > 0::numeric AND r.futopt_last_price > 0::numeric THEN abs(r.futopt_last_price - r.future_open_price) / r.future_open_price * 100::numeric
            ELSE NULL::numeric
        END AS future_open_near_percent,
    COALESCE(r.future_pattern = '開盤回測守住'::text, false) AS future_open_retest_ok,
        CASE
            WHEN r.future_pattern = '開盤回測守住'::text THEN '期貨0845開盤後，0859前回到開盤價附近並守住'::text
            ELSE 'DATA_GAP_OR_FUTURE_OPEN_RETEST_NOT_MET'::text
        END AS future_open_retest_reason,
    COALESCE(r.reference_price > 0::numeric, false) AS reference_price_ok,
    COALESCE(r.trial_price > 0::numeric, false) AS trial_price_ok,
        CASE
            WHEN r.reference_price > 0::numeric AND r.trial_price > 0::numeric THEN 'ok'::text
            ELSE 'DATA_GAP'::text
        END AS preopen_evidence_status,
        CASE
            WHEN r.reference_price IS NULL OR r.reference_price <= 0::numeric THEN 'REFERENCE_PRICE_MISSING'::text
            WHEN r.trial_price IS NULL OR r.trial_price <= 0::numeric THEN 'TRIAL_PRICE_MISSING'::text
            ELSE NULL::text
        END AS preopen_data_gap_reason,
    si.identity_future_open_source_event_at AS future_0845_source_event_at,
    si.identity_future_last_source_event_at AS future_0859_source_event_at,
    si.identity_latest_payload ->> 'trial_event_at'::text AS trial_event_at,
    si.identity_latest_payload ->> 'run_id'::text AS run_id,
    si.identity_latest_payload ->> 'generation_id'::text AS generation_id,
        CASE
            WHEN r.future_symbol IS NULL OR r.future_symbol = ''::text OR r.future_symbol ~~ 'TXF%'::text OR r.futopt_last_price IS NULL OR r.futopt_last_price <= 0::numeric OR r.preopen_snapshot_count = 0 OR r.future_open_price IS NULL OR r.futopt_change_percent IS NULL OR r.relative_to_txf_percent IS NULL OR r.futopt_total_volume IS NULL OR r.trial_price IS NULL OR r.trial_price <= 0::numeric OR r.reference_price IS NULL OR r.reference_price <= 0::numeric OR r.best_bid_price IS NULL OR r.best_bid_price <= 0::numeric THEN 'DATA_GAP'::text
            WHEN COALESCE(r.future_pattern = '開盤回測守住'::text, false) AND r.preopen_ok THEN 'PASS'::text
            ELSE 'NO_MATCH'::text
        END AS strategy_result,
        CASE
            WHEN r.trial_price > 0::numeric AND r.reference_price > 0::numeric AND r.best_bid_price < r.trial_price THEN 'BEST_BID_BELOW_TRIAL'::text
            WHEN r.futopt_change_percent < 2::numeric THEN 'FUTURE_CHANGE_BELOW_2_PERCENT'::text
            WHEN r.relative_to_txf_percent < 1::numeric THEN 'RELATIVE_TO_TXF_BELOW_1_PERCENT'::text
            WHEN r.futopt_total_volume < 50::numeric THEN 'FUTURE_VOLUME_BELOW_50'::text
            WHEN r.future_pattern IS NULL THEN 'FUTURE_OPEN_RETEST_NOT_MET'::text
            ELSE NULL::text
        END AS strategy_no_match_reason
   FROM rules r
     LEFT JOIN ( SELECT snapshot_agg.trade_date,
            snapshot_agg.underlying_symbol, snapshot_agg.fut_contract,
            snapshot_agg.future_open_source_event_at AS identity_future_open_source_event_at,
            snapshot_agg.future_last_source_event_at AS identity_future_last_source_event_at,
            snapshot_agg.latest_payload AS identity_latest_payload
           FROM snapshot_agg) si ON si.trade_date = r.trade_date AND si.underlying_symbol = r.symbol AND si.fut_contract = r.future_symbol;
commit;
