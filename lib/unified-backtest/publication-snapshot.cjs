'use strict';
const fs=require('node:fs'),{hash}=require('./core.cjs');
function validate(view){
 if(view?.contract!=='unified-backtest-view-v1'||!Array.isArray(view.signals)||!Array.isArray(view.strategies)||!Array.isArray(view.runs))throw Error('VIEW_CONTRACT');
 const ids=new Set(),counts=new Map(),runs=new Map();
 for(const r of view.runs){if(!r.run_id||runs.has(r.run_id)||!Number.isSafeInteger(r.candidate_count)||r.candidate_count<0)throw Error('RUN_CONTRACT');runs.set(r.run_id,r);}
 for(const s of view.signals){if(!s.signal_id||ids.has(s.signal_id)||!runs.has(s.run_id))throw Error('SIGNAL_BINDING');ids.add(s.signal_id);counts.set(s.run_id,(counts.get(s.run_id)||0)+1);
  if(s.run_type==='SIMULATION'||!['HISTORICAL_REPLAY','FORWARD_RECORDED','RECOVERED_RECORD'].includes(s.source_mode))throw Error('SOURCE_MODE');
  if(s.source_mode==='RECOVERED_RECORD'&&s.eligible!==false)throw Error('RECOVERED_NOT_FORMAL_ELIGIBLE');
  if(typeof s.eligible!=='boolean')throw Error('ELIGIBILITY_REQUIRED');
  if(s.outcome&&s.outcome.signal_id!==s.signal_id)throw Error('OUTCOME_BINDING');
 }
 for(const r of runs.values())if((counts.get(r.run_id)||0)!==r.candidate_count)throw Error('PUBLISHED_COUNT_MISMATCH');
 return view;
}
function envelope(view){validate(view);return{contract:'unified-backtest-publication-v1',content_sha256:hash(view),view};}
function readPublication(file){const p=JSON.parse(fs.readFileSync(file,'utf8'));if(p.contract!=='unified-backtest-publication-v1'||p.content_sha256!==hash(p.view))throw Error('PUBLICATION_INTEGRITY');return validate(p.view);}
module.exports={validate,envelope,readPublication};
