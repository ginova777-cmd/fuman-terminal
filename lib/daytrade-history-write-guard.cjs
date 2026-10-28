'use strict';
// Candidate shared module. No IO. One guard belongs to one fixed history pass.
// A live write overlapping that snapshot invalidates the pass before another
// history POST or completion claim. The caller must take a new source snapshot.
function create(rows, fingerprint) {
  if(typeof fingerprint!=='function')throw Error('HISTORY_FINGERPRINT_REQUIRED');
  const key=row=>row.symbol+'|'+new Date(row.candle_time).toISOString();
  const hash=row=>{
    const value={...row,payload:{...row.payload},candle_time:new Date(row.candle_time).toISOString()};
    // These two validated adapters wrap the same native candle differently.
    // Normalize only their known wrapper fields; preserve OHLCV, source event
    // time, raw hashes, volume provenance and all other payload fields.
    if(['fugle_daytrade_writer:websocket_candles','fugle_daytrade_fast_sync:websocket_candles'].includes(value.source)
      &&value.payload.originalSource==='fugle-ws-candles'
      &&value.payload.originalChannel==='candles'&&value.payload.candleOrigin==='websocket_candle'){
      value.source='fugle_daytrade_fast_sync:websocket_candles';
      value.source_channel??='candles';value.candle_origin??='websocket_candle';
      value.websocket_row??=true;value.rest_repair_row??=false;value.intraday_odd_lot??=false;
      if(value.payload.source==='fugle-websocket-candles-cache')delete value.payload.source;
    }
    return fingerprint(value);
  };
  const keys=new Map();
  for(const row of rows){
    const id=key(row),value=hash(row);
    if(keys.has(id)&&keys.get(id)!==value)throw Error('HISTORY_SOURCE_CONFLICT');
    keys.set(id,value);
  }
  let invalidated=false;
  return Object.freeze({
    beforeLiveWrite(rows) {
      if(rows.some(row=>keys.has(key(row))&&keys.get(key(row))!==hash(row)))invalidated=true;
    },
    assertCurrent() {
      if(invalidated){
        const error=new Error('CANDLE_HISTORY_SOURCE_SUPERSEDED');
        error.code='CANDLE_HISTORY_SOURCE_SUPERSEDED';
        throw error;
      }
    },
    get invalidated(){return invalidated;}
  });
}
const active=new Map();
const runtimeKey=runtime=>require('node:path').resolve(runtime).toLowerCase();
async function withScope(runtime,run){
 const id=runtimeKey(runtime);
 if(active.has(id))throw Error('HISTORY_SCOPE_ALREADY_ACTIVE');
 const scope={guard:null};
 active.set(id,scope);
 try{return await run();}finally{active.delete(id);}
}
async function withSnapshot(runtime,rows,fingerprint,run){
 const id=runtimeKey(runtime),scope=active.get(id);
 if(!scope)return withScope(runtime,()=>withSnapshot(runtime,rows,fingerprint,run));
 if(!scope.guard)scope.guard=create(rows,fingerprint);
 scope.guard.assertCurrent();
 const result=await run(scope.guard);
 scope.guard.assertCurrent();
 return result;
}
function beforeLiveWrite(runtime,rows){
 active.get(runtimeKey(runtime))?.guard?.beforeLiveWrite(rows);
}
function assertCurrent(runtime){active.get(runtimeKey(runtime))?.guard?.assertCurrent();}
module.exports={create,withScope,withSnapshot,beforeLiveWrite,assertCurrent};
