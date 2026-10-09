'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process'),assert=require('assert/strict'),crypto=require('crypto');
const {create}=require('./formal-source-baseline-port.cjs'),{prepare}=require('./fresh-epoch.cjs'),{sign,verify}=require('./signed-boundary.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp-formal-source-')),root=path.join(dir,'source'),source='C:/fuman-release-owner/prod81';
// Copy only tracked source text, never secrets/runtime/cache; exact bytes are recorded.
const files=cp.execFileSync('git',['-C',source,'ls-files','lib','scripts'],{encoding:'utf8'}).trim().split('\n').filter(p=>/\.(cjs|js|json)$/.test(p));
const hashes={};for(const p of files){const b=fs.readFileSync(path.join(source,p));const dest=path.join(root,p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,b);hashes[p]=crypto.createHash('sha256').update(b).digest('hex');}
async function main(){const port=create({sourceRoot:root,directory:path.join(dir,'runtime')});try{
 const now=new Date().toISOString(),row={symbol:'2330',market:'TSE',tradeDate:now.slice(0,10),candleTime:now,candleSeenAt:now,open:1,high:2,low:1,close:2,volume:1};
 port.mergeQuote([{symbol:'2330',market:'TSE',tradeDate:now.slice(0,10),price:2}]);port.mergeCandles([row]);port.mergeCandles([{...row,close:1.5}]);
 const challenge=crypto.randomUUID(),ack=await port.freeze(challenge);assert.equal(ack.original_save_ack.ok,true);assert.equal(JSON.parse(fs.readFileSync(port.candle)).candles[0].close,1.5);assert.throws(()=>port.mergeCandles([row]),/FROZEN/);assert.throws(()=>port.mergeQuote([]),/FROZEN/);
 const identity=JSON.parse(cp.execFileSync('pwsh',['-NoProfile','-Command',`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${process.pid}'; @{pid=$p.ProcessId;creation=$p.CreationDate;sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value}|ConvertTo-Json -Compress`],{encoding:'utf8',timeout:12000}));
 const keys=crypto.generateKeyPairSync('ed25519'),receipt=sign({...ack,owner_sid:identity.sid,producer_creation_date:identity.creation},keys.privateKey),boundary=verify(receipt,keys.publicKey,challenge);
 const result=await prepare({directory:path.join(dir,'epoch'),quote:ack.copies.quote,candle:ack.copies.candle,boundary,owner:identity.sid,manifest_hash:crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex')});
 assert.equal(result.receipt.status,'PREPARED_NOT_STARTED');assert.equal(result.receipt.continuity,'UNKNOWN');
 fs.writeFileSync(path.join(dir,'evidence.json'),JSON.stringify({ack,receipt,identity,hashes,prepared:result},null,2));console.log(JSON.stringify({status:'PASS',dir,source_bytes:'UNCHANGED_PRODUCTION_COPY',original_worker_ack:true,formal_collector_freeze_wiring:false,continuity:'UNKNOWN'}));
 }finally{await port.close();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
