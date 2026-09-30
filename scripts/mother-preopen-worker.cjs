'use strict';
const path=require('node:path');
const {produce,atomic}=require('../lib/mother-preopen-service.cjs');
const {isTwseTradingDay}=require('./twse-trading-day');
const root=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime',actualStart=new Date().toISOString();
let health=null,healthAt=0,busy=false;
process.on('message',m=>{if(m?.type==='journal_health'){health=m.health;healthAt=Date.now();}});
process.on('disconnect',()=>process.exit(0));
async function tick(){if(busy)return;busy=true;const asOf=new Date().toISOString();
  try{if(Date.now()-healthAt>30000)throw Error('COLLECTOR_HEARTBEAT_MISSING');
    const decision=await isTwseTradingDay(new Date(),{stateDir:path.join(root,'state'),includeEvidence:true});
    const calendar={trade_date:decision.date,market:'TW',is_open:decision.isTradingDay,payload:{checked_at:new Date().toISOString(),calendar_decision:decision}};
    const result=produce({runtimeRoot:root,calendar,asOf:new Date().toISOString(),health,
      producerVersion:'mother-preopen-v1',actualStart});process.send?.({type:'preopen_status',...result});
  }catch(e){const status={status:'BLOCKED',reason:e.message,checked_at:asOf,complete:false,notifications_sent:0,orders_sent:0};
    try{atomic(path.join(root,'data','mother-pool','preopen',asOfDate(asOf),'producer-status.json'),status);}catch{}
    process.send?.({type:'preopen_status',...status});
  }finally{busy=false;}}
function asOfDate(t){return new Date(Date.parse(t)+28800000).toISOString().slice(0,10);}
setInterval(tick,15000); // No extra market connection; independent of Telegram UI.
