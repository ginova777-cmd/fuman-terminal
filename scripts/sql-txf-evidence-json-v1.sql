begin;
alter table public.fugle_daytrade_futopt_intraday_1m
 add column raw_evidence_json text,
 add column raw_serialization text;
alter table public.fugle_daytrade_futopt_intraday_1m add constraint txf_raw_evidence_json_v1 check (
 (raw_evidence_json is null and raw_serialization is null) or
 (raw_evidence_json is not null and raw_serialization is not null
  and raw_serialization='ecmascript-json-stringify-utf8-v1'
  and jsonb_typeof(raw_evidence_json::jsonb)='object'
  and raw_evidence_json::jsonb=raw_evidence)
);
-- Existing JSONB rows are not reserialized or relabelled with fabricated original bytes.
-- The same bounded RPC returns the extended table row type.
notify pgrst,'reload schema';
commit;
