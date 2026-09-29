'use strict';
const fs=require('node:fs'),path=require('node:path'),{isDeepStrictEqual}=require('node:util');
const {hash,identityFields}=require('./mother-pool-module-write-set');
const registry=require('../data/contracts/mother-pool-a01-b24-module-registry-v1.json');
function load(directory,moduleId,identity){
 const files=fs.readdirSync(directory).filter(n=>n.endsWith('-plan.json')).map(n=>path.join(directory,n));
 const attempts=path.join(directory,'attempts');
 if(fs.existsSync(attempts))files.push(...fs.readdirSync(attempts).filter(n=>n.endsWith('.attempt.json')).map(n=>path.join(attempts,n)));
 let selected=null;
 for(const file of files){
  const raw=JSON.parse(fs.readFileSync(file,'utf8')),d=raw.contract==='daytrade_module_attempt_v1'?raw.document:raw;
  if(d?.module_id!==moduleId||d.writer_run_id!==identity.writer_run_id||d.trade_date!==identity.trade_date)continue;
  if(d.contract!=='mother_pool_module_write_set_v1'||d.module_contract!==registry.modules[moduleId]||identityFields.some(k=>d[k]!==identity[k])||hash(d.plan)!==d.plan_hash)throw Error('DEFERRED_ORIGINAL_PLAN_INVALID:'+moduleId);
  if(selected&&!isDeepStrictEqual(selected,d))throw Error('DEFERRED_ORIGINAL_PLAN_CONFLICT:'+moduleId);
  selected=d;
 }
 if(!selected)return null;
 const p=selected.plan;
 return {...identity,module_id:moduleId,created_at:p.created_at,requested_symbols:p.requested_symbols,rows:p.rows,special_evidence:p.special_evidence,...(p.source_evidence?{source_evidence:p.source_evidence}:{})};
}
module.exports={load};
