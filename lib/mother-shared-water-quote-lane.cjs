'use strict';
// One in-process lane for the existing Writer. It is not a cross-process lock;
// the existing database lease remains mandatory at every actual write.
function createLane(){
 let tail=Promise.resolve(),failed=false;const heads=new Map();
 return {run(rows,send){
  const frozen=structuredClone(rows);
  const work=tail.then(async()=>{
   if(failed)throw Error('QUOTE_LANE_PREVIOUS_OUTCOME_UNCONFIRMED');
   if(!Array.isArray(frozen)||frozen.length>2000||new Set(frozen.map(x=>x.symbol)).size!==frozen.length)throw Error('QUOTE_LANE_ROWS_INVALID');
   for(const row of frozen){
    const at=Date.parse(row.quote_seen_at),old=heads.get(row.symbol);
    if(!/^\d{4}$/.test(row.symbol)||!/^\d{4}-\d{2}-\d{2}$/.test(row.trade_date)||!Number.isFinite(at))throw Error('QUOTE_LANE_IDENTITY_INVALID');
    if(old&&(row.trade_date<old.trade_date||at<old.at||Number.isFinite(old.trade)&&(!Number.isFinite(Date.parse(row.last_trade_time))||Date.parse(row.last_trade_time)<old.trade)))throw Error('QUOTE_LANE_OLDER_EVENT_REJECTED');
   }
   let result;
   try{result=await send(frozen);}catch(error){failed=true;throw error;}
   for(const row of frozen)heads.set(row.symbol,{trade_date:row.trade_date,at:Date.parse(row.quote_seen_at),trade:Date.parse(row.last_trade_time)});
   return result;
  });
  tail=work.catch(()=>{});return work;
 }};
}
const writerLane=createLane();
module.exports={createLane,writerLane};
