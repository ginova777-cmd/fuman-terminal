'use strict';
// Read-only frozen C2 source copies -> existing isolated continuous adapter.
const fs=require('fs'),path=require('path');
const {readCommittedSegment,snapshotManifest}=require('../phase2/incremental-writer.cjs');
const {ProductionAdapter}=require('./production-adapter.cjs');
const {OfflineStore}=require('../integration/offline-store.cjs');
const {digest}=require('../integration/coordinator.cjs');
function isolated(p){const resolved=path.resolve(p);if(/fuman-runtime|fuman-release-owner|prod81/i.test(resolved))throw Error('FORMAL_SOURCE_NOT_AUTHORIZED');if(fs.lstatSync(resolved).isSymbolicLink())throw Error('SOURCE_LINK_FORBIDDEN');return resolved;}
class ProducerAdapter{
 constructor({directory,env={},sources,stop=()=>false}){this.directory=directory;this.sources=sources;this.stop=stop;this.adapter=new ProductionAdapter({directory,env,stop,port:{scope:'ISOLATED',contract:'phase234-file-port-v1',version:'c2-producer-snapshot-v1'}});}
 async run({asOf,gate,plan=null,fault}){
  // OFF delegates to the unchanged formal owner; never reads input or creates state.
  if(!this.adapter.enabled.some(Boolean))return {status:'OFF',legacy_path_unchanged:true,formal_connected:false};
  if(this.stop())return {status:'STOPPED',formal_connected:false};
  const store=new OfflineStore(this.directory),root=store.root(),base=store.get(JSON.parse(fs.readFileSync(path.join(this.directory,'baseline.json'))).hash);
  if(!Array.isArray(this.sources)||this.sources.length!==2||new Set(this.sources.map(s=>s.kind)).size!==2||!this.sources.every(s=>['quote','candle'].includes(s.kind)))throw Error('SOURCE_SET_REQUIRED');
  const previous=root?store.get(root.sourceCursor.intent_hash).producer:null;
  const binding=this.sources.map(s=>({kind:s.kind,epoch:s.epoch,producer_version:s.producer_version,source_id:s.source_id})).sort((a,b)=>a.kind.localeCompare(b.kind));
  if(binding.some(s=>!s.epoch||!s.source_id||(s.kind==='quote'&&!s.producer_version)||(s.kind==='candle'&&s.producer_version!==null)))throw Error('PRODUCER_IDENTITY_REQUIRED');
  if(previous&&digest(binding)!==digest(previous.binding))throw Error('PRODUCER_IDENTITY_DRIFT');
  const parts=[],events=[];
  for(const s of [...this.sources].sort((a,b)=>a.kind.localeCompare(b.kind))){
   if(this.stop())return {status:'STOPPED',formal_connected:false};
   const dir=isolated(s.directory),manifest=snapshotManifest(dir);
   if(manifest.hash!==s.manifest_hash)throw Error('SOURCE_SNAPSHOT_HASH');
   for(const [name]of manifest.entries.filter(([n])=>n.endsWith('.prepare.json'))){const b=JSON.parse(fs.readFileSync(path.join(dir,name)));const version=b.producer_version||b.intent?.producer_version||null;if(version!==s.producer_version)throw Error('PRODUCER_VERSION_MISMATCH');}
   const cp=previous?.parts.find(p=>p.kind===s.kind)?.next||null;
   const result=readCommittedSegment({dir,kind:s.kind,epoch:s.epoch,tradeDate:base.binding.payload.trade_date,checkpoint:cp,continuityProof:{status:'OFFLINE_FIXED_SEGMENT',epoch:s.epoch,manifest_hash:manifest.hash}});
   parts.push({kind:s.kind,producer_version_evidence:s.kind==='candle'?'NOT_EMBEDDED_IN_V3_PARENT':'EMBEDDED_IN_PREPARE',source_id:s.source_id,manifest_hash:manifest.hash,previous:cp,next:result.next,event_ids:result.events.map(e=>e.event_id),changed_keys:result.changedCandleKeys});
   for(const raw of result.rows){const payload=structuredClone(raw),symbol=String(raw.code||raw.symbol);events.push({type:s.kind==='quote'?'QUOTE':'CANDLE',symbol,payload,payload_sha256:digest(payload)});}
  }
  // Verify both immutable snapshots again after combined read, before any publication.
  for(const s of this.sources)if(snapshotManifest(isolated(s.directory)).hash!==s.manifest_hash)throw Error('SOURCE_CHANGED_DURING_READ');
  const producer={contract:'c2-producer-snapshot-adapter-v1',scope:'OFFLINE_FIXED_SEGMENTS_ONLY',binding,parts};
  const lastFrame=root?store.get(root.sourceCursor.intent_hash):null;
  if(lastFrame&&lastFrame.asOf===asOf&&digest(lastFrame.producer.parts.map(p=>p.next))===digest(parts.map(p=>p.next))){
   if(digest(lastFrame.producer.binding)!==digest(binding)||digest(lastFrame.producer.parts.map(p=>p.manifest_hash))!==digest(parts.map(p=>p.manifest_hash))||digest(lastFrame.gate)!==digest(gate)||digest(lastFrame.plan||null)!==digest(plan))throw Error('PRODUCER_REPLAY_CONFLICT');
   return this.adapter.runIncremental(lastFrame,{fault});
  }
  const frame={epoch:base.binding.payload.epoch,trade_date:base.binding.payload.trade_date,status:'OFFLINE_FIXED_SEGMENT',sequence:(root?.sequence||0)+1,asOf,events,gate,plan,producer};
  const result=await this.adapter.runIncremental(frame,{fault});
  if(result.root){const independent=new OfflineStore(this.directory),saved=independent.get(result.root.sourceCursor.intent_hash);if(digest(saved.producer)!==digest(producer))throw Error('PRODUCER_CURSOR_READBACK');}
  return {...result,producer,continuity:'OFFLINE_FIXED_SEGMENTS_ONLY',production_continuity_verified:false};
 }
 rollback(){return this.adapter.rollback();}
}
module.exports={ProducerAdapter};
