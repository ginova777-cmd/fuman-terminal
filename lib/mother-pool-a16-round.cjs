'use strict';
// Runs under the existing Writer process and lock; never starts a detached owner.
async function run({selected,apply,identity,symbols,runtime,lease,deadline,runWarmup,clock=Date.now}){
 if(!apply||!selected().includes('A16'))return {status:'NOT_SELECTED',started:false};
 const codes=[...new Set(symbols)].sort();
 if(!codes.length||codes.some(s=>typeof s!=='string'||!/^\d{4}$/.test(s)))throw Error('A16_UNIVERSE_INVALID');
 if(!Number.isFinite(deadline))throw Error('A16_WRITER_DEADLINE_MISSING');
 const canWrite=()=>{
  const owner=lease(),now=clock(),local=new Date(now+28800000).toISOString();
  // Existing IO may perform a 20s POST and two 20s independent reads.
  return selected().includes('A16')&&local.slice(0,10)===identity.trade_date&&local.slice(11,16)>='06:00'&&local.slice(11,16)<'09:00'
   &&now+65000<deadline&&owner?.ok===true&&owner.status==='claimed'
   &&owner.sourceName==='fugle_daytrade_source'&&Date.parse(owner.leaseExpiresAt)>now+65000;
 };
 if(!canWrite())return {status:'A16_OWNERSHIP_OR_ROUND_BUDGET_UNAVAILABLE',started:false};
 const universe={trade_date:identity.trade_date,canonical_run_id:identity.canonical_run_id,symbols:codes,scope:'writer_active_symbols'};
 const result=await runWarmup({runtime,universe,apply:true,scheduled:true,canWrite,deadline});
 return {status:result.status,started:true,complete:result.complete===true,first_blocker:result.first_blocker||null,attempted_count:result.attempted_count};
}
module.exports={run};
