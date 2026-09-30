'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const journal=require('../lib/daytrade-source-status-journal');
const {project,fields}=require('../lib/daytrade-source-status-projection');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mother-status-projection-'));
const row={source_name:'test',trade_date:'2026-09-30',updated_at:'2026-09-30T00:00:00Z',payload:{trade_date:'2026-09-30',canonical_run_id:'canonical',writer_run_id:'writer',generation_id:'generation',same_round_industry_discovery:{rows:[{symbol:'2330'}]},b19_b24_event_evidence:{events:[{kind:'test'}]},volume_value_ranking:[{symbol:'2330'}],status:'DATA_GAP'}};
const original=JSON.stringify(row);
const actual=project(row,{save:r=>journal.prepare(root,r),read:journal.read});
assert.equal(JSON.stringify(row),original);
assert.deepEqual(actual.payload.volume_value_ranking,row.payload.volume_value_ranking);
assert.equal(actual.payload.status,'DATA_GAP');
const archived=journal.read(actual.payload.producer_detail_archive);
for(const field of fields){assert(!Object.hasOwn(actual.payload,field));assert.deepEqual(archived.payload[field],row.payload[field]);}
for(const key of Object.keys(row.payload).filter(k=>!fields.includes(k)))assert.deepEqual(actual.payload[key],row.payload[key]);
assert.throws(()=>project({...row,payload:{...row.payload,generation_id:''}},{save(){throw Error('should not save');},read(){}}),/IDENTITY/);
assert.throws(()=>project(row,{save:()=>({}),read:()=>({corrupt:true})}));
assert.equal(actual.payload.producer_detail_archive.complete,false);
console.log(JSON.stringify({ok:true,tests:['durable hash-checked roundtrip','original producer data preserved','public fields unchanged','missing identity rejected','corrupt archive rejected'],archive:actual.payload.producer_detail_archive.file}));
