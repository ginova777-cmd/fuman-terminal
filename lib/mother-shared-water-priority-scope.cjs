'use strict';
const {createHash}=require('node:crypto');
const {canonicalSymbols}=require('./mother-shared-water-producer.cjs');
const hash=s=>createHash('sha256').update(JSON.stringify(s),'utf8').digest('hex');
// Freeze at the point where the existing full-priority metric is computed.
// Neither the producer subset nor Snapshot membership may redefine this set.
function freezeScope(symbols,{tradeDate,writerRunId,freshSymbols}){
 const all=canonicalSymbols(symbols),fresh=freshSymbols.length?canonicalSymbols(freshSymbols):[];
 if(!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate||'')||typeof writerRunId!=='string'||!writerRunId)throw Error('PRIORITY_SCOPE_IDENTITY_INVALID');
 if(fresh.some(s=>!all.includes(s)))throw Error('PRIORITY_FRESH_OUTSIDE_SCOPE');
 return {contract:'mother-full-priority-scope-v1',scope_definition_version:'full-priority-fixed-membership-v1',trade_date:tradeDate,writer_run_id:writerRunId,symbols:all,symbols_sha256:hash(all),count:all.length,legacy_fresh_symbols:fresh,legacy_fresh_count:fresh.length,legacy_fresh_coverage:fresh.length/all.length};
}
function readScope(scope,{tradeDate,writerRunId,expectedCount}){
 if(scope?.contract!=='mother-full-priority-scope-v1'||scope.scope_definition_version!=='full-priority-fixed-membership-v1'||scope.trade_date!==tradeDate||scope.writer_run_id!==writerRunId)throw Error('PRIORITY_SCOPE_IDENTITY_MISMATCH');
 const all=canonicalSymbols(scope.symbols);
 if(JSON.stringify(all)!==JSON.stringify(scope.symbols)||hash(all)!==scope.symbols_sha256||scope.count!==all.length||expectedCount!==all.length)throw Error('PRIORITY_SCOPE_CONTENT_MISMATCH');
 return all;
}
module.exports={freezeScope,readScope};
