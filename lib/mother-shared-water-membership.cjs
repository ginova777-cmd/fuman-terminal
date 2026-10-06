'use strict';
const {createHash}=require('node:crypto');
const hash=b=>createHash('sha256').update(b).digest('hex');
const keys=['trade_date','canonical_run_id','mother_pool_run_id','generation','snapshot_sequence'];
function symbols(value){if(!Array.isArray(value)||!value.length||value.some(s=>typeof s!=='string'||!/^\d{4}$/.test(s))||new Set(value).size!==value.length)throw Error('MEMBERSHIP_INVALID');return [...value].sort();}
function verifyMembership(receipt,{resolve,expectedPriority,expectedIdentity}){
 const errors=[],check=(ok,code)=>{if(!ok)errors.push(code);};
 try{
  const priority=symbols(receipt.requested_symbols),expected=symbols(expectedPriority),members=symbols(receipt.snapshot_symbols);
  check(JSON.stringify(priority)===JSON.stringify(expected),'PRIORITY_SET_MISMATCH');
  check(receipt.requested_count===priority.length&&receipt.unique_count===priority.length,'PRIORITY_COUNT_MISMATCH');
  check(receipt.requested_symbols_sha256===hash(JSON.stringify(priority)),'PRIORITY_HASH_MISMATCH');
  check(receipt.snapshot_symbols_sha256===hash(JSON.stringify(members)),'SNAPSHOT_MEMBERSHIP_HASH_MISMATCH');
  for(const key of [...keys,'writer_run_id','verification_run_id','producer_version'])check(expectedIdentity?.[key]!==undefined&&receipt[key]===expectedIdentity[key],'EXPECTED_IDENTITY_MISMATCH:'+key);
  const ref='sha256:'+receipt.snapshot_bytes_sha256,bytes=resolve(ref);
  check(Buffer.isBuffer(bytes)&&bytes.length<=4*1024*1024,'SNAPSHOT_BYTES_MISSING_OR_TOO_LARGE');
  if(!Buffer.isBuffer(bytes)||bytes.length>4*1024*1024)throw Error('SNAPSHOT_BYTES_UNAVAILABLE');
  check(hash(bytes)===receipt.snapshot_bytes_sha256,'SNAPSHOT_BYTES_HASH_MISMATCH');
  const snapshot=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  for(const key of keys)check(snapshot[key]===receipt[key],'SNAPSHOT_IDENTITY_MISMATCH:'+key);
  check(snapshot.complete===true&&snapshot.status==='complete','SNAPSHOT_NOT_COMPLETE');
  check(JSON.stringify(symbols(snapshot.symbols))===JSON.stringify(members),'SNAPSHOT_SET_MISMATCH');
  check(JSON.stringify(receipt.priority_not_in_snapshot)===JSON.stringify(priority.filter(s=>!members.includes(s))),'PRIORITY_DIFFERENCE_MISMATCH');
  check(JSON.stringify(receipt.snapshot_not_in_priority)===JSON.stringify(members.filter(s=>!priority.includes(s))),'SNAPSHOT_DIFFERENCE_MISMATCH');
  check(Array.isArray(receipt.rows)&&JSON.stringify(symbols(receipt.rows.map(r=>r.symbol)))===JSON.stringify(priority),'ROW_SET_MISMATCH');
  check(receipt.rows_sha256===hash(JSON.stringify(receipt.rows)),'ROWS_HASH_MISMATCH');
 }catch(e){errors.push(e.message);}
 return {membership_verified:errors.length===0,failed_checks:[...new Set(errors)],water_gate_pass:false,formal_entry_authorization:false};
}
module.exports={verifyMembership};
