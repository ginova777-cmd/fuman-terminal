'use strict';
const {readSnapshot}=require('../lib/supabase-snapshots');
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 try{
  const snapshot=await readSnapshot('telegram_three_detectors_latest',{maxAttempts:1,timeoutMs:8000});
  const p=snapshot?.payload;
  if(!p)return res.status(200).json({contract:'telegram_three_independent_detectors_v1',status:'empty',complete:false,events:[],event_count:0,first_blocker:'尚無三偵測器正式資料'});
  if(p.contract!=='telegram_three_independent_detectors_v1')throw Error('CONTRACT_MISMATCH');
  return res.status(200).json(p);
 }catch{return res.status(503).json({status:'blocked',complete:false,events:[],event_count:0,first_blocker:'三偵測器資料庫讀回失敗'});}
};
