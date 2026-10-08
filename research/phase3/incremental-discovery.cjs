'use strict';
const { hash } = require('./original-oracle.cjs');
const clone = structuredClone;
const digest = value => hash(JSON.stringify(value));
const RESOURCES = new Set(['quoteMap','dailyVolumeMap','intradayMap','capitalMap','chipMap','marginChangeMap','stockFutureInitialMap','stockGroupContractMap','preopenReferencePriceMap']);
function classifyCandle(evidence, verifyNoTrade) {
  if (evidence?.present === true) return 'PRESENT';
  if (evidence?.noTradeVerified === true && evidence?.nativeEvidenceHash && evidence?.continuousObservation === true && evidence?.unpublishedEvent === false
    && typeof verifyNoTrade==='function' && verifyNoTrade(evidence)===true) return 'NO_TRADE_OBSERVED';
  return 'MISSING_OR_UNKNOWN';
}
class IncrementalDiscovery {
  constructor({ oracle, maxSymbols = 5000, maxEvents = 5000, maxBytes = 8 * 1024 * 1024 }) {
    this.oracle = oracle; this.limits = { maxSymbols,maxEvents,maxBytes }; this.state = null; this.stopped = false;
  }
  baseline(snapshot) {
    if (this.stopped) throw Error('STOPPED');
    if (!snapshot.epoch || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.tradeDate) || !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence<0) throw Error('BASELINE_IDENTITY_INVALID');
    if (snapshot.activeSymbols.length > this.limits.maxSymbols || new Set(snapshot.activeSymbols.map(r=>r.symbol)).size!==snapshot.activeSymbols.length) throw Error('UNIVERSE_INVALID');
    this.state = clone(snapshot); this.members = new Set(); this.oracle.invalidate(); this.lastBatchHash = null;
  }
  input(state) {
    const supplementalMaps = Object.fromEntries(Object.entries(state.supplementalMaps||{}).map(([k,rows])=>[k,new Map(rows)]));
    return { activeSymbols:state.activeSymbols, dailyVolumeMap:new Map(state.dailyVolumeMap),quoteMap:new Map(state.quoteMap),supplementalMaps,
      identity:state.identity, readMemoryJson:(file,fallback)=>clone(state.artifacts?.[require('path').basename(file)] ?? fallback) };
  }
  process(batch) {
    if(this.stopped) return {status:'STOPPED',published:false};
    if(!this.state) throw Error('BASELINE_REQUIRED');
    if(batch.continuity!=='CONTIGUOUS') return {status:'BLOCKED',reason:'FULL_BASELINE_RECOVERY_REQUIRED',published:false};
    const bytes=Buffer.byteLength(JSON.stringify(batch));
    if(!Array.isArray(batch.events)||batch.events.length>this.limits.maxEvents||bytes>this.limits.maxBytes) return {status:'BLOCKED',reason:'CAPACITY_LIMIT',published:false};
    if(batch.epoch!==this.state.epoch||batch.tradeDate!==this.state.tradeDate) return {status:'BLOCKED',reason:'IDENTITY_MISMATCH',published:false};
    const body=digest(batch);
    if(batch.sequence===this.state.sequence && body===this.lastBatchHash) return {status:'REPLAY_DEDUP',published:false};
    if(batch.sequence!==this.state.sequence+1) return {status:'BLOCKED',reason:'SEQUENCE_GAP_OR_CONFLICT',published:false};
    const next=clone(this.state), changed=new Set();
    const active=new Set(next.activeSymbols.map(r=>r.symbol));
    let duplicates=0;
    try {
      const stamp=Date.parse(batch.asOf);
      if(!Number.isFinite(stamp)||new Date(stamp+28800000).toISOString().slice(0,10)!==next.tradeDate)throw Error('ASOF_DATE_INVALID');
      if(next.lastAsOf && stamp<Date.parse(next.lastAsOf))throw Error('ASOF_REGRESSION');
      const resourceMaps=new Map();
      for(const event of batch.events) {
        if(!RESOURCES.has(event.resource)||!active.has(event.symbol)) throw Error('RESOURCE_OR_UNIVERSE_INVALID');
        const target=['quoteMap','dailyVolumeMap'].includes(event.resource)?next:next.supplementalMaps;
        if(!resourceMaps.has(event.resource))resourceMaps.set(event.resource,{target,map:new Map(target[event.resource]||[])});
        const map=resourceMaps.get(event.resource).map;
        if(digest(map.get(event.symbol)??null)===digest(event.value??null)){duplicates++;continue;}
        if(event.value===null)map.delete(event.symbol);else map.set(event.symbol,clone(event.value));
        if(!resourceMaps.get(event.resource).dirty)target[event.resource]=target[event.resource]||[];
        resourceMaps.get(event.resource).dirty=true; changed.add(event.symbol);
      }
      for(const [resource,{target,map,dirty}]of resourceMaps)if(dirty)target[resource]=[...map];
      // Global rank, leader and allocation dependencies are deliberately rebuilt.
      // A clock change invalidates all metric values, including freshness/volume projection.
      const output=this.oracle.evaluate(this.input(next),{asOf:batch.asOf,changedSymbols:[...changed],invalidateAll:batch.contextChanged===true});
      const membership=new Set(output.rows.map(r=>r.symbol));
      if(membership.size!==output.rows.length)throw Error('ORACLE_DUPLICATE_MEMBER');
      const entered=[...membership].filter(s=>!this.members.has(s));
      const exited=[...this.members].filter(s=>!membership.has(s));
      next.sequence=batch.sequence;next.lastAsOf=batch.asOf; this.state=next;this.members=membership;this.lastBatchHash=body;
      return {status:'OFFLINE_EVALUATED',published:false,sequence:batch.sequence,all_market_observed:active.size,changed_symbols:[...changed],duplicates,
        admissions:entered.map(symbol=>({symbol,as_of:batch.asOf,type:new Date(Date.parse(batch.asOf)+28800000).toISOString().slice(11,16)>='12:30'?'LATE_ADMISSION':'ADMISSION'})),exits:exited,output,
        dependency_scope:'FULL_GLOBAL_RANKING_REBUILD; METRICS_REUSED_ONLY_SAME_ASOF',formal_entry_authorization:false};
    } catch(error) { this.oracle.invalidate(); return {status:'BLOCKED',reason:error.message,published:false}; }
  }
  checkpoint() { const payload={state:this.state,members:[...this.members],lastBatchHash:this.lastBatchHash};return {contract:'phase3-offline-checkpoint-v1',payload,sha256:digest(payload)}; }
  restore(envelope) { if(envelope.contract!=='phase3-offline-checkpoint-v1'||envelope.sha256!==digest(envelope.payload))throw Error('CHECKPOINT_HASH_MISMATCH');this.baseline(envelope.payload.state);this.members=new Set(envelope.payload.members);this.lastBatchHash=envelope.payload.lastBatchHash; }
  stop() { this.stopped=true; }
}
module.exports={IncrementalDiscovery,classifyCandle,digest};
