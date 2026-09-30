'use strict';
// Offline publication from captured original messages. Never reads latest quotes.
const fs = require('node:fs'), path = require('node:path'), readline = require('node:readline');
const { build, publish } = require('../lib/mother-preopen.cjs');
async function main() {
  const arg = key => process.argv.slice(2).find(a => a.startsWith('--'+key+'='))?.slice(key.length+3);
  for (const key of ['candidates','calendar','raw-root','output-root','producer-version']) if (!arg(key)) throw Error('MISSING_ARGUMENT:'+key);
  const candidateBytes = fs.readFileSync(arg('candidates'),'utf8'), candidate = JSON.parse(candidateBytes);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate.trade_date)) throw Error('TRADE_DATE_INVALID');
  if (!Array.isArray(candidate.symbols) || candidate.symbols.some(r=>!/^\d{4,6}$/.test(r.stock_id||''))) throw Error('CANDIDATE_SYMBOL_INVALID');
  const records = [];
  for (const symbol of new Set(candidate.symbols.map(r=>r.stock_id))) {
    const file = path.join(arg('raw-root'),candidate.trade_date,symbol+'.jsonl');
    if (!fs.existsSync(file)) continue;
    let line=0;
    for await (const text of readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity})) {
      line++; if (!text.trim()) continue;
      // Malformed/truncated evidence blocks publication instead of hiding lost rows.
      records.push({...JSON.parse(text),raw_evidence_ref:file+':'+line});
    }
  }
  const snapshot=build({candidateBytes,candidateSource:path.resolve(arg('candidates')),
    calendar:JSON.parse(fs.readFileSync(arg('calendar'),'utf8')),records,
    asOf:arg('as-of')||new Date().toISOString(),producerVersion:arg('producer-version')});
  const receipt=publish(arg('output-root'),snapshot,{revisionReason:arg('revision-reason')});
  console.log(JSON.stringify({run_id:receipt.run_id,status:receipt.status,requested_count:receipt.requested_count,
    covered_count:receipt.covered_count,actual_open_covered_count:receipt.actual_open_covered_count,complete:false}));
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({complete:false,error:e.message}));process.exitCode=1;});
module.exports={main};
