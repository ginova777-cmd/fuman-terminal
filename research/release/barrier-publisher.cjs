'use strict';
const fs=require('fs'),path=require('path');
const {read,sha,local}=require('./producer-handoff.cjs');
const {atomic,load}=require('./technical-control.cjs');
// Sidecar preparation only; never enabled by the formal phase flags.
class BarrierPublisher {
 constructor({directory,control,env={}}){this.directory=directory;this.control=control;this.enabled=env.MP_RELEASE_PREP_PUBLISHER==='1';}
 publish({quote,candle,cutFile,fault}){
  if(!this.enabled)return {status:'OFF'};
  this.control.check();if(this.control.stopped())return {status:'STOPPED'};
  const dir=local(this.directory);fs.mkdirSync(dir,{recursive:true});const lock=path.join(dir,'barrier.lock'),fd=fs.openSync(lock,'wx');
  try{
   const cut=load(cutFile);if(cut.contract!=='producer-dual-cut-v1'||cut.scope!=='ISOLATED_REVIEW'||cut.owner!==this.control.id||cut.gap!==false||!Number.isSafeInteger(cut.generation)||cut.generation<1||!Number.isFinite(Date.parse(cut.asOf)))throw Error('CUT_IDENTITY');
   const states={quote:quote.read(),candle:candle.read()},binding={},targets={},hashes={},catalogues={};
   for(const kind of ['quote','candle']){const s=states[kind];if(s.cursor.kind!==kind||s.cursor.trade_date!==cut.trade_date||s.owner!==this.control.id||s.catalogue.epoch!==this.control.owner.epoch||s.cursor.sequence!==s.catalogue.published_through||cut.states[kind]!==sha(s)||cut.targets[kind].sequence!==s.cursor.sequence||cut.targets[kind].commit_hash!==s.cursor.commit_hash||cut.binding[kind]!==s.catalogue.binding)throw Error('CUT_SOURCE_MISMATCH');binding[kind]=s.catalogue.binding;targets[kind]=cut.targets[kind];
    const bytes=Buffer.from(JSON.stringify(s.catalogue)),h=sha(bytes),file=path.join(dir,h+'.catalogue.json');if(!fs.existsSync(file)){const f=fs.openSync(file,'wx');try{fs.writeFileSync(f,bytes);fs.fsyncSync(f);}finally{fs.closeSync(f);}}if(sha(read(file))!==h)throw Error('CATALOGUE_READBACK');hashes[kind]=h;catalogues[kind]=file;
   }
   const seal={contract:'dual-feed-barrier-v1',owner:this.control.id,asOf:cut.asOf,trade_date:cut.trade_date,generation:cut.generation,gap:false,binding,targets,catalogue_hashes:hashes,cut_hash:sha(cut)};
   const current=path.join(dir,'barrier.json');if(fs.existsSync(current)){const old=load(current);if(old.generation>seal.generation||old.generation===seal.generation&&sha(old)!==sha(seal))throw Error('BARRIER_REGRESSION_OR_CONFLICT');}
   if(this.control.stopped())return {status:'STOPPED'};atomic(current,seal,fault);if(sha(load(current))!==sha(seal))throw Error('BARRIER_READBACK');return {status:'PREPARED',barrierFile:current,catalogues,formal_connected:false};
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
 }
 rollback(){this.enabled=false;return {status:'OFF',evidence_preserved:true,formal_connected:false};}
}
module.exports={BarrierPublisher};
