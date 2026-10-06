-- DRAFT: deploy only through release authority after integration acceptance.
-- Evidence only; no changes to quote/candle tables or trading qualification.
begin;
create table if not exists public.mother_shared_water_publications (
 verification_run_id text primary key check(length(verification_run_id) between 1 and 200),
 trade_date date not null,
 generation text not null,
 checked_at timestamptz not null,
 valid_until timestamptz not null,
 receipt_text text not null check(octet_length(receipt_text)<=2097152),
 receipt_sha256 text not null,
 archive_bytes bytea check(octet_length(archive_bytes)<=3145728),
 archive_sha256 text,
 archive_raw_bytes integer check(archive_raw_bytes between 1 and 16777216),
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists mother_shared_water_publications_date_idx
 on public.mother_shared_water_publications(trade_date,generation,checked_at desc);
create table if not exists public.mother_shared_water_evidence (
 verification_run_id text not null references public.mother_shared_water_publications(verification_run_id) on delete cascade,
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 bytes bytea not null check(octet_length(bytes)<=4194304),
 primary key(verification_run_id,sha256)
);
alter table public.mother_shared_water_publications enable row level security;
alter table public.mother_shared_water_evidence enable row level security;
revoke all on public.mother_shared_water_publications,public.mother_shared_water_evidence from public,anon,authenticated;
grant select,insert,delete on public.mother_shared_water_publications,public.mother_shared_water_evidence to service_role;

create or replace function public.publish_mother_shared_water_evidence(p_receipt_text text,p_blobs jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r jsonb; item jsonb; raw bytea; receipt_hash text; previous_hash text; total_bytes bigint:=0; hashes text[]:='{}'; field text; row_item jsonb;
begin
 if p_receipt_text is null or octet_length(p_receipt_text)>2097152 or p_blobs is null or jsonb_typeof(p_blobs)<>'array' or jsonb_array_length(p_blobs)>8000 then
  raise exception 'INVALID_PUBLICATION_SIZE'; end if;
 r:=p_receipt_text::jsonb;
 if r->>'contract' is distinct from 'mother-pool-shared-water-acceptance-v1'
 or r->>'scope' is distinct from 'full_priority_pool' or r->>'verification_run_id' is null
 or r->>'generation' is null or jsonb_typeof(r->'rows') is distinct from 'array' then raise exception 'INVALID_PUBLICATION_CONTRACT'; end if;
 receipt_hash:=encode(sha256(convert_to(p_receipt_text,'UTF8')),'hex');
 -- Every blob is validated before the publication becomes visible. A timeout
 -- must be followed by exact run/hash readback, never blind replacement.
 for item in select value from jsonb_array_elements(p_blobs) loop
  if item->>'sha256' is null or item->>'base64' is null then raise exception 'BLOB_FIELDS_MISSING'; end if;
  raw:=decode(item->>'base64','base64'); total_bytes:=total_bytes+octet_length(raw);
  if octet_length(raw)>4194304 or total_bytes>8388608 or encode(sha256(raw),'hex')<>item->>'sha256' then raise exception 'BLOB_HASH_OR_SIZE_INVALID'; end if;
  if item->>'sha256'=any(hashes) then raise exception 'DUPLICATE_BLOB'; end if;
  hashes:=array_append(hashes,item->>'sha256');
 end loop;
 if jsonb_typeof(r->'evidence_hashes') is distinct from 'array' or
    (select jsonb_agg(h order by h) from unnest(hashes) h) is distinct from r->'evidence_hashes' then
  raise exception 'EVIDENCE_MANIFEST_MISMATCH'; end if;
 for row_item in select value from jsonb_array_elements(r->'rows') loop
  if row_item->>'source_status' in ('FRESH','NO_NEW_TRADE') then
   foreach field in array array['payload_sha256','transport_sha256','publication_sha256'] loop
    if row_item->>field is null or not ((row_item->>field)=any(hashes)) then raise exception 'REFERENCED_EVIDENCE_MISSING'; end if;
   end loop;
  end if;
 end loop;
 insert into public.mother_shared_water_publications(verification_run_id,trade_date,generation,checked_at,valid_until,receipt_text,receipt_sha256)
 values(r->>'verification_run_id',(r->>'trade_date')::date,r->>'generation',(r->>'checked_at')::timestamptz,(r->>'valid_until')::timestamptz,p_receipt_text,receipt_hash)
 on conflict(verification_run_id) do nothing;
 select receipt_sha256 into previous_hash from public.mother_shared_water_publications where verification_run_id=r->>'verification_run_id';
 if previous_hash<>receipt_hash then raise exception 'IMMUTABLE_RUN_CONFLICT'; end if;
 for item in select value from jsonb_array_elements(p_blobs) loop
  insert into public.mother_shared_water_evidence values(r->>'verification_run_id',item->>'sha256',decode(item->>'base64','base64')) on conflict do nothing;
 end loop;
 return jsonb_build_object('verification_run_id',r->>'verification_run_id','receipt_sha256',receipt_hash,'evidence_count',cardinality(hashes));
end $$;
revoke all on function public.publish_mother_shared_water_evidence(text,jsonb) from public,anon,authenticated;
grant execute on function public.publish_mother_shared_water_evidence(text,jsonb) to service_role;

create or replace function public.get_mother_shared_water_receipt(p_verification_run_id text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare item public.mother_shared_water_publications;
begin
 if p_verification_run_id is null or length(p_verification_run_id)>200 then raise exception 'INVALID_RUN'; end if;
 select * into item from public.mother_shared_water_publications where verification_run_id=p_verification_run_id;
 if not found then raise exception 'RUN_NOT_FOUND' using errcode='P0002'; end if;
 return jsonb_build_object('contract','mother-shared-water-readback-v1','verification_run_id',item.verification_run_id,'receipt_utf8',item.receipt_text,'receipt_sha256',item.receipt_sha256,'archive_sha256',item.archive_sha256,'archive_bytes',octet_length(item.archive_bytes),'archive_raw_bytes',item.archive_raw_bytes);
end $$;
revoke all on function public.get_mother_shared_water_receipt(text) from public;
grant execute on function public.get_mother_shared_water_receipt(text) to anon,authenticated,service_role;

create or replace function public.get_mother_shared_water_evidence_chunk(p_verification_run_id text,p_sha256 text,p_offset integer default 0,p_length integer default 131072)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare raw bytea; encoded text; total integer;
begin
 if p_verification_run_id is null or length(p_verification_run_id)>200 or p_sha256 is null or p_sha256!~'^[0-9a-f]{64}$' or p_offset is null or p_offset<0 or p_length is null or p_length<1 or p_length>131072 then raise exception 'INVALID_RANGE'; end if;
 select bytes into raw from public.mother_shared_water_evidence where verification_run_id=p_verification_run_id and sha256=p_sha256;
 if not found then raise exception 'EVIDENCE_NOT_FOUND' using errcode='P0002'; end if;
 encoded:=replace(encode(raw,'base64'),E'\n',''); total:=length(encoded);
 if p_offset>total then raise exception 'OFFSET_OUT_OF_RANGE'; end if;
 return jsonb_build_object('contract','mother-shared-water-evidence-chunk-v1','verification_run_id',p_verification_run_id,'sha256',p_sha256,'byte_length',octet_length(raw),'total_chars',total,'offset',p_offset,'base64_chunk',substring(encoded from p_offset+1 for p_length),'next_offset',case when p_offset+p_length<total then p_offset+p_length else null end);
end $$;
revoke all on function public.get_mother_shared_water_evidence_chunk(text,text,integer,integer) from public;
grant execute on function public.get_mother_shared_water_evidence_chunk(text,text,integer,integer) to anon,authenticated,service_role;
create or replace function public.get_mother_shared_water_evidence_batch(p_verification_run_id text,p_requests jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare item jsonb; chunks jsonb:='[]'::jsonb; seen text[]:='{}';
begin
 if jsonb_typeof(p_requests) is distinct from 'array' or jsonb_array_length(p_requests)<1 or jsonb_array_length(p_requests)>16 then raise exception 'BATCH_LIMIT'; end if;
 for item in select value from jsonb_array_elements(p_requests) loop
  if item->>'sha256'=any(seen) then raise exception 'DUPLICATE_BATCH_HASH'; end if;
  seen:=array_append(seen,item->>'sha256');
  chunks:=chunks||jsonb_build_array(public.get_mother_shared_water_evidence_chunk(p_verification_run_id,item->>'sha256',(item->>'offset')::integer,(item->>'length')::integer));
 end loop;
 return jsonb_build_object('contract','mother-shared-water-evidence-batch-v1','verification_run_id',p_verification_run_id,'chunks',chunks);
end $$;
revoke all on function public.get_mother_shared_water_evidence_batch(text,jsonb) from public;
grant execute on function public.get_mother_shared_water_evidence_batch(text,jsonb) to anon,authenticated,service_role;
-- Immutable run + SHA keyset pagination. Bound both rows and serialized bytes;
-- consumers check every returned hash against their already pinned manifest.
create or replace function public.get_mother_shared_water_evidence_page(p_verification_run_id text,p_after_sha256 text default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare item record; chunk jsonb; chunks jsonb:='[]'::jsonb; used_bytes integer:=0; chunk_bytes integer; last_hash text; more boolean;
begin
 if p_verification_run_id is null or length(p_verification_run_id)>200 or (p_after_sha256 is not null and p_after_sha256!~'^[0-9a-f]{64}$') then raise exception 'INVALID_PAGE'; end if;
 if not exists(select 1 from public.mother_shared_water_publications where verification_run_id=p_verification_run_id) then raise exception 'RUN_NOT_FOUND' using errcode='P0002'; end if;
 if p_after_sha256 is not null and not exists(select 1 from public.mother_shared_water_evidence where verification_run_id=p_verification_run_id and sha256=p_after_sha256) then raise exception 'CURSOR_NOT_FOUND' using errcode='P0002'; end if;
 for item in select sha256 from public.mother_shared_water_evidence where verification_run_id=p_verification_run_id and (p_after_sha256 is null or sha256>p_after_sha256) order by sha256 limit 256 loop
  chunk:=public.get_mother_shared_water_evidence_chunk(p_verification_run_id,item.sha256,0,131072);
  chunk_bytes:=octet_length(chunk::text)+2;
  exit when used_bytes+chunk_bytes>1048576;
  chunks:=chunks||jsonb_build_array(chunk);used_bytes:=used_bytes+chunk_bytes;last_hash:=item.sha256;
 end loop;
 select exists(select 1 from public.mother_shared_water_evidence where verification_run_id=p_verification_run_id and sha256>coalesce(last_hash,p_after_sha256,'')) into more;
 return jsonb_build_object('contract','mother-shared-water-evidence-page-v1','verification_run_id',p_verification_run_id,'after_sha256',p_after_sha256,'next_after_sha256',case when more then last_hash else null end,'complete',not more,'chunks',chunks);
end $$;
revoke all on function public.get_mother_shared_water_evidence_page(text,text) from public;
grant execute on function public.get_mother_shared_water_evidence_page(text,text) to anon,authenticated,service_role;
create or replace function public.publish_mother_shared_water_archive(p_receipt_text text,p_archive_base64 text,p_archive_sha256 text,p_archive_raw_bytes integer)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare r jsonb; raw bytea; receipt_hash text; saved public.mother_shared_water_publications;
begin
 if p_receipt_text is null or octet_length(p_receipt_text)>2097152 or p_archive_base64 is null or length(p_archive_base64)>4194304 or p_archive_sha256 is null or p_archive_sha256!~'^[0-9a-f]{64}$' or p_archive_raw_bytes is null or p_archive_raw_bytes<1 or p_archive_raw_bytes>16777216 then raise exception 'INVALID_ARCHIVE_SIZE'; end if;
 r:=p_receipt_text::jsonb;raw:=decode(p_archive_base64,'base64');
 if r->>'contract' is distinct from 'mother-pool-shared-water-acceptance-v1' or r->>'scope' is distinct from 'full_priority_pool' or jsonb_typeof(r->'evidence_hashes') is distinct from 'array' or octet_length(raw)>3145728 or encode(sha256(raw),'hex')<>p_archive_sha256 then raise exception 'INVALID_ARCHIVE_CONTRACT_OR_HASH'; end if;
 receipt_hash:=encode(sha256(convert_to(p_receipt_text,'UTF8')),'hex');
 insert into public.mother_shared_water_publications(verification_run_id,trade_date,generation,checked_at,valid_until,receipt_text,receipt_sha256,archive_bytes,archive_sha256,archive_raw_bytes)
 values(r->>'verification_run_id',(r->>'trade_date')::date,r->>'generation',(r->>'checked_at')::timestamptz,(r->>'valid_until')::timestamptz,p_receipt_text,receipt_hash,raw,p_archive_sha256,p_archive_raw_bytes) on conflict(verification_run_id) do nothing;
 select * into saved from public.mother_shared_water_publications where verification_run_id=r->>'verification_run_id';
 if saved.receipt_sha256<>receipt_hash or saved.archive_sha256 is distinct from p_archive_sha256 or saved.archive_raw_bytes is distinct from p_archive_raw_bytes then raise exception 'IMMUTABLE_ARCHIVE_CONFLICT'; end if;
 return jsonb_build_object('verification_run_id',saved.verification_run_id,'receipt_sha256',receipt_hash,'archive_sha256',p_archive_sha256);
end $$;
revoke all on function public.publish_mother_shared_water_archive(text,text,text,integer) from public,anon,authenticated;
grant execute on function public.publish_mother_shared_water_archive(text,text,text,integer) to service_role;

create or replace function public.get_mother_shared_water_archive_chunk(p_verification_run_id text,p_offset integer default 0,p_length integer default 131072)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare item public.mother_shared_water_publications; encoded text; total integer;
begin
 if p_verification_run_id is null or length(p_verification_run_id)>200 or p_offset is null or p_offset<0 or p_length is null or p_length<1 or p_length>131072 then raise exception 'INVALID_ARCHIVE_RANGE'; end if;
 select * into item from public.mother_shared_water_publications where verification_run_id=p_verification_run_id;
 if not found or item.archive_bytes is null then raise exception 'ARCHIVE_NOT_FOUND' using errcode='P0002'; end if;
 encoded:=replace(encode(item.archive_bytes,'base64'),E'\n','');total:=length(encoded);
 if p_offset>total then raise exception 'ARCHIVE_OFFSET_OUT_OF_RANGE'; end if;
 return jsonb_build_object('contract','mother-shared-water-archive-chunk-v1','verification_run_id',p_verification_run_id,'archive_sha256',item.archive_sha256,'byte_length',octet_length(item.archive_bytes),'total_chars',total,'offset',p_offset,'base64_chunk',substring(encoded from p_offset+1 for p_length),'next_offset',case when p_offset+p_length<total then p_offset+p_length else null end);
end $$;
revoke all on function public.get_mother_shared_water_archive_chunk(text,integer,integer) from public;
grant execute on function public.get_mother_shared_water_archive_chunk(text,integer,integer) to anon,authenticated,service_role;
-- Exact externally pinned scope; never discover another generation as fallback.
create index if not exists mother_shared_water_scope_lookup_idx
 on public.mother_shared_water_publications(trade_date,generation,
 ((receipt_text::jsonb)->>'writer_run_id'),
 ((receipt_text::jsonb)->>'requested_symbols_sha256'),checked_at desc,verification_run_id);
create or replace function public.find_mother_shared_water_receipt(p_expected jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare field text; item public.mother_shared_water_publications;
begin
 if p_expected is null or jsonb_typeof(p_expected)<>'object' or octet_length(p_expected::text)>8192 then raise exception 'INVALID_EXPECTED_IDENTITY'; end if;
 foreach field in array array['trade_date','canonical_run_id','mother_pool_run_id','writer_run_id','generation','snapshot_sequence','requested_symbols_sha256','snapshot_symbols_sha256','snapshot_bytes_sha256','contract_version','scope_definition_version','producer_version'] loop
  if p_expected->>field is null or length(p_expected->>field)=0 then raise exception 'EXPECTED_IDENTITY_FIELD_MISSING:%',field; end if;
 end loop;
 select p.* into item from public.mother_shared_water_publications p
 where p.trade_date=(p_expected->>'trade_date')::date and p.generation=p_expected->>'generation'
 and p.receipt_text::jsonb->>'writer_run_id'=p_expected->>'writer_run_id'
 and p.receipt_text::jsonb->>'requested_symbols_sha256'=p_expected->>'requested_symbols_sha256'
 and not exists(select 1 from unnest(array['canonical_run_id','mother_pool_run_id','snapshot_sequence','snapshot_symbols_sha256','snapshot_bytes_sha256','contract_version','scope_definition_version','producer_version']) f
   where p.receipt_text::jsonb->>f is distinct from p_expected->>f)
 order by p.checked_at desc,p.verification_run_id limit 1;
 if not found then raise exception 'SAME_SCOPE_RECEIPT_NOT_FOUND' using errcode='P0002'; end if;
 -- Return the newest exact-scope publication even if blocked/expired. Never
 -- search backwards for a passing receipt that hides a newer failure.
 return jsonb_build_object('contract','mother-shared-water-pointer-v1','verification_run_id',item.verification_run_id,'receipt_sha256',item.receipt_sha256,'checked_at',item.checked_at,'valid_until',item.valid_until,'evidence_current',item.checked_at<=statement_timestamp() and statement_timestamp()<item.valid_until);
end $$;
revoke all on function public.find_mother_shared_water_receipt(jsonb) from public;
grant execute on function public.find_mother_shared_water_receipt(jsonb) to anon,authenticated,service_role;
-- Logical payload budget, not PostgreSQL physical disk accounting. Keep
-- existing evidence intact; exceeding the budget blocks only new inserts.
create table if not exists public.mother_shared_water_storage_budget (
 singleton boolean primary key default true check(singleton),
 used_bytes bigint not null default 0 check(used_bytes>=0),
 max_bytes bigint not null default 536870912 check(max_bytes>0)
);
insert into public.mother_shared_water_storage_budget(singleton) values(true) on conflict do nothing;
revoke all on public.mother_shared_water_storage_budget from public,anon,authenticated,service_role;
alter table public.mother_shared_water_storage_budget enable row level security;
create or replace function public.account_mother_shared_water_storage()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare amount bigint;
begin
 if TG_TABLE_NAME='mother_shared_water_publications' then
  if TG_OP='INSERT' then amount:=octet_length(NEW.receipt_text)+coalesce(octet_length(NEW.archive_bytes),0);
  else amount:=-(octet_length(OLD.receipt_text)+coalesce(octet_length(OLD.archive_bytes),0)); end if;
 else
  if TG_OP='INSERT' then amount:=octet_length(NEW.bytes);else amount:=-octet_length(OLD.bytes);end if;
 end if;
 update public.mother_shared_water_storage_budget set used_bytes=used_bytes+amount
 where singleton=true and used_bytes+amount between 0 and max_bytes;
 if not found then raise exception 'SHARED_WATER_STORAGE_BUDGET_EXCEEDED';end if;
 return null;
end $$;
revoke all on function public.account_mother_shared_water_storage() from public,anon,authenticated,service_role;
create trigger mother_shared_water_publication_budget after insert or delete on public.mother_shared_water_publications
 for each row execute function public.account_mother_shared_water_storage();
create trigger mother_shared_water_evidence_budget after insert or delete on public.mother_shared_water_evidence
 for each row execute function public.account_mother_shared_water_storage();
-- Only retire an expired DB copy after the Writer has independently reopened
-- and verified its durable local archive. This does not delete local evidence.
create or replace function public.retire_mother_shared_water_archived(p_archived jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare item jsonb; removed text[]:='{}'; skipped text[]:='{}'; removed_id text;
begin
 if p_archived is null or jsonb_typeof(p_archived)<>'array' or jsonb_array_length(p_archived)>16 then raise exception 'ARCHIVE_RETIRE_BATCH_INVALID';end if;
 for item in select value from jsonb_array_elements(p_archived) loop
  if item->>'verification_run_id' is null or length(item->>'verification_run_id') not between 1 and 200
   or coalesce(item->>'archive_sha256','')!~'^[0-9a-f]{64}$'
   or coalesce(item->>'receipt_sha256','')!~'^[0-9a-f]{64}$' then raise exception 'ARCHIVE_RETIRE_IDENTITY_INVALID';end if;
  removed_id:=null;
  delete from public.mother_shared_water_publications p
   where p.verification_run_id=item->>'verification_run_id'
    and p.archive_sha256=item->>'archive_sha256' and p.receipt_sha256=item->>'receipt_sha256'
    and p.valid_until<clock_timestamp()-interval '1 hour'
    and p.checked_at<clock_timestamp()-interval '1 hour'
   returning p.verification_run_id into removed_id;
  if removed_id is null then skipped:=array_append(skipped,item->>'verification_run_id');
  else removed:=array_append(removed,removed_id);end if;
 end loop;
 return jsonb_build_object('contract','mother-shared-water-retirement-v1','removed',removed,'skipped',skipped,'local_evidence_deleted',false);
end $$;
revoke all on function public.retire_mother_shared_water_archived(jsonb) from public,anon,authenticated;
grant execute on function public.retire_mother_shared_water_archived(jsonb) to service_role;
commit;
