'use strict';
const crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x??null)).digest('hex');
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const symbols=a=>Array.isArray(a)&&a.every(s=>typeof s==='string'&&/^\d{4}$/.test(s))&&new Set(a).size===a.length;
function admit({ack,payload,tradeDate,stage,now=Date.now(),verifyHandoff}){
 const fail=reason=>({ok:false,reason,symbols:[]});
 if(!ack||ack.contract!=='opening-report-0830-mother-pool-handoff-ack-v2'||ack.ok!==true||ack.complete!==true||ack.db_readback_ok!==true)return fail('MORNING_HANDOFF_ACK_REQUIRED');
 if(typeof verifyHandoff!=='function')return fail('MORNING_HANDOFF_VERIFIER_REQUIRED');
 const checks=verifyHandoff(ack,{tradeDate,stage,asOf:new Date(now).toISOString()});
 if(!Array.isArray(checks)||checks.length)return fail('MORNING_HANDOFF_EVIDENCE_INVALID');
 const e=ack.source_evidence,run=ack.report_run_id;
 if(ack.trade_date!==tradeDate||!run||e?.stage!==stage||payload?.date!==tradeDate||payload.stage!==stage||payload.run_id!==run+'-'+payload.industry)return fail('MORNING_HANDOFF_IDENTITY_MISMATCH');
 const t=Date.parse(ack.checked_at);
 if(!Number.isFinite(t)||t>now)return fail('MORNING_HANDOFF_TIME_INVALID');
 if(ack.formal_candidate_count!==0||ack.formal_candidate_allowed!==false||ack.forbidden_publish_guard!==true||!Array.isArray(ack.missing_fields)||ack.missing_fields.length)return fail('MORNING_HANDOFF_STATE_INVALID');
 if(!Array.isArray(e.all_industry_payloads)||e.all_industry_payloads.length!==15||new Set(e.all_industry_payloads.map(p=>p.industry)).size!==15||hash(e.all_industry_payloads)!==e.all_industry_payloads_sha256||e.all_industry_payloads.some(p=>p.date!==tradeDate||p.stage!==stage||p.run_id!==run+'-'+p.industry))return fail('MORNING_HANDOFF_PAYLOAD_SET_INVALID');
 if(!Array.isArray(e.rows)||hash(e.rows)!==e.rows_sha256||e.readback_role!=='anon')return fail('MORNING_HANDOFF_READBACK_HASH_INVALID');
 if(e.aggregate?.status!=='BRIDGE_OK'||e.aggregate.run_id!==run||e.aggregate.trade_date!==tradeDate)return fail('MORNING_HANDOFF_AGGREGATE_MISMATCH');
 if(!symbols(ack.accepted_symbols)||!symbols(ack.accepted_readback_symbols)||!equal([...ack.accepted_symbols].sort(),[...ack.accepted_readback_symbols].sort())||ack.accepted_count!==ack.accepted_symbols.length||ack.accepted_readback_count!==ack.accepted_symbols.length)return fail('MORNING_HANDOFF_SYMBOL_SET_MISMATCH');
 if(!e.all_industry_payloads.some(p=>equal(p,payload))||!e.industry_payloads?.some(p=>equal(p,payload)))return fail('MORNING_HANDOFF_PAYLOAD_CHANGED');
 return {ok:true,reason:null,symbols:ack.accepted_symbols,report_run_id:run,checked_at:ack.checked_at,payload_sha256:e.all_industry_payloads_sha256};
}
module.exports={admit};
