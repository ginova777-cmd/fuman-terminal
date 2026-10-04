'use strict';
const assert=require('node:assert/strict');
const {bindReceipt,validateReceipt,verifyHashEvidence}=require('../lib/mother-pool-receipt-binding');
const time='2026-09-17T02:00:00Z',run='fixture';
const member={symbol:'2330',trade_date:'2026-09-17',mother_pool_run_id:run,generation:run,mother_pool_snapshot_sequence:1,
 membership_status:'ACTIVE',membership_effective_at:time,added_at:time,removed_at:null,source_reason:'fixture',source_updated_at:time};
const s={contract:'daytrade_mother_pool_snapshot_v1',contract_version:'4.1.0',trade_date:'2026-09-17',
 canonical_run_id:'fugle_daytrade_source:20260917:canonical',run_id:run,generation:run,mother_pool_run_id:run,generation:run,
 snapshot_sequence:1,snapshot_type:'INTRADAY_FULL_SNAPSHOT',generated_at:time,effective_at:time,source_max_updated_at:time,
 status:'complete',complete:true,exit_code:0,first_blocker:null,previous_run_id:'',symbol_count:1,
 symbols:['2330'],added_symbols:['2330'],removed_symbols:[],symbol_membership:[member]};
const row={...s,...member};delete row.symbol_membership;

const proof={...Object.fromEntries(['trade_date','canonical_run_id','mother_pool_run_id','generation','snapshot_sequence'].map(k=>[k,s[k]])),status:'complete',complete:true,exit_code:0,failed_checks:[],first_blocker:null,verified_at:'2026-09-17T02:01:00Z',read_role:'anon',query_identity:{trade_date:s.trade_date,canonical_run_id:s.canonical_run_id,mother_pool_run_id:run,generation:run,snapshot_sequence:1},pages:[{http_status:200,offset:0,rows:1,content_range:'0-0/1',row_data:[row]}]};

const vectors=[];
function vector(name,{snapshot=s,readback=proof,symbols=['2330'],date=s.trade_date,mutate}={},expected=true){
 let result,input={snapshotRaw:JSON.stringify(snapshot),readbackRaw:JSON.stringify(readback),symbols,tradeDate:date,canonicalRunId:s.canonical_run_id};
 try{const b=bindReceipt(input);if(mutate)mutate(b);result={binding:b,verification:verifyHashEvidence(b)};}catch(e){result={verification:{ok:false,failed_checks:[e.message]}};}
 assert.equal(result.verification.ok,expected,name);vectors.push({name,input,expected_pass:expected,...result});
}
vector('normal');
vector('chinese_null',{snapshot:{...s,note:'母池',nullable:null}});
vector('missing_optional',{snapshot:{...s,note:'母池'}});
vector('empty_symbol',{symbols:['']},false);
vector('duplicate_symbol',{symbols:['2330','2330']},false);
vector('numeric_symbol',{symbols:[2330]},false);
vector('wrong_date',{date:'2026-09-16'},false);
vector('tamper_one_byte',{mutate:b=>{const v=b.hash_evidence.snapshot,bytes=Buffer.from(v.base64,'base64');bytes[1]^=1;v.base64=bytes.toString('base64');}},false);
vector('old_receipt_without_bytes',{mutate:b=>delete b.hash_evidence},false);
function multiple(symbols,generation='fixture',seq=1){
 const members=symbols.map(symbol=>({...member,symbol,mother_pool_run_id:generation,generation,mother_pool_snapshot_sequence:seq}));
 const snapshot={...s,run_id:generation,mother_pool_run_id:generation,generation,snapshot_sequence:seq,symbol_count:symbols.length,symbols,added_symbols:symbols,symbol_membership:members};
 const rows=members.map(m=>{const r={...snapshot,...m};delete r.symbol_membership;return r;});
 const readback={...proof,mother_pool_run_id:generation,generation,snapshot_sequence:seq,query_identity:{...proof.query_identity,mother_pool_run_id:generation,generation,snapshot_sequence:seq},pages:[{http_status:200,offset:0,rows:rows.length,content_range:'0-'+(rows.length-1)+'/'+rows.length,row_data:rows}]};
 return {snapshot,readback,symbols};
}
const many=multiple(['3163','2330','0050']);vector('leading_zero_members',many);
vector('request_reordered',{...many,symbols:['0050','2330','3163']});
assert.equal(vectors.at(-1).binding.symbols_sha256,vectors.at(-2).binding.symbols_sha256);
vector('add_member',multiple(['3163','2330','0050','6531']));
vector('remove_member',multiple(['2330','0050']));
vector('same_members_new_generation',multiple(['3163','2330','0050'],'fixture2',2));
assert.equal(vectors.at(-1).binding.symbols_sha256,vectors.find(v=>v.name==='leading_zero_members').binding.symbols_sha256);
assert.notEqual(vectors.at(-1).binding.snapshot_sha256,vectors.find(v=>v.name==='leading_zero_members').binding.snapshot_sha256);
const target=process.argv.find(a=>a.startsWith('--output='))?.slice(9);
if(target)require('fs').writeFileSync(target,JSON.stringify({contract:'mother-pool-hash-test-vectors-v1',isolated:true,natural_evidence:false,producer_artifact_sha256:require('crypto').createHash('sha256').update(require('fs').readFileSync(require.resolve('../lib/mother-pool-receipt-binding'))).digest('hex'),vectors},null,2));
console.log(JSON.stringify({ok:true,vectors:vectors.length,natural_evidence:false}));
