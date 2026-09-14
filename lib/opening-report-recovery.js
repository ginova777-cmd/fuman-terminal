'use strict';
const fs=require('fs');
function context(date){
 const file=process.env.FUMAN_MORNING_RECOVERY_CONTEXT;if(!file)return null;
 const c=JSON.parse(fs.readFileSync(file,'utf8'));
 if(c.trade_date!==date)return null;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(c.contract!=='opening-morning-authorized-recovery-v1'||c.trade_date!==today||c.authorization!=='user-20260914-refetch-and-send'||!c.run_id||!Number.isFinite(Date.parse(c.started_at))||!Number.isFinite(Date.parse(c.cutoff_at))||Date.parse(c.cutoff_at)-Date.parse(c.started_at)>10*60000||Date.parse(c.cutoff_at)<=Date.parse(c.started_at))throw Error('invalid_morning_recovery_context');
 const arg=process.argv.find(x=>x.startsWith('--run-id='));if(arg&&arg.slice(9)!==c.run_id)throw Error('morning_recovery_run_mismatch');
 return c;
}
function cutoff(date){return context(date)?.cutoff_at||date+'T08:50:59.999+08:00';}
function label(date){return context(date)?cutoff(date):date+' 08:50:59.999 Asia/Taipei';}
function title(date){return context(date)?'📈 當日晨報補跑（非08:50準時批次）':'📈 08:50 漲幅族群晨報';}
module.exports={context,cutoff,label,title};
