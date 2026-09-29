'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'run-daytrade-source-writer.js'),'utf8');
const identity=require('../lib/daytrade-writer-identity').newIdentity('fugle_daytrade_source','test-writer','2026-09-30');
const assignment=code.match(/Object\.assign\(result\.payload, require\("\.\.\/lib\/daytrade-writer-identity"\)\.requireIdentity\(writerTickIdentity, taipeiDate\(\)\)\);/);
assert(assignment,'tick identity must precede producer/checkpoint construction');
assert(code.indexOf(assignment[0])<code.indexOf('const publishInitialSource'));
const result={payload:{},priorityRows:[{symbol:'2330',sourceFlags:['fixture'],poolReasons:['fixture'],priorityMetrics:{avgVolume3:4000,avgVolume3SampleDays:3}}]};
const context={result,require,writerTickIdentity:identity,taipeiDate:()=>identity.trade_date};
vm.runInNewContext(assignment[0],context);
assert.equal(result.payload.generation_id,identity.generation_id);
assert.equal(result.payload.writer_run_id,identity.writer_run_id);
let pending=null,writes=0,notifications=0;
Object.assign(context,{
  isPublishedMotherMember:()=>true,nowIso:()=> '2026-09-29T23:50:00Z',
  canonicalDaytradeRunId:()=>identity.canonical_run_id,
  readJson:()=>({trade_date:'2026-09-29',canonical_run_id:'old',rows:[{symbol:'9999'}]}),
  sameDayArtifact:(r,d)=>r.trade_date===d,normalizeCode:String,
  numberValue:(v,f=0)=>Number.isFinite(Number(v))?Number(v):f,
  poolLayerForRank:()=> 'mother',DRY_RUN:false,DIAGNOSTIC_SYMBOLS:[],
  SOURCE_NAME:'fugle_daytrade_source',MOTHER_POOL_CONTRACT_VERSION:'4.1.0',
  MOTHER_POOL_TARGET_MIN_SYMBOLS:300,MOTHER_POOL_MIN_AVG_VOLUME3_LOTS:3000,
  HOT_POOL_MAX_SYMBOLS:80,DEEP_SCAN_POOL_MAX_SYMBOLS:60,SIDE_VOLUME_THRESHOLD_LOTS:2000,
  MOTHER_POOL_DELTA_STATE_FILE:'unused',writeJson:()=>{writes++;},
  writeIntradayBurstTelegramOutbox:()=>{notifications++;return {event_count:0};},
  options:{preopen:true,publishState:r=>{pending=r;}},
});
const fn=code.slice(code.indexOf('function updateMotherPoolDelta('),code.indexOf('function buildPreopenLightMotherPoolDelta('));
vm.runInNewContext(fn+'; updateMotherPoolDelta(result,options);',context);
assert.equal(writes,0,'preopen state must remain deferred');
assert.equal(notifications,0,'preopen must not generate notification events');
assert.equal(pending.trade_date,identity.trade_date);
assert.equal(pending.writer_run_id,identity.writer_run_id);
assert.deepEqual(Array.from(pending.rows,r=>r.symbol),['2330']);
assert.equal(pending.rows[0].avg3_volume,4000);
assert.equal(pending.complete,undefined,'runner state cannot assert total completion');
const start=code.indexOf('async function writeStatusAndScorecard');
const ack=code.indexOf('const sourceStatusAck = await',start);
const publish=code.indexOf('if (acknowledgedMotherPoolState) writeJsonAtomic',start);
assert(ack>start&&publish>ack,'local state publication must follow acknowledged source write');
console.log('PASS: actual tick identity before checkpoint; current universe with no previous-day carryover; deferred publication; no preopen notification or fabricated completion');
