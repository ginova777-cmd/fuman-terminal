'use strict';
const fs=require('node:fs'),path=require('node:path');
const {hash}=require('../lib/mother-pool-module-write-set');
const {buildCloseout}=require('../lib/mother-pool-closeout-producer');
const {createVerifier}=require('../lib/verify-mother-pool-module-round');
const arg=n=>process.argv.find(x=>x.startsWith('--'+n+'='))?.slice(n.length+3);
async function verify({closeout,rounds,naturalVerification}){
 const failed=[];
 if(!createVerifier('B18').validRound(closeout))failed.push('CLOSEOUT_DB_ANON_INVALID');
 if(!rounds.every(r=>createVerifier('B01').validRound(r)))failed.push('NATURAL_DB_ANON_INVALID');
 try{
  const rebuilt=await buildCloseout({identity:closeout,rounds,closeoutAt:closeout.closeout_at},{verifyRounds:async()=>naturalVerification});
  const saved=closeout.writer_write_set?.plan;
  if(hash(saved?.special_evidence)!==hash(rebuilt.special_evidence)||hash(saved?.rows)!==hash(rebuilt.rows))failed.push('CLOSEOUT_PRODUCER_MISMATCH');
 }catch(e){failed.push(e.message);}
 return {module_id:'B18',contract:'daytrade_closeout_v1',trade_date:closeout.trade_date,canonical_run_id:closeout.canonical_run_id,
  rounds_verified:rounds,closeout_artifact:closeout,closeout:true,closeout_at:closeout.closeout_at,
  natural_evidence:failed.length===0,replay:false,synthetic:false,look_ahead:false,
  source_contract_ok:failed.length===0,db_readback_ok:failed.length===0,anon_readback_ok:failed.length===0,
  complete:failed.length===0,status:failed.length?'blocked':'complete',failed_checks:failed,first_blocker:failed[0]||null,exit_code:failed.length?1:0,
  verified_by:'verify-mother-pool-closeout.js',checked_at:new Date().toISOString()};
}
if(require.main===module){(async()=>{
 const read=n=>JSON.parse(fs.readFileSync(arg(n),'utf8'));
 const result=await verify({closeout:read('closeout'),rounds:[read('round1'),read('round2')],naturalVerification:read('natural-verification')});
 const out=arg('out');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2),{flag:'wx'});
 console.log(JSON.stringify({status:result.status,complete:result.complete,first_blocker:result.first_blocker,out}));process.exitCode=result.exit_code;
})().catch(e=>{console.error(e);process.exitCode=1;});}
module.exports={verify};
