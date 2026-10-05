'use strict';
// Producer-neutral evidence archive. Archiving does not certify a formal signal or a win.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {canonical,hash}=require('./core.cjs');
function archiveRun(root, packet) {
  for(const key of ['producer_id','run_id','trade_date','capture_kind','declared_count','candidates','raw_run'])
    if(packet[key]===undefined||packet[key]===null) throw Error('MISSING_'+key);
  if(typeof packet.producer_id!=='string'||!packet.producer_id.trim()||typeof packet.run_id!=='string'||!packet.run_id.trim()) throw Error('INVALID_ID');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(packet.trade_date)||new Date(packet.trade_date).toISOString().slice(0,10)!==packet.trade_date) throw Error('INVALID_DATE');
  if(!['AT_SCAN_COMPLETION','RECOVERED_RECORD'].includes(packet.capture_kind)) throw Error('INVALID_CAPTURE_KIND');
  if(!Array.isArray(packet.candidates)||packet.declared_count!==packet.candidates.length) throw Error('COUNT_MISMATCH');
  // Preserve duplicate symbols, both directions and original row order without collapsing signals.
  const contentHash=hash(packet), key=hash([packet.producer_id,packet.run_id]);
  const directory=path.resolve(root,'runs'); fs.mkdirSync(directory,{recursive:true});
  const target=path.join(directory,key+'.json');
  const envelope={contract:'unified-raw-run-archive-v1',received_at:new Date().toISOString(),content_sha256:contentHash,statistical_eligibility:'NOT_ASSESSED',packet};
  const temporary=path.join(directory,'.'+key+'.'+crypto.randomUUID()+'.tmp');
  const fd=fs.openSync(temporary,'wx');
  try{fs.writeFileSync(fd,canonical(envelope)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  try {
    // Linking a fully written file publishes atomically and cannot replace an existing run.
    fs.linkSync(temporary,target);
    return {path:target,content_sha256:contentHash,count:packet.candidates.length,idempotent:false};
  } catch(error) {
    if(error.code!=='EEXIST') throw error;
    const old=JSON.parse(fs.readFileSync(target,'utf8'));
    if(old.content_sha256!==hash(old.packet)) throw Error('ARCHIVE_INTEGRITY_FAILURE');
    if(old.content_sha256!==contentHash) throw Error('RUN_CONTENT_CONFLICT');
    return {path:target,content_sha256:contentHash,count:packet.candidates.length,idempotent:true};
  } finally {fs.unlinkSync(temporary);}
}
function readRun(file){const value=JSON.parse(fs.readFileSync(file,'utf8'));if(value.contract!=='unified-raw-run-archive-v1'||hash(value.packet)!==value.content_sha256)throw Error('ARCHIVE_INTEGRITY_FAILURE');return value;}
module.exports={archiveRun,readRun};
