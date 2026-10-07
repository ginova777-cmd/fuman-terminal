'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {assess,resolveThreshold}=require('../lib/mother-pool-k-coverage.cjs');
const checks=[];function test(name,fn){fn();checks.push(name);}
const rows=n=>Array.from({length:100},(_,i)=>({symbol:String(1000+i),payload:{mother_pool_k_quality_ready:i<n,last_candle_time:'2026-10-06T03:59:00Z'}}));
const opts={tradeDate:'2026-10-06',checkedAt:'2026-10-06T04:00:00Z',intraday:true};
for(const [name,env,config,threshold] of [['default',undefined,undefined,.9],['env95','.95',.9,.95],['config95',undefined,.95,.95],['invalid_env','bad',.95,.95],['range_invalid',2,-1,.9]])test(name,()=>{assert.equal(resolveThreshold(env,config),threshold);const n=Math.ceil(100*threshold),r=assess(rows(n),{...opts,threshold});assert.equal(r.passed,true);assert.equal(assess(rows(n-1),{...opts,threshold}).passed,false);assert.equal(r.requested_count,100);assert.equal(r.eligible_symbols.length,n);assert.equal(r.missing_symbols.length,100-n);assert.deepEqual([...r.eligible_symbols,...r.missing_symbols].sort(),rows(n).map(r=>r.symbol).sort());});
const writer=fs.readFileSync(require.resolve('./run-daytrade-source-writer.js'),'utf8'),reader=fs.readFileSync(require.resolve('../lib/strategy3-canonical-water-reader.js'),'utf8');
function extract(source,name,next){const start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction '+next+'(',start);assert(start>=0&&end>start);return source.slice(start,end);}
const sourceGate=vm.runInNewContext(extract(writer,'sourceGateA','poolLayerForRank')+';sourceGateA',{MAX_QUOTE_AGE_SECONDS:120,RECENT_429_BLOCK_SECONDS:90,MIN_READY_MA20_CONTINUOUS:1,MAX_INTRADAY_1M_STALE_SECONDS:120,MIN_INTRADAY_1M_READY_COVERAGE:.9});
const gate=vm.runInNewContext(extract(reader,'validateGate','validateTelegramObservationSource')+';validateGate');
const values={formalScopeQuoteFreshOk:true,formalPoolSymbols:10,quoteAgeSeconds:10,cooldownRemaining:0,last429AgeSeconds:1000,after0830:true,dailyVolumeStatus:'ready',after0845:true,scannerCanRunOpening:true,strategyChipCompleteLatestRun:true,readyMa20:100,effectiveMa20Required:90,after0900:true,intraday1mReadyCoverage:.9,intraday1mStaleSeconds:60};
const summary={grade:'A',status:'ready',formal_entry_allowed:true,formal_entry_speed_verdict:'YES',scanner_can_run_opening:true,formal_source_alignment_ok:true,priority_fresh_quote_coverage_120s:.95,quote_age_seconds:10,websocket_formal_ready:true,websocket_connected:true,websocket_authenticated:true,websocket_rest_disabled:true,websocket_streaming_channels:['trades','aggregates','candles'],failed_checks:[]};
test('K pass reader quote94 blocked',()=>{const f=[];gate({...summary,priority_fresh_quote_coverage_120s:.94},'test',f);assert(f.includes('test_priority_quote_coverage_below_095'));});
test('other gate blocks',()=>{assert.equal(sourceGate({...values,cooldownRemaining:1}),false);const f=[];gate({...summary,formal_entry_allowed:false},'test',f);assert(f.length>0);});
test('boundary gates pass',()=>{assert.equal(sourceGate(values),true);const f=[];gate(summary,'test',f);assert.equal(f.length,0);});
test('writer threshold wiring',()=>{assert(writer.includes('threshold:MIN_INTRADAY_1M_READY_COVERAGE'));assert(writer.includes('intraday_1m_ready_coverage_min: MIN_INTRADAY_1M_READY_COVERAGE'));assert(writer.includes('values.intraday1mReadyCoverage >= MIN_INTRADAY_1M_READY_COVERAGE'));});
const failures=[];gate({...summary,priority_fresh_quote_coverage_120s:.94},'test',failures);
console.log(JSON.stringify({ok:true,checks,scope_consistency_probe:{kind:'isolated gate functions; not full computeStats replay',producer_formal_subset_gate_pass:sourceGate(values),reader_all_priority_94_failures:failures,source_scopes_identical:false}},null,2));
