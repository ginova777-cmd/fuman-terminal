'use strict';
const {readSnapshot}=require('../lib/supabase-snapshots');
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 try{
  const url=new URL(req.url||'/api/telegram-detectors','https://fuman-terminal.vercel.app'),run=String(req.query?.run||url.searchParams.get('run')||'');
  if(run&&!/^telegram-(?:natural|replay)-[a-f0-9-]{36}$/.test(run))return res.status(400).json({status:'blocked',complete:false,first_blocker:'INVALID_RUN_ID'});
  const snapshot=await readSnapshot(run?'telegram_three_detectors_'+run:'telegram_three_detectors_latest',{maxAttempts:1,timeoutMs:8000});
  const p=snapshot?.payload;
  if(!p)return res.status(200).json({contract:'telegram_three_independent_detectors_v1',status:'empty',complete:false,events:[],event_count:0,first_blocker:'尚無三偵測器正式資料'});
  if(p.contract!=='telegram_three_independent_detectors_v1')throw Error('CONTRACT_MISMATCH');
  const acceptance=await readSnapshot('telegram_three_detectors_acceptance_'+p.run_id,{maxAttempts:1,timeoutMs:4000});
  return res.status(200).json({...p,acceptance:acceptance?.payload||null});
 }catch{return res.status(503).json({status:'blocked',complete:false,events:[],event_count:0,first_blocker:'三偵測器資料庫讀回失敗'});}
};
