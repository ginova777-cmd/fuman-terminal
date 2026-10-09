'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{local}=require('./producer-handoff.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function build(root,expectedHash){root=local(root);const file=path.join(root,'scripts/fugle-websocket-collector.js'),raw=fs.readFileSync(file);if(hash(raw)!==expectedHash)throw Error('COLLECTOR_SOURCE_DRIFT');let s=raw.toString('utf8');
 function once(a,b){if(s.split(a).length!==2)throw Error('PATCH_ANCHOR_NOT_UNIQUE');s=s.replace(a,b);}
 once('let pendingStreamingQuotes = [];','let isolatedFrozen=false, isolatedOriginalAck=null;\nlet pendingStreamingQuotes = [];');
 for(const [fn,arg]of [['mergeStreamingQuotes','newQuotes'],['mergeStreamingCandles','newCandles']])once(`function ${fn}(${arg}, flush = false) {`,`function ${fn}(${arg}, flush = false) {\n  if(isolatedFrozen && !flush)throw Error('INTAKE_FROZEN');`);
 once('file: FUGLE_WS_CANDLES_FILE,',`file: FUGLE_WS_CANDLES_FILE,
    spawn: options => {const w=new (require('node:worker_threads').Worker)(path.join(__dirname,'../lib/daytrade-candle-save-worker.js'),{...options,resourceLimits:{maxOldGenerationSizeMb:128}});w.on('message',m=>{if(m.ok===true&&Number.isSafeInteger(m.sequence))isolatedOriginalAck=structuredClone(m);});return w;},`);
 s+=`\n// Isolated candidate adapter only. The original release is not modified.
module.exports.isolatedIntake={
 quote:mergeStreamingQuotes,candle:mergeStreamingCandles,
 async freeze(challenge){
 if(isolatedFrozen)throw Error('ALREADY_FROZEN');isolatedFrozen=true;
 clearTimeout(streamingQuoteFlushTimer);clearTimeout(streamingCandleFlushTimer);
 const q=pendingStreamingQuotes,k=pendingStreamingCandles;pendingStreamingQuotes=[];pendingStreamingCandles=[];
 mergeStreamingQuotes(q,true);mergeStreamingCandles(k,true);streamingCandleStore.flush();
 const started=Date.now();while(true){const st=streamingCandleStore.status();if(!st.ok||st.persistenceGap)throw Error('SAVE_GAP');if(!st.pendingRows&&!st.inflightRows&&!st.queuedFiles)break;if(Date.now()-started>120000)throw Error('DRAIN_TIMEOUT');await new Promise(r=>setTimeout(r,50));}
 if(!isolatedOriginalAck)throw Error('ORIGINAL_ACK_MISSING');
 const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
 return {scope:'ISOLATED_REVIEW',challenge,frozen:true,quote:FUGLE_WS_QUOTES_FILE,candle:FUGLE_WS_CANDLES_FILE,hashes:{quote:digest(FUGLE_WS_QUOTES_FILE),candle:digest(FUGLE_WS_CANDLES_FILE)},original_ack:isolatedOriginalAck,continuity:'UNKNOWN',ack_at:new Date().toISOString()};
 }
};\n`;
 fs.writeFileSync(file,s);return {source_sha256:expectedHash,modified_sha256:hash(Buffer.from(s)),file,formal_modified:false};
}
module.exports={build};
