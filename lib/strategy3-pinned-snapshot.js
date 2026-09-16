"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {inspectSnapshot,readMotherPoolSnapshot}=require('./daytrade-mother-pool-snapshot');
const fields=['trade_date','canonical_run_id','mother_pool_run_id','snapshot_sequence','snapshot_type','effective_at'];
const hash=symbols=>crypto.createHash('sha256').update(JSON.stringify([...symbols].sort())).digest('hex');
const same=(key,a,b)=>key==='effective_at'?Number.isFinite(Date.parse(a))&&Date.parse(a)===Date.parse(b):a===b;
function readPinnedSnapshot(tradeDate,identity,root=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime'){
 if(!identity)return readMotherPoolSnapshot(tradeDate);
 if(identity.trade_date!==tradeDate||!Number.isInteger(identity.snapshot_sequence)||identity.snapshot_sequence<1)throw Error('strategy3_pinned_snapshot_identity_invalid');
 const file=path.join(root,'data','scan-receipts',`daytrade-mother-pool-snapshot-${tradeDate.replace(/-/g,'')}-${String(identity.snapshot_sequence).padStart(4,'0')}.json`);
 const checked=inspectSnapshot(JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')),tradeDate);
 if(!checked.ok||fields.some(k=>checked.snapshot[k]!==identity[k])||hash(checked.symbols)!==identity.symbols_sha256)throw Error('strategy3_pinned_snapshot_evidence_mismatch');
 return checked;
}
function verifySnapshotRows(rows,identity){
 const symbols=rows.map(r=>String(r.symbol));
 const bad=rows.length===0||new Set(symbols).size!==rows.length||hash(symbols)!==identity.symbols_sha256||rows.some(row=>fields.some(k=>!same(k,row[k],identity[k]))||row.contract_version!=='4.1.0'||row.complete!==true||row.status!=='complete'||row.membership_status==='REMOVED');
 return bad?['strategy3_pinned_snapshot_db_readback_mismatch']:[];
}
module.exports={readPinnedSnapshot,verifySnapshotRows};
