'use strict';
// Evidence reconciliation only: this module cannot delete or mutate a source asset.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
function index(rows,label){
 if(!Array.isArray(rows))throw Error(label+':inventory_missing');
 const out=new Map();
 for(const r of rows){if(!r||typeof r.key!=='string'||!r.key||! /^[a-f0-9]{64}$/.test(r.sha256)||out.has(r.key))throw Error(label+':identity_invalid');out.set(r.key,r);}
 return out;
}
function reconcile(p){
 if(p.contract!=='cleanup-item-observation-v1'||!p.runId||!/^C\d{2}$|^N\d{2}$/.test(p.id)||p.id==='C16'||p.inventoryComplete!==true||p.readbackComplete!==true)throw Error('item_observation_incomplete');
 for(const a of p.archives||[]){const bytes=fs.readFileSync(a.file);const original=require('zlib').gunzipSync(bytes);if(hash(bytes)!==a.sha256||hash(original)!==a.originalSha256||JSON.parse(fs.readFileSync(a.index,'utf8')).sourceSha256!==a.originalSha256)throw Error('item_archive_readback_failed');}
 const before=index(p.before,'before'),after=index(p.after,'after');
 if(!Array.isArray(p.candidates)||new Set(p.candidates).size!==p.candidates.length||p.candidates.some(k=>!before.has(k)))throw Error('item_candidates_invalid');
 const candidates=new Set(p.candidates),protectedSet=[...before.values()].filter(r=>!candidates.has(r.key));
 const exclusions=p.protectedExclusions||[];
 if(!Array.isArray(exclusions)||new Set(exclusions.map(e=>e.key)).size!==exclusions.length||exclusions.some(e=>!before.has(e.key)||candidates.has(e.key)||typeof e.reason!=='string'||!e.reason.trim()))throw Error('item_protected_exclusions_invalid');
 for(const r of protectedSet)if(after.get(r.key)?.sha256!==r.sha256)throw Error('item_protected_changed:'+r.key);
 const unknown=[...after.keys()].filter(k=>!before.has(k));if(unknown.length)throw Error('item_unexpected_new_members');
 const remaining=p.candidates.filter(k=>after.has(k));
 return {id:p.id,runId:p.runId,status:remaining.length?'failed':'complete',inventoryComplete:true,readbackVerified:remaining.length===0,protectedReadbackVerified:true,deleted:p.candidates.length-remaining.length,remaining:remaining.length,protectedSet,scanned:before.size,eligibleCandidates:p.candidates.length,protectedExclusions:exclusions};
}
function persist(file,observation){
 const item=reconcile(observation);fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.writeFileSync(file,JSON.stringify(observation,null,2)+'\n',{flag:'wx'});
 return {...item,evidence:[{file,sha256:hash(fs.readFileSync(file))}]};
}
function verify(item){
 const observations=(item.evidence||[]).map(e=>{const bytes=fs.readFileSync(e.file);if(hash(bytes)!==e.sha256)throw Error('item_observation_hash');return JSON.parse(bytes);});
 if(observations.length!==1)throw Error('item_observation_count');
 const actual=reconcile(observations[0]);
 for(const k of ['id','runId','status','inventoryComplete','readbackVerified','protectedReadbackVerified','deleted','remaining','protectedSet','scanned','eligibleCandidates','protectedExclusions'])if(JSON.stringify(item[k])!==JSON.stringify(actual[k]))throw Error('item_observation_summary_mismatch:'+k);
 return actual;
}
function files(paths){
 const out=new Map();
 function visit(file){if(!fs.existsSync(file))return;const stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw Error('item_inventory_link');if(stat.isDirectory()){for(const name of fs.readdirSync(file))visit(path.join(file,name));return;}if(!stat.isFile())throw Error('item_inventory_special_file');if(out.size>=100000)throw Error('item_inventory_bound');const bytes=fs.readFileSync(file),after=fs.statSync(file);if(stat.size!==after.size||stat.mtimeMs!==after.mtimeMs)throw Error('item_inventory_changed');out.set(file,{key:file,sha256:hash(bytes)});}
 for(const file of paths)visit(file);return [...out.values()].sort((a,b)=>a.key.localeCompare(b.key));
}
module.exports={reconcile,persist,verify,files};
