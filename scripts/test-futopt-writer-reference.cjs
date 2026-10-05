'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const text=fs.readFileSync(require.resolve('./run-daytrade-source-writer.js'),'utf8');
const start=text.indexOf('async function syncWebSocketFutoptQuotes() {');
const body=text.slice(start,text.indexOf('function taipeiClockMinutesFrom',start));
const event='2026-10-05T01:00:00.000Z';
const quote={future_symbol:'DYFJ6',underlying_symbol:'1102',last_price:35.4,payload:{txf_reference:{bad:true},txf_reference_status:'OLD'}};
async function run(reference){
 let written,called=0;
 const req=p=>p.includes('futopt-txf-reference')?{createReader:()=>((at)=>{assert.equal(at,event);called++;return reference;})}:{futuresEventTime:()=>({ok:true,event_at:event,received_at:event,source_field:'time'})};
 const fn=new Function('require','runtimePath','readFugleFutoptWebSocketQuotes','FUTOPT_WEBSOCKET_MAX_AGE_MS','numberValue','normalizeCode','supabaseUpsert','SLOW_TABLE_BATCH_SIZE',body+'; return syncWebSocketFutoptQuotes;')(req,()=>'/fixture',()=>({quotes:new Map([['DYFJ6',quote]]),payload:{}}),180000,x=>x??null,x=>x,async(table,rows)=>{written=rows;},20);
 await fn();assert.equal(called,1);assert.equal(written[0].updated_at,event);assert.equal(written[0].last_price,35.4);assert.deepEqual(written[0].payload.txf_reference,reference.txf_reference);assert.equal(written[0].payload.txf_reference_status,reference.txf_reference_status);
}
(async()=>{await run({txf_reference:{contract:'fugle-txf-reference-v1',future_symbol:'TXFJ6'},txf_reference_status:'VERIFIED_CATALOGUE'});await run({txf_reference:null,txf_reference_status:'CATALOGUE_UNVERIFIED'});console.log('PASS writer preserves validated reference, rejects unavailable evidence, and preserves event time/price; no network');})().catch(e=>{console.error(e);process.exitCode=1;});
