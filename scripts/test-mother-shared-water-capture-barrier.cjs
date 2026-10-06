'use strict';
const assert=require('node:assert/strict');
const {waitForCapture}=require('../lib/mother-shared-water-writer-round.cjs');
const start=Date.parse('2026-10-06T05:00:00Z');
function args(mode){let tick=start,reads=0;return {after:new Date(start).toISOString(),connectionId:'c',deadline:start+1000,now:()=>tick,sleep:async ms=>{tick+=ms;},read:async()=>{reads++;return {contract:'mother-shared-water-capture-v1',stored:true,closed:mode==='closed',authenticated:true,connection_id:mode==='reconnected'?'other':'c',captured_at:mode==='missing'?null:new Date(mode==='future'?tick+100:mode==='fresh'&&reads>1?tick:start).toISOString()};}};}
(async()=>{let cases=0;const r=await waitForCapture(args('fresh'));assert.ok(Date.parse(r.captured_at)>start);cases++;
 for(const [mode,error]of [['stale',/WAIT_TIMEOUT/],['closed',/NOT_ACTIVE/],['reconnected',/CONNECTION_CHANGED/],['missing',/TIME_INVALID/],['future',/TIME_INVALID/]]){await assert.rejects(()=>waitForCapture(args(mode)),error);cases++;}
 const initial=args('stale');delete initial.after;assert.equal((await waitForCapture(initial)).connection_id,'c');cases++;
 console.log(JSON.stringify({ok:true,cases,mode:'isolated_clock_no_live_wait',production_connected:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
