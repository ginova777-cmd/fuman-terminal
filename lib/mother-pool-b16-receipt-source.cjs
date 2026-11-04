'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const check=require('./mother-pool-delivery-receipt-readback.cjs');
const {identityFields}=require('./mother-pool-module-write-set');
async function json(file,max=4194304){const h=await fs.open(file,'r');try{const s=await h.stat();if(!s.isFile()||s.size>max)throw Error('B16_RECEIPT_SIZE');return JSON.parse(await h.readFile('utf8'));}finally{await h.close();}}
function build({identity,symbols,asOf,record,db,reason=null}){
 const proof=record?check.verify({record,db,tradeDate:identity.trade_date,runId:record.result?.run_id,asOf}):null;
 if(record&&Date.parse(asOf)-Date.parse(record.result?.checked_at)>120000)reason='B16_RECEIPT_STALE';
 const details=new Map((record?.sourceProof?.details||[]).map(x=>[x.symbol,x]));
 const binding={contract:'mother_pool_b16_receipt_binding_v1',mother_pool_identity:Object.fromEntries(identityFields.map(k=>[k,identity[k]])),source_run_id:record?.result?.source_run_id||null,receipt_run_id:record?.result?.run_id||null,receipt_sha256:record?check.digest(record):null,readback_sha256:db?check.digest(db):null,observed_at:asOf};
 const rows=symbols.map(symbol=>{const d=details.get(symbol);const gap=reason||(!proof?.complete?proof?.failed_checks?.[0]||'B16_RECEIPT_MISSING':!d?'B16_SYMBOL_NOT_EVALUATED':!(d.volume_ready||d.price_ready)?'B16_SYMBOL_CALCULATION_NOT_READY':null);
 return {symbol,status:gap?'DATA_GAP':'READY',data_gap_reason:gap,source:'telegram_three_independent_detectors_v1',source_contract:'telegram_delivery_separation_v1',source_updated_at:record?.result?.checked_at||asOf,is_synthetic:false,replay:false,look_ahead:false,receipt_run_id:binding.receipt_run_id,source_run_id:binding.source_run_id,binding_sha256:check.digest(binding),notification_status:record?.result?.notification_status||'UNKNOWN',delivery_verified:false,calculation_detail:d||null};});
 return {...identity,module_id:'B16',created_at:asOf,requested_symbols:[...symbols],source_evidence:{binding,record:record||null,db:db||null},rows};
}
async function collect({identity,symbols,asOf,runtime,readSnapshot}){
 try{
  const dir=path.resolve(runtime,'data/telegram-detectors',identity.trade_date),ledger=await json(path.join(dir,'day-ledger.json'));
  if(ledger.contract!=='telegram_three_detectors_day_ledger_v1'||ledger.trade_date!==identity.trade_date||!Array.isArray(ledger.rounds))throw Error('B16_LEDGER_IDENTITY');
  const entry=ledger.rounds.filter(x=>Date.parse(x.checked_at)<=Date.parse(asOf)).at(-1);
  if(!entry||!/^telegram-natural-[a-zA-Z0-9-]+$/.test(entry.run_id))throw Error('B16_NATURAL_RECEIPT_MISSING');
  const file=path.resolve(entry.file);if(file!==path.join(dir,entry.run_id+'.json'))throw Error('B16_RECEIPT_PATH');
  const h=await fs.open(file,'r');let bytes;try{if((await h.stat()).size>4194304)throw Error('B16_RECEIPT_SIZE');bytes=await h.readFile();}finally{await h.close();}
  if(require('node:crypto').createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('B16_LEDGER_HASH');
  const record=JSON.parse(bytes),db=await readSnapshot('telegram_three_detectors_'+entry.run_id);
  if(record.result?.run_id!==entry.run_id)throw Error('B16_LEDGER_RUN');
  return build({identity,symbols,asOf,record,db});
 }catch(e){return build({identity,symbols,asOf,reason:e.code==='ENOENT'?'B16_RECEIPT_MISSING':String(e.message).split(':')[0]});}
}
function verify(row,round){try{
 const e=round.writer_write_set?.plan?.source_evidence,b=e?.binding;
 if(!b||b.contract!=='mother_pool_b16_receipt_binding_v1'||identityFields.some(k=>b.mother_pool_identity[k]!==round[k]))return false;
 const rebuilt=build({identity:round,symbols:[row.symbol],asOf:b.observed_at,record:e.record,db:e.db}).rows[0];
 if(Date.parse(b.observed_at)>Date.parse(round.observed_at)||rebuilt.status!=='READY'||check.digest(b)!==row.binding_sha256)return false;
 return Object.keys(rebuilt).every(k=>check.digest(row[k])===check.digest(rebuilt[k]));
 }catch{return false;}}
module.exports={collect,build,verify};
