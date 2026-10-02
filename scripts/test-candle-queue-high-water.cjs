'use strict';
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createAsyncCandleStore}=require('../lib/daytrade-async-candle-store');
let flushed=0,cancelled=0;const sent=[],worker=new EventEmitter();worker.postMessage=m=>sent.push(m);worker.unref=()=>{};
const store=createAsyncCandleStore({file:'unused',flushDelayMs:5000,spawn:()=>worker,setFlushTimer:()=>1,clearFlushTimer:()=>cancelled++,setTimer:()=>null,clearTimer:()=>{}});
const rows=Array.from({length:5000},(_,i)=>({symbol:String(1000+i%1000),candleTime:new Date(Date.UTC(2026,9,2,1,Math.floor(i/1000))).toISOString(),close:100}));
store.merge(rows.slice(0,4999));assert.equal(sent.length,0);store.merge(rows.slice(4999));assert.equal(sent.length,1);assert.equal(sent[0].rows.length,5000);assert.equal(store.status().pendingRows,0);assert(cancelled>0);
store.merge(rows.map(r=>({...r,candleTime:'2026-10-02T02:00:00Z'})));assert.equal(sent.length,1,'only one in flight');worker.emit('message',{sequence:1,ok:true,count:5000});assert.equal(store.status().persistenceGap,false);
console.log('PASS snapshot flushes at 5000 before timer, cancels timer, and keeps one in-flight batch');
