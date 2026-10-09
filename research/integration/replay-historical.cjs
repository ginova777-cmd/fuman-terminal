'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');const {hash}=require('./offline-store.cjs');const {derive}=require('../phase3/candle-derived.cjs');
const root=path.resolve(process.argv[2]);if(!root)throw Error('SOURCE_REQUIRED');
const manifestBytes=fs.readFileSync(path.join(root,'manifest.json')),manifest=JSON.parse(manifestBytes),stocks=[],failures=[];let rows=0;
for(const f of manifest.files.filter(f=>/LY-WATER[^/\\]*[/\\]\d{4}\.json$/.test(f.path))){
 const file=path.resolve(root,f.path);if(!file.startsWith(root+path.sep))throw Error('MANIFEST_PATH');
 const b=fs.readFileSync(file),ok=b.length===f.bytes&&hash(b)===f.sha256;
 if(!ok){failures.push({path:f.path,reason:'SOURCE_MANIFEST_MISMATCH',actual_sha256:hash(b)});continue;}
 const a=JSON.parse(b);rows+=a.length;const symbols=[...new Set(a.map(r=>r.symbol))],dates=[...new Set(a.map(r=>r.trade_date))];
 if(symbols.length!==1||dates.length!==1){failures.push({path:f.path,reason:'IDENTITY_CONFLICT'});continue;}
 const asOf=manifest.generated_at;const original=derive(a,dates[0],asOf),reconstructed=new Map();
 for(const r of a)reconstructed.set(r.symbol+'|'+r.candle_time,r);
 const replay=derive([...reconstructed.values()],dates[0],asOf);assert.deepEqual(replay,original);
 stocks.push({symbol:symbols[0],date:dates[0],rows:a.length,source_sha256:f.sha256,derived_final_state_parity:true,first_available_replay:'UNKNOWN',prior_revision_history:'UNKNOWN'});
}
const report={status:failures.length?'BLOCKED_SOURCE_INTEGRITY':'PARTIAL_HISTORICAL_FINAL_STATE_PARITY',source_root:root,source_manifest_sha256:hash(manifestBytes),stocks,rows,failures,full_e2e:false,blockers:['No frozen all-market active/quote/supplemental same-as-of input chain in this delivery','Final per-minute versions cannot reconstruct original revision arrival history','Direction/level/history baseline availability not established','No Phase1 C2 evidence existed for this historical delivery'],peak_rss_kib:process.resourceUsage().maxRSS,cpu:process.cpuUsage()};
fs.writeFileSync(path.join(__dirname,'historical-replay.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,stocks:stocks.length,rows,failures:failures.length}));
