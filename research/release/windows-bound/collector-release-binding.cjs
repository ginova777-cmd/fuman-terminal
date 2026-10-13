'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const ENTRY='scripts/fugle-futopt-websocket-collector.js';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const git=(root,...args)=>cp.execFileSync('git',['-c','core.fsmonitor=false','-C',root,...args],{windowsHide:true,maxBuffer:8*1024*1024});
function select(c){
 if(hash(JSON.stringify(c.collector_release_bindings))!==c.collector_bindings_sha256)throw Error('COLLECTOR_BINDINGS_HASH_MISMATCH');
 const sha=git(c.prod,'rev-parse','HEAD').toString().trim();
 if(c.expected===c.target||![c.expected,c.target].includes(sha))throw Error('COLLECTOR_RELEASE_UNKNOWN');
 const authority=JSON.parse(fs.readFileSync(c.authority,'utf8').replace(/^\uFEFF/,''));
 if(authority.approvedProductionSha!==sha||fs.realpathSync.native(authority.productionRoot)!==fs.realpathSync.native(c.prod))throw Error('COLLECTOR_AUTHORITY_DRIFT');
 if(git(c.prod,'status','--porcelain','--untracked-files=all').toString().trim())throw Error('COLLECTOR_RELEASE_DIRTY');
 const stage=sha===c.expected?'expected':'target',binding=c.collector_release_bindings?.[stage];
 if(!binding||binding.release_sha!==sha||binding.entry!==ENTRY||!/^([a-f0-9]{64})$/.test(binding.blob_sha256||'')||!/^([a-f0-9]{64})$/.test(binding.runtime_sha256||''))throw Error('COLLECTOR_RELEASE_BINDING_INVALID');
 const blob=git(c.prod,'show',sha+':'+ENTRY),entry=path.join(c.prod,ENTRY),bytes=fs.readFileSync(entry);
 if(hash(blob)!==binding.blob_sha256||hash(bytes)!==binding.runtime_sha256)throw Error('COLLECTOR_RELEASE_HASH_MISMATCH');
 // Bind the exact checkout transformation too; no arbitrary old/new hash list.
 const checkoutBlob=git(c.prod,'hash-object','--path='+ENTRY,entry).toString().trim();
 if(checkoutBlob!==git(c.prod,'rev-parse',sha+':'+ENTRY).toString().trim())throw Error('COLLECTOR_CHECKOUT_BLOB_MISMATCH');
 return {stage,release_sha:sha,entry,blob_sha256:binding.blob_sha256,runtime_sha256:binding.runtime_sha256};
}
function revalidate(c,proof){const next=select(c);if(JSON.stringify(next)!==JSON.stringify(proof))throw Error('COLLECTOR_RELEASE_CHANGED');return next;}
if(require.main===module){try{console.log(JSON.stringify(select(JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,'')))));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={select,revalidate,ENTRY,hash};
