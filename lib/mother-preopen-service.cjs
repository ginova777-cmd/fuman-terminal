'use strict';
const fs=require('node:fs'),path=require('node:path');
const {build,publish,hash}=require('./mother-preopen.cjs');
const {previousSession}=require('./daytrade-preopen-history-calendar');
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(value));fs.renameSync(temp,file);}
function produce({runtimeRoot,calendar,asOf,health,producerVersion,actualStart}) {
  const date=new Date(Date.parse(asOf)+28800000).toISOString().slice(0,10);
  const root=path.join(runtimeRoot,'data','mother-pool','preopen'),dir=path.join(root,date);
  const base=previousSession(calendar,date,asOf);
  if(!health?.ok)throw Error('RAW_JOURNAL_UNHEALTHY');
  const rawDir=path.join(runtimeRoot,'data','mother-pool','preopen-raw',date);
  const names=fs.existsSync(rawDir)?fs.readdirSync(rawDir).filter(n=>/^\d{4,6}\.jsonl$/.test(n)).sort():[];
  const candidateFile=path.join(runtimeRoot,'data','mother-pool','preopen-requests',date+'.json');
  const supplied=fs.existsSync(candidateFile);
  // Supply all observed symbols even before a consumer submits its requested union.
  // Observed coverage never masquerades as requested coverage.
  const candidateBytes=supplied?fs.readFileSync(candidateFile,'utf8'):JSON.stringify({contract:'telegram_mother_preopen_candidates_v1',
    trade_date:date,base_date:base,symbols:names.map(n=>({stock_id:n.slice(0,-6)}))});
  if(!supplied&&!names.length){const status={status:'WAITING',reason:'NO_NATIVE_PREOPEN_EVENTS',trade_date:date,base_date:base,
    requested_count:null,complete:false,checked_at:asOf,notifications_sent:0,orders_sent:0};atomic(path.join(dir,'producer-status.json'),status);return status;}
  const {snapshot,journalDigest}=require('./mother-preopen-journal-build.cjs').buildJournal({candidateBytes,candidateSource:supplied?candidateFile:'mother_pool_observed_symbols',calendar,asOf,producerVersion},{rawDir,names});
  snapshot.coverage_scope=supplied?'requested_union':'observed_symbols_only';
  snapshot.candidate_request_status=supplied?'SUPPLIED':'NOT_SUPPLIED';
  if(!supplied){snapshot.observed_symbol_count=snapshot.requested_count;snapshot.observed_trial_count=snapshot.covered_count;
    snapshot.requested_count=null;snapshot.covered_count=null;snapshot.missing_count=null;snapshot.conflict_count=null;
    snapshot.missing_symbols=[];snapshot.status='PARTIAL';snapshot.candidate_source=null;snapshot.candidate_sha256=null;}
  // Exclude publication timestamps/ids; unchanged input does not create revisions.
  const signature=hash(JSON.stringify({candidateBytes,journalDigest,final:!!snapshot.finalized_at}));
  const receiptFile=path.join(dir,'receipt.json');const prior=fs.existsSync(receiptFile)?JSON.parse(fs.readFileSync(receiptFile)):null;
  let receipt=prior;
  if(prior?.input_signature!==signature){snapshot.input_signature=signature;
    receipt=publish(root,snapshot,{revisionReason:prior?'NATIVE_EVIDENCE_OR_REQUEST_REVISION':undefined,
      schedule:{name:'Fuman Fugle Daytrade WebSocket Collector 0600-1330',scheduled_start:date+'T06:00:00+08:00',actual_start:actualStart,process_status:'RUNNING'}});}
  const status={status:receipt.status,trade_date:date,checked_at:asOf,run_id:receipt.run_id,revision:receipt.revision,
    candidate_request_status:snapshot.candidate_request_status,requested_count:receipt.requested_count,complete:false,notifications_sent:0,orders_sent:0};
  atomic(path.join(dir,'producer-status.json'),status);return status;
}
module.exports={produce,atomic};
