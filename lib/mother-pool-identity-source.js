'use strict';
const {hash,identityFields}=require('./mother-pool-module-write-set');
function check({identity,calendar,lease,asOf}){
 const failures=[],now=Date.parse(asOf),date=identity.trade_date;
 const need=(ok,code)=>{if(!ok)failures.push(code);};
 need(identityFields.every(k=>identity[k]!==undefined&&identity[k]!==null&&identity[k]!==''),'IDENTITY_MISSING');
 need(Number.isInteger(identity.snapshot_sequence)&&identity.snapshot_sequence>0,'SNAPSHOT_SEQUENCE');
 need(Number.isFinite(now)&&new Date(now+28800000).toISOString().slice(0,10)===date,'IDENTITY_DATE');
 const decision=calendar?.payload?.calendar_decision,e=decision?.calendar_evidence;
 need(calendar?.trade_date===date&&calendar.market==='TW'&&calendar.is_open===true&&decision?.date===date&&decision.isTradingDay===true,'CALENDAR_DECISION');
 need(decision?.override!==true&&!decision?.error&&['twse','cache'].includes(e?.source)&&e?.source===decision?.source,'CALENDAR_SOURCE');
 need(e?.source_url==='https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule','CALENDAR_URL');
 const fetched=Date.parse(e?.fetched_at),checked=Date.parse(calendar?.payload?.checked_at);
 need(Number.isFinite(fetched)&&fetched<=checked&&checked<=now&&now-fetched<=7*86400000,'CALENDAR_FRESHNESS');
 const annual=Array.isArray(e?.rows)?e.rows:[],year=Number(date?.slice(0,4)),roc=String(year-1911)+date?.slice(5,7)+date?.slice(8,10);
 need(e?.year===year&&annual.length>0&&annual.some(r=>String(r.Date||'').startsWith(String(year-1911))),'CALENDAR_YEAR');
 const matches=annual.filter(r=>String(r.Date||'')===roc);
 need(matches.length<=1,'CALENDAR_DUPLICATE_DATE');
 const text=matches.map(r=>String(r.Name||'')+' '+String(r.Description||'').replace(/<[^>]*>/g,' ')).join(' ');
 const closed=/市場無交易|停止交易|休市|放假|暫停交易/.test(text),special=/開始交易|最後交易|補行交易|恢復交易/.test(text)&&!closed;
 const day=new Date(date+'T12:00:00+08:00').getUTCDay();
 need(!closed&&(![0,6].includes(day)||special),'CALENDAR_NOT_TRADING_DAY');
 const rpc=lease?.rpcEvidence,hb=Date.parse(rpc?.heartbeat_at),expiry=Date.parse(rpc?.lease_expires_at);
 need(lease?.status==='claimed'&&lease.ok===true&&rpc?.ok===true&&rpc.claimed===true,'LEASE_NOT_CLAIMED');
 need(rpc?.trade_date===date&&rpc.source_name===lease?.sourceName&&rpc.writer_host_id===lease?.hostId&&rpc.writer_instance_id===lease?.instanceId&&Boolean(rpc.writer_host_id)&&Boolean(rpc.writer_instance_id),'LEASE_OWNER');
 need(identity.canonical_run_id===`${rpc?.source_name}:${String(date).replaceAll('-','')}:canonical`&&identity.writer_run_id===`${rpc?.writer_instance_id}:${String(date).replaceAll('-','')}:${identity.generation_id}`,'LEASE_WRITER_BINDING');
 need(Number.isFinite(hb)&&Number.isFinite(expiry)&&hb<=now&&now<expiry&&expiry>hb,'LEASE_EXPIRED_OR_FUTURE');
 return [...new Set(failures)];
}
function collect(input){
 const {identity,symbols,calendar,lease,asOf}=input;
 if(!Array.isArray(symbols)||!symbols.length||new Set(symbols).size!==symbols.length)throw Error('A01_REQUESTED_SET');
 const failed=check(input),evidence_hash=hash({calendar,lease});
 const rows=symbols.map(symbol=>({symbol,status:failed.length?'DATA_GAP':'READY',data_gap_reason:failed.length?failed.join('|'):null,source:'TWSE.calendar+Supabase.writer_lease',source_contract:'preopen_a01_identity_receipt_v1',source_updated_at:asOf,event_time:asOf,is_synthetic:false,replay:false,look_ahead:false,calendar_date:calendar?.trade_date||null,writer_host_id:lease?.hostId||null,writer_instance_id:lease?.instanceId||null,lease_heartbeat_at:lease?.rpcEvidence?.heartbeat_at||null,lease_expires_at:lease?.rpcEvidence?.lease_expires_at||null,evidence_hash}));
 return {...identity,module_id:'A01',created_at:asOf,requested_symbols:[...symbols],rows,source_evidence:{calendar,lease}};
}
function verify(row,receipt){try{
 const {calendar,lease}=receipt.writer_write_set.plan.source_evidence;
 if(check({identity:receipt,calendar,lease,asOf:receipt.observed_at}).length)return false;
 return row.status==='READY'&&row.data_gap_reason===null&&row.calendar_date===receipt.trade_date&&row.writer_host_id===lease.hostId&&row.writer_instance_id===lease.instanceId&&row.lease_heartbeat_at===lease.rpcEvidence.heartbeat_at&&row.lease_expires_at===lease.rpcEvidence.lease_expires_at&&row.evidence_hash===hash({calendar,lease});
}catch{return false;}}
module.exports={collect,verify,check};
