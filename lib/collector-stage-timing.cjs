'use strict';
const {performance}=require('node:perf_hooks');
const NAMES=['message','subscription','side_journal','trade_journal','preopen_journal','normalize_candle','quote_flush','candle_flush'];
function create({clock=()=>performance.now()}={}){
 const since=clock(),cpu=process.cpuUsage();
 const counters=Object.fromEntries(NAMES.map(name=>[name,{calls:0,total_ms:0,max_ms:0}]));
 function run(name,fn){if(!Object.hasOwn(counters,name))throw Error('UNKNOWN_TIMING_STAGE');const start=clock();try{return fn();}finally{const ms=Math.max(0,clock()-start),c=counters[name];c.calls++;c.total_ms+=ms;c.max_ms=Math.max(c.max_ms,ms);}}
 function snapshot(){const usage=process.cpuUsage(cpu);return {contract:'collector_stage_timing_v1',elapsed_ms:Math.max(0,clock()-since),cpu_user_ms:usage.user/1000,cpu_system_ms:usage.system/1000,stages:Object.fromEntries(NAMES.map(name=>[name,{...counters[name]}])),note:'nested stages overlap; cumulative synchronous time only'};}
 return {run,snapshot};
}
module.exports={create};

