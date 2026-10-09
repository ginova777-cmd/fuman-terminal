'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');const {OfflineStore}=require('./offline-store.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp-partition-capacity-')),s=new OfflineStore(dir),start=performance.now(),cpu=process.cpuUsage();
const refs={};for(let i=0;i<2000;i++){
 const symbol=String(1000+i),history=[];
 for(let d=0;d<20;d++)for(let m=0;m<271;m++)history.push({stock_id:symbol,trade_date:'FIXTURE_DAY_'+d,timestamp:d*86400000+m*60000,open:100,high:101,low:99,close:100,volume_raw:10,volume_raw_unit:'LOTS'});
 refs[symbol]=s.put({symbol,history,fixture:true});
 if(i%100===0&&performance.now()-start>90000)throw Error('CAPACITY_TIME_BUDGET');
}
s.transaction(()=>({sequence:1,refs}));const baseline={elapsed_ms:performance.now()-start,io:{...s.io}};
const t=performance.now(),before={...s.io};let touched=0;
s.transaction(root=>{const next={...root,sequence:2,refs:{...root.refs}};for(const symbol of Object.keys(root.refs).slice(0,10)){const v=s.get(root.refs[symbol]);v.history[17].volume_raw=20;next.refs[symbol]=s.put(v);touched++;}return next;});
const result={status:'PARTITION_STORAGE_CAPACITY_PASS',scope:'Storage only; formula E2E not measured',synthetic:true,symbols:2000,history_days:20,bars_per_symbol:5420,total_rows:10840000,touched,baseline,delta:{elapsed_ms:performance.now()-t,read_bytes:s.io.read-before.read,written_bytes:s.io.written-before.written},peak_rss_kib:process.resourceUsage().maxRSS,memory:process.memoryUsage(),cpu:process.cpuUsage(cpu),fixture_directory:dir};
assert.equal(Object.keys(s.root().refs).length,2000);assert.equal(s.get(s.root().refs['1000']).history[17].volume_raw,20);fs.writeFileSync(path.join(__dirname,'partition-capacity.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
