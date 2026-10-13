'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {createJournal}=require('./provider-journal-background.cjs');
function create({journalRoot,evidenceRoot,epoch=crypto.randomUUID(),journalOptions={},evidenceOptions={}}){
 let current=null,chain=Promise.resolve(),heads={},failure=null,ordinal=0;
 const sessions=[];
 async function closeCurrent(at){
  if(!current)return;const s=current;current=null;let health;
  try{health=await s.journal.close();heads=health.segment_evidence?.heads||heads;}catch(e){failure=e.message;health={error:e.message};}
  const receipt={...s.meta,status:health.ok&&health.segment_evidence?.status==='CAPTURED_ONLY'&&!health.gap_evidence?.error?'CLOSED':'GAP',closed_at:at,health};
  try{await fs.writeFile(path.join(s.dir,'session-closed.json'),JSON.stringify(receipt),{flag:'wx'});}catch(e){failure=e.code||e.message;}
 }
 function open(connection_id,at){
  chain=chain.then(async()=>{await closeCurrent(at);const sequence=++ordinal,dir=path.join(evidenceRoot,epoch,String(sequence).padStart(6,'0'));
   await fs.mkdir(dir,{recursive:true});const meta={contract:'trade_journal_session_v1',epoch,connection_id,sequence,opened_at:at,starting_heads:structuredClone(heads)};
   await fs.writeFile(path.join(dir,'session-open.json'),JSON.stringify(meta),{flag:'wx'});
   const journal=createJournal(journalRoot,{kind:'trade',...journalOptions,segmentEvidence:{...evidenceOptions,root:dir,epoch,connection_id,heads}});current={journal,meta,dir};sessions.push({dir,...meta});
  }).catch(e=>{failure=e.code||e.message;});return chain;
 }
 return {
  open,
  // Caller waits for open before capture; no hidden unbounded buffering.
  capture(data,at){if(!current)return {queued:false,reason:'LIFECYCLE_NOT_OPEN'};return current.journal.capture(data,at);},
  close(at=new Date().toISOString()){chain=chain.then(()=>closeCurrent(at));return chain;},
  async drain(){await chain;return current?current.journal.drain():null;},
  async abortIsolatedWorker(){await chain;return current?.journal.abortIsolatedWorker();},
  health(){return {status:failure?'GAP':current?'OPEN':'CLOSED',error:failure,current:current?.journal.health()||null,epoch,sessions:[...sessions],continuity_verified:false};},
  ready(){return chain;}
 };
}
module.exports={create};
