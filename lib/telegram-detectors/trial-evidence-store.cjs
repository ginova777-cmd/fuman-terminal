'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const local=t=>Number.isFinite(Date.parse(t))?new Date(Date.parse(t)+28800000).toISOString():'';
function folder(root,date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('TRIAL_DATE_INVALID');return path.join(root,'data/telegram-detectors/trial-evidence',date);}
function save({runtimeRoot,tradeDate,rows,now}){
 const stamp=local(now);if(stamp.slice(0,10)!==tradeDate||stamp.slice(11,16)!=='08:59')return {saved:0,reason:'OUTSIDE_NATURAL_0859_CAPTURE'};
 let saved=0;for(const row of rows){const time=local(row.observed_at);if(!/^\d{4}$/.test(row.symbol||'')||row.trade_date!==tradeDate||row.is_trial!==true||row.payload?.source!=='fugle-websocket-cache:trial-event'||row.payload.observed_at!==row.observed_at||row.payload.trade_date!==tradeDate||row.payload.recovery_mode===true||time.slice(0,10)!==tradeDate||time.slice(11,16)!=='08:59'||Date.parse(row.observed_at)>Date.parse(now)||typeof row.trial_price!=='number'||!Number.isFinite(row.trial_price)||row.trial_price<=0)continue;
  const evidence={contract:'natural_0859_trial_evidence_v1',captured_at:now,row},bytes=JSON.stringify(evidence),id=sha(JSON.stringify(row)),dir=folder(runtimeRoot,tradeDate),file=path.join(dir,id+'.json');fs.mkdirSync(dir,{recursive:true});
  // Different prices at one timestamp are retained as separate evidence; the
  // consumer detects conflicts instead of silently replacing the earlier row.
  try{fs.writeFileSync(file,bytes,{flag:'wx'});saved++;}catch(e){if(e.code!=='EEXIST')throw e;const old=JSON.parse(fs.readFileSync(file,'utf8'));if(sha(JSON.stringify(old.row))!==id)throw Error('TRIAL_ARCHIVE_HASH_MISMATCH');}
 }
 return {saved,reason:null};
}
function load({runtimeRoot,tradeDate,asOf}){
 const dir=folder(runtimeRoot,tradeDate);let names;try{names=fs.readdirSync(dir);}catch(e){if(e.code==='ENOENT')return {rows:[],files:[]};throw e;}
 const rows=[],files=[];for(const name of names.filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).sort()){const file=path.join(dir,name),bytes=fs.readFileSync(file),p=JSON.parse(bytes);if(p.contract!=='natural_0859_trial_evidence_v1'||sha(JSON.stringify(p.row))!==name.slice(0,-5)||p.row.trade_date!==tradeDate||local(p.captured_at).slice(0,16)!==tradeDate+'T08:59'||Date.parse(p.row.observed_at)>Date.parse(p.captured_at))throw Error('TRIAL_ARCHIVE_INVALID');if(Date.parse(p.captured_at)>Date.parse(asOf))continue;rows.push(p.row);files.push({path:file,sha256:sha(bytes)});}
 return {rows,files};
}
module.exports={save,load};
