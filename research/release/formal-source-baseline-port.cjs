'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{Worker}=require('worker_threads');
const {local}=require('./producer-handoff.cjs');
const {hashFile}=require('../../lib/mother-evidence-recovery-stream.cjs');
// Isolated adapter around unchanged production store/worker bytes. Not a live RPC.
function create({sourceRoot,directory}){
 sourceRoot=local(sourceRoot);directory=local(directory);fs.mkdirSync(directory,{recursive:true});
 const quote=path.join(directory,'quote.json'),candle=path.join(directory,'candle.json');
 const {writeJson}=require(path.join(sourceRoot,'lib/fugle-websocket-quotes.js'));
 const {createSpooledCandleStore}=require(path.join(sourceRoot,'lib/daytrade-spooled-candle-store.js'));
 let frozen=false,worker=null,lastAck=null,lastSequence=0;
 const store=createSpooledCandleStore({file:candle,retentionMs:30*86400000,flushDelayMs:20,spawn:options=>{
   worker=new Worker(path.join(sourceRoot,'lib/daytrade-candle-save-worker.js'),{...options,resourceLimits:{maxOldGenerationSizeMb:128}});
   worker.on('message',m=>{if(m.ok===true&&Number.isSafeInteger(m.sequence)){lastAck=structuredClone(m);lastSequence=m.sequence;}});return worker;
 }});
 return {quote,candle,mergeQuote(rows){if(frozen)throw Error('BOUNDARY_FROZEN');writeJson(quote,{quotes:rows});},mergeCandles(rows){if(frozen)throw Error('BOUNDARY_FROZEN');return store.merge(rows);},
 async freeze(challenge){if(frozen)throw Error('ALREADY_FROZEN');frozen=true;store.flush();const started=Date.now();
   while(true){const s=store.status();if(s.persistenceGap||!s.ok)throw Error('SAVE_GAP');if(!s.pendingRows&&!s.inflightRows&&!s.queuedFiles)break;if(Date.now()-started>120000)throw Error('DRAIN_TIMEOUT');await new Promise(r=>setTimeout(r,250));}
   if(!lastAck||!fs.existsSync(quote)||!fs.existsSync(candle))throw Error('ORIGINAL_ACK_REQUIRED');
   const before={quote:hashFile(quote).sha256,candle:hashFile(candle).sha256};
   const copies={quote:path.join(directory,'quote.snapshot.json'),candle:path.join(directory,'candle.snapshot.json')};
   for(const [kind,file]of Object.entries({quote,candle})){const r=hashFile(file,536870912,copies[kind]);if(r.sha256!==before[kind]||hashFile(file).sha256!==before[kind])throw Error('SNAPSHOT_MOVED');}
   return {scope:'ISOLATED_REVIEW',epoch:crypto.randomUUID(),challenge,frozen:true,pendingRows:0,queuedFiles:0,sequence:lastSequence,producer_pid:process.pid,worker_thread_id:worker.threadId,ack_at:new Date().toISOString(),hashes:before,copies,original_save_ack:lastAck,status:'PREPARED',continuity:'CONTINUITY_UNKNOWN',formal_verified:false};
 },close:()=>store.stop()};
}
module.exports={create};
