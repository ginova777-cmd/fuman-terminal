'use strict';
// Offline child-only test harness. Never loaded by a formal launcher.
const Module=require('node:module'),original=Module._load;
const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
Module._load=function(name,parent,isMain){
 if(name.endsWith('futopt-catalogue-retry.cjs'))return {createCatalogueRetry:()=>async()=>({status:'ready',catalogue:{trade_date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())}})};
 if(name.endsWith('stock-future-standard-runtime.cjs'))return {refresh:async()=>({}),resolve:()=>({resolutions:[]})};
 if(name.endsWith('futopt-collector-catalogue'))return {build:()=>[{future_symbol:'TXFJ6',underlying_symbol:'TXF',product:'TXF',end_date:'2099-10-30',underlying_name:'fixture'}]};
 if(name.endsWith('futopt-txf-reference.cjs'))return {createReader:()=>()=>({txf_reference:{future_symbol:'TXFJ6',trade_date:yesterday}})};
 if(name.endsWith('txf-candle-recovery.cjs'))return {createRecovery:()=>async()=>({status:'fixture-no-rest'})};
 if(name.endsWith('server-supabase-key'))return {serverSupabaseKey:()=>'',serverSupabaseUrl:()=>''};
 return original.call(this,name,parent,isMain);
};
global.fetch=()=>{throw Error('NETWORK_FORBIDDEN_OFFLINE_TEST');};
global.WebSocket=class extends EventTarget {
 static OPEN=1;
 constructor(){super();this.readyState=1;setTimeout(()=>this.dispatchEvent(new Event('open')),5);}
 emit(payload){const e=new Event('message');e.data=JSON.stringify(payload);this.dispatchEvent(e);}
 send(text){const r=JSON.parse(text);if(r.event==='auth')setTimeout(()=>this.emit({event:'authenticated'}),5);else if(!this.sent){this.sent=true;setTimeout(()=>{
  this.emit({event:'data',channel:'trades',data:{symbol:'TXFJ6',price:100,size:1,volume:1,time:Date.now()*1000,serial:7}});
  this.emit({event:'data',channel:'candles',data:{symbol:'TXFJ6',date:yesterday+'T09:00:00+08:00',open:100,high:101,low:99,close:100,volume:5}});
 },5);}}
 close(){this.readyState=3;setTimeout(()=>this.dispatchEvent(new Event('close')),1);}
};
