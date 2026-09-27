'use strict';
const {readSnapshot}=require('../lib/supabase-snapshots');
const {digest}=require('../lib/telegram-detectors/premarket-plan-contract.cjs');
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 const run=String(req.query?.run||new URL(req.url||'/', 'http://localhost').searchParams.get('run')||'');
 if(run&&!/^premarket-validation-[a-f0-9-]{36}$/.test(run))return res.status(400).json({status:'blocked',complete:false,rows:[],first_blocker:'INVALID_RUN_ID'});
 try{
  const snapshot=await readSnapshot(run?'telegram_'+run:'telegram_premarket_validation_latest',{maxAttempts:1,timeoutMs:8000});
  const p=snapshot?.payload;
  if(!p)return res.status(200).json({status:'empty',complete:false,rows:[]});
  if(p.contract!=='telegram_premarket_validation_v1'||p.mode!=='validation'||p.no_send!==true||p.notifications_sent!==0||!Array.isArray(p.rows)||digest(p.rows)!==p.rows_sha256||(run&&run!==p.run_id))throw Error('VALIDATION_CONTRACT_MISMATCH');
  return res.status(200).json({...p,complete:false,formal_complete:false});
 }catch{return res.status(503).json({status:'blocked',complete:false,rows:[],first_blocker:'VALIDATION_READBACK_FAILED'});}
};
