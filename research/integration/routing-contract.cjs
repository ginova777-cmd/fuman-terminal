'use strict';
// Offline contract only. No runtime imports, network, database or notification ports.
const crypto=require('node:crypto');
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function unique(xs){if(!Array.isArray(xs)||xs.some(s=>typeof s!=='string')||new Set(xs).size!==xs.length)throw Error('SYMBOL_SET_INVALID');return [...xs].sort();}
function bind({trade_date,epoch,activeSymbols,prioritySymbols,sourceAnchors}){
 const active=unique(activeSymbols),priority=unique(prioritySymbols);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(trade_date)||!epoch)throw Error('IDENTITY_INVALID');
 if(priority.some(s=>!active.includes(s)))throw Error('PRIORITY_OUTSIDE_UNIVERSE');
 if(!sourceAnchors||!Object.keys(sourceAnchors).length)throw Error('SOURCE_ANCHORS_REQUIRED');
 for(const a of Object.values(sourceAnchors))if(a.epoch!==epoch||a.trade_date!==trade_date||!Number.isSafeInteger(a.sequence)||a.sequence<0||!a.commit_hash)throw Error('SOURCE_ANCHOR_INVALID');
 const payload={contract:'phase234-offline-routing-v1',trade_date,epoch,active,priority,sourceAnchors:structuredClone(sourceAnchors),scope:'OFFLINE_ONLY',formal_authorized:false};
 return {payload,sha256:digest(payload)};
}
function route(envelope,{changedSymbols,candleSymbols,discovery,asOf}){
 if(envelope.sha256!==digest(envelope.payload))throw Error('CONTRACT_HASH_MISMATCH');
 const p=envelope.payload,changed=unique(changedSymbols),candles=unique(candleSymbols);
 if(p.formal_authorized!==false||p.scope!=='OFFLINE_ONLY')throw Error('FORMAL_USE_FORBIDDEN');
 if(!Number.isFinite(Date.parse(asOf))||new Date(Date.parse(asOf)+28800000).toISOString().slice(0,10)!==p.trade_date)throw Error('ASOF_DATE');
 if([...changed,...candles].some(s=>!p.active.includes(s)))throw Error('OUTSIDE_ACTIVE_UNIVERSE');
 if(discovery.status!=='OFFLINE_EVALUATED'||discovery.all_market_observed!==p.active.length)throw Error('DISCOVERY_SCOPE_UNVERIFIED');
 const members=unique(discovery.output.rows.map(r=>r.symbol));
 if(members.some(s=>!p.active.includes(s)))throw Error('MEMBERSHIP_OUTSIDE_ACTIVE');
 return {contract:p.contract,identity:envelope.sha256,as_of:asOf,sourceAnchors:p.sourceAnchors,
 strategy3:{members,admit:discovery.admissions.map(r=>r.symbol),exit:discovery.exits,changed:changed.filter(s=>members.includes(s))},
 telegram:{universe:p.active,changed:candles},
 formal_authorized:false,notifications_sent:0};
}
module.exports={bind,route,digest};
