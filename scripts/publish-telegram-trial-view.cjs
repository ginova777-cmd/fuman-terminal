'use strict';
const {collect}=require('../lib/telegram-detectors/premarket-source-collector.cjs');
const {runValidation}=require('../lib/telegram-detectors/premarket-validation-flow.cjs');
const {publish}=require('../lib/telegram-detectors/publish-trial-view.cjs');
const {upsertSnapshot,readSnapshot}=require('../lib/supabase-snapshots');
const {anonKey}=require('../lib/server-supabase-key');
async function main({runtimeRoot=process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime',now=new Date().toISOString()}={}){
 const source=collect({runtimeRoot,now});if(!source.baseDate)throw Error('TRIAL_VIEW_BASE_DATE_MISSING');
 const payload=runValidation({...source,asOf:now});
 const key=anonKey({runtimeDir:runtimeRoot});if(!key)throw Error('TRIAL_VIEW_READBACK_KEY_MISSING');
 return publish({payload,now,store:async(name,p)=>{const result=await upsertSnapshot(name,p,{tradeDate:p.trade_date,snapshotId:p.run_id,source:'telegram_trial_price_levels',timeoutMs:8000});if(!result.ok)throw Error('TRIAL_VIEW_DB_WRITE_FAILED');},readback:async name=>(await readSnapshot(name,{key,maxAttempts:1,timeoutMs:8000}))?.payload||null});
}
module.exports={main};
