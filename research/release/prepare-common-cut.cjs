'use strict';
const {sha}=require('./producer-handoff.cjs');
const {atomic,load}=require('./technical-control.cjs');
// Selects two verified committed prefixes; never asserts exchange-wide simultaneity.
function prepareCommonCut({control,quote,candle,file,generation,asOf,env={},betweenReads}){
 if(env.MP_RELEASE_PREP_PUBLISHER!=='1')return {status:'OFF'};
 control.check();if(control.stopped())return {status:'STOPPED'};
 if(!Number.isSafeInteger(generation)||generation<1||!Number.isFinite(Date.parse(asOf)))throw Error('CUT_INPUT');
 const first={quote:quote.read(),candle:candle.read()};
 if(betweenReads)betweenReads();
 const second={quote:quote.read(),candle:candle.read()};
 if(sha(first)!==sha(second))throw Error('CUT_MOVED_RETRY_NEXT_ROUND');
 const cut={contract:'producer-dual-cut-v1',scope:'ISOLATED_REVIEW',semantics:'SELECTED_COMMITTED_PREFIXES_NOT_GLOBAL_EVENT_TIME',owner:control.id,generation,asOf,gap:false,trade_date:first.quote.cursor.trade_date,states:{},targets:{},binding:{}};
 for(const kind of ['quote','candle']){const s=first[kind];if(s.owner!==control.id||s.cursor.kind!==kind||!s.cursor.trade_date||s.cursor.trade_date!==cut.trade_date||s.catalogue.epoch!==control.owner.epoch||s.catalogue.gap||s.cursor.sequence!==s.catalogue.published_through)throw Error('CUT_SOURCE');cut.states[kind]=sha(s);cut.targets[kind]={sequence:s.cursor.sequence,commit_hash:s.cursor.commit_hash};cut.binding[kind]=s.catalogue.binding;}
 control.check();if(control.stopped())return {status:'STOPPED'};
 atomic(file,cut);if(sha(load(file))!==sha(cut))throw Error('CUT_READBACK');
 return {status:'PREPARED',file,hash:sha(cut),formal_connected:false};
}
module.exports={prepareCommonCut};
