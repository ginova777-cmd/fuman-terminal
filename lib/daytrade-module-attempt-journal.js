'use strict';
const fs=require('node:fs'),path=require('node:path');
const {isDeepStrictEqual}=require('node:util');
const {hash}=require('./mother-pool-module-write-set');
const {writeExclusive}=require('./daytrade-durable-json');
// The key matches the database's immutable round key, not a mutable plan hash.
function fileFor(directory,document){
 for(const key of ['module_id','trade_date','writer_run_id'])if(typeof document[key]!=='string'||!document[key])throw Error('MODULE_ATTEMPT_IDENTITY');
 return path.join(directory,hash([document.module_id,document.trade_date,document.writer_run_id])+'.attempt.json');
}
function inspect(directory,document){
 const file=fileFor(directory,document);let stored;
 try{stored=JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return false;throw error;}
 if(stored.contract!=='daytrade_module_attempt_v1'||!isDeepStrictEqual(stored.document,document))throw Error('MODULE_ATTEMPT_DOCUMENT_MISMATCH');
 return true;
}
function begin(directory,document){
 if(document.contract!=='mother_pool_module_write_set_v1'||hash(document.plan)!==document.plan_hash)throw Error('MODULE_ATTEMPT_PLAN_INVALID');
 fs.mkdirSync(directory,{recursive:true});
 // An existing marker, including a truncated one, must never be overwritten.
 // Only an independent exact DB acknowledgement can resolve uncertainty.
 writeExclusive(fileFor(directory,document),{contract:'daytrade_module_attempt_v1',document});
}
module.exports={begin,inspect,fileFor};
