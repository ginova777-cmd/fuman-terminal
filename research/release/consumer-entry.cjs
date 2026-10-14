'use strict';
const fs=require('fs'),path=require('path');
const {DualFeedConsumer}=require('./dual-feed-consumer.cjs');
const {ConsumerReader,phases,separate}=require('./consumer-readers.cjs');
const {flags}=require('./wiring.cjs');
const {local}=require('./producer-handoff.cjs');
const {atomic,load}=require('./technical-control.cjs');
const {digest}=require('../integration/coordinator.cjs');
class ConsumerEntry {
 constructor(config){
  if(config.scope!=='ISOLATED_REVIEW')throw Error('FORMAL_ENTRY_NOT_APPROVED');
  this.config=config;this.enabled=flags(config.env||{});this.directory=local(config.directory);this.control=config.control;
  const expected=Object.keys(phases).filter(r=>this.enabled[phases[r]-2]);
  const readers=config.readers||[];
  if(readers.length!==expected.length||new Set(readers.map(r=>r.id)).size!==readers.length||expected.some(role=>readers.filter(r=>r.role===role).length!==1))throw Error('CONSUMER_SET');
  for(const r of readers)separate(this.directory,r.cursorDirectory);
  this.readers=expected.map(role=>new ConsumerReader({...config,...readers.find(r=>r.role===role),stop:()=>this.control.stopped()}));
  this.dual=new DualFeedConsumer({directory:this.directory,env:config.env||{},control:this.control});
 }
 drain(){return this.readers.map(reader=>{const result=reader.read();if(!result.proof)throw Error('CONSUMER_NOT_READY');return reader.ack(result.proof);});}
 async run(args){
  if(!this.enabled.some(Boolean))return {status:'OFF',formal_connected:false};
  this.control.check();if(this.control.stopped())return {status:'STOPPED',formal_connected:false};
  if(digest({quote:args.quote?.identity?.binding,candle:args.candle?.identity?.binding})!==digest(this.config.sourceBinding))throw Error('CONSUMER_SOURCE_IDENTITY');
  const lock=path.join(this.directory,'consumer-entry.lock'),fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));
  try{
   const binding={flags:this.enabled,readers:this.readers.map(r=>({binding:r.binding,cursorDirectory:r.dir}))},file=path.join(this.directory,'consumer-entry-binding.json');
   if(fs.existsSync(file)){if(digest(load(file))!==digest(binding))throw Error('CONSUMER_SET_REBASE_REQUIRED');}else atomic(file,binding);
   // Finish every reader of the last root before publishing a later root.
   if(fs.existsSync(path.join(this.directory,'root.json')))this.drain();
   const result=await this.dual.run(args);
   if(args.fault==='BEFORE_CONSUMER_ACK')throw Error('CRASH_BEFORE_CONSUMER_ACK');
   const acknowledgements=result.root?this.drain():[];
   return {...result,acknowledgements,formal_connected:false,notifications_sent:0};
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
 }
 rollback(){this.enabled=[false,false,false];this.readers.forEach(r=>r.rollback());return {status:'BYPASSED',route:'LEGACY_READER',formal_connected:false};}
}
module.exports={ConsumerEntry};
