'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const session=require('../lib/daytrade-module-session.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function verify({runtime,stdout,wrapperRunId,now=new Date()}){
 if(!wrapperRunId||!fs.statSync(stdout).isFile()||fs.statSync(stdout).size>16*1024*1024)throw Error('PENDING_INPUT_INVALID');
 const bytes=fs.readFileSync(stdout),events=bytes.toString().split(/\r?\n/).filter(x=>x.startsWith('{')).flatMap(x=>{try{return [JSON.parse(x)];}catch{return [];}});
 const starts=events.filter(x=>x.stage==='writer_round_identity'),pending=events.filter(x=>x.stage==='writer_natural_pending');
 if(starts.length!==1||pending.length!==1)throw Error('PENDING_SINGLE_ROUND_REQUIRED');
 const start=starts[0],p=pending[0],r=p.refresh,s=r?.source_result,id=p.identity;
 for(const key of ['trade_date','canonical_run_id','writer_run_id','generation_id'])if(!start[key]||start[key]!==id?.[key])throw Error('PENDING_IDENTITY_MISMATCH:'+key);
 const at=Date.parse(p.checked_at),begin=Date.parse(start.checkedAt),end=+new Date(now);
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date(now));
 if(!Number.isFinite(at)||!Number.isFinite(begin)||at<begin||at>end||end-at>300000||day!==id.trade_date||session.session(p.checked_at)!=='PREOPEN')throw Error('PENDING_WINDOW_INVALID');
 if(p.calendar?.trade_date!==day||p.calendar.is_open!==true||p.calendar.session!=='preopen')throw Error('PENDING_CALENDAR_INVALID');
 if(r.status!=='NATURAL_PENDING'||r.complete!==false||r.publication_acknowledged!==false||r.formal_entry_allowed!==false||r.trade_date!==day)throw Error('PENDING_NOT_SUCCESS_REQUIRED');
 if(s?.ok!==true||s.mode!=='apply'||s.trade_date!==day||['quote_rows','quotes_written','candle_rows','candles_written','candle_pending_after'].some(k=>s[k]!==0))throw Error('PENDING_ZERO_SOURCE_REQUIRED');
 const record={contract:'writer_natural_pending_observation_v1',status:'NATURAL_PENDING',complete:false,publication_acknowledged:false,formal_modules_complete:false,identity:id,wrapper_run_id:wrapperRunId,observed_at:p.checked_at,verified_at:new Date(now).toISOString(),stdout_sha256:hash(bytes),scope:'Pending classification only; no publication or module acceptance'};
 const dir=path.join(runtime,'data','writer-pending',day);fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,hash(wrapperRunId)+'.json');fs.writeFileSync(file,JSON.stringify(record,null,2),{flag:'wx'});return {...record,file};
}
module.exports={verify};
if(require.main===module){try{console.log(JSON.stringify(verify({runtime:process.argv[2],stdout:process.argv[3],wrapperRunId:process.argv[4]})));process.exitCode=75;}catch(e){console.error(e.message);process.exitCode=1;}}
