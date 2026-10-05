'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {createJournal}=require('../lib/provider-journal-background.cjs');
async function main(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'journal-worker-'));
 const at='2026-10-05T01:26:18.000Z',event=Date.parse('2026-10-05T01:25:39.000Z')*1000;
 const data={symbol:'1409',date:'2026-10-05',market:'TSE',time:event,serial:1,size:1,volume:10,price:50,total:{time:event,tradeVolume:10,tradeVolumeAtBid:3,tradeVolumeAtAsk:7}};
 for(const kind of ['side','trade']){
  const dir=path.join(root,kind),j=createJournal(dir,{kind});
  try{
   for(let i=0;i<300;i++){const d={...data,serial:i+1,time:event+i*1000,total:{...data.total,time:event+i*1000}};assert.equal(j.capture(d,at).queued,true);d.symbol='0000';}
   assert.equal(j.health().stored_records,0);assert.equal(j.health().status,'PENDING');
   const health=await j.drain();assert.equal(health.ok,true);assert.equal(health.queued_records,0);assert.equal(health.stored_records,300);
   const rows=fs.readFileSync(path.join(dir,'2026-10-05','1409.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
   assert.equal(rows.length,300);assert.equal(rows[0].received_at,at);assert.equal(rows[0].event_at,'2026-10-05T01:25:39.000Z');
   assert.ok(rows.every(r=>r.stock_id==='1409'));assert.ok(Date.parse(rows.at(-1).event_at)>Date.parse(rows[0].event_at));
   const last={...data,serial:300,time:event+299000,total:{...data.total,time:event+299000}};j.capture(last,at);await j.drain();assert.equal(j.health().stored_records,300);
  }finally{await j.close();}
 }
 const bounded=createJournal(path.join(root,'bounded'),{kind:'side',maxRecords:1,flushMs:1000});
 try{assert.equal(bounded.capture(data,at).queued,true);assert.equal(bounded.capture(data,at).reason,'JOURNAL_QUEUE_LIMIT');await bounded.drain();assert.equal(bounded.health().ok,false);assert.equal(bounded.health().rejected_records,1);}finally{await bounded.close();}
 const bad=path.join(root,'file');fs.writeFileSync(bad,'file');const failed=createJournal(bad,{kind:'trade'});
 try{failed.capture(data,at);await failed.drain();assert.equal(failed.health().ok,false);assert.equal(failed.health().stored_records,0);}finally{await failed.close();}
 console.log('PASS background journals: ordered durable readback, unchanged clocks, enqueue isolation, duplicate filtering, bounded queue and write failures visible');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
