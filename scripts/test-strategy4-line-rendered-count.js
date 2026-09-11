const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),Module=require('module');
const file=path.join(__dirname,'send-strategy-line-card.js'),source=fs.readFileSync(file,'utf8');
const end=source.lastIndexOf('main().catch(');assert.ok(end>0);
const loaded=new Module(file,module);loaded.filename=file;loaded.paths=Module._nodeModulePaths(__dirname);
loaded._compile(source.slice(0,end)+'\nmodule.exports={buildCard};',file);
for(const count of [26,70]) test(`actual LINE card contains all ${count} stocks`,()=>{
 const matches=Array.from({length:count},(_,i)=>({code:String(2000+i),name:'測試股票',score:100-i,rank:i+1,price:100,entryPrice:100,targetPrice:110,stopPrice:95,zone:'A',signals:[{id:'bull_attack',title:'攻擊'}]}));
 const card=loaded.exports.buildCard('strategy4',{ok:true,count,matches,runId:'test-render-only',scanStamp:'20260911'});
 const codes=[];function visit(v){if(!v||typeof v!=='object')return;if(v.type==='text'){const code=String(v.text).match(/^(\d{4})\s/)?.[1];if(code)codes.push(code);}for(const c of Object.values(v)){if(Array.isArray(c))c.forEach(visit);else visit(c);}}visit(card);
 assert.deepEqual(codes.sort(),matches.map(r=>r.code).sort());
 assert.ok(Buffer.byteLength(JSON.stringify(card))<=30000);
});
