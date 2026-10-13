'use strict';
const fs=require('fs'),cp=require('child_process'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const base='db55758a6de8c1896390fc8573b6eab0eacce9bf';
const git=(...a)=>cp.execFileSync('git',['-c','core.fsmonitor=false',...a]);
const all=new Set(git('ls-tree','-r','--name-only',base).toString().trim().split(/\r?\n/));
const queue=['scripts/fugle-futopt-websocket-collector.js'],seen=new Set(),files=[];
while(queue.length){const f=queue.shift();if(seen.has(f))continue;seen.add(f);const bytes=git('show',base+':'+f);const normalized=git('hash-object','--path='+f,f).toString().trim();assert(git('cat-file','blob',normalized).equals(bytes),'FUTURES_GIT_BYTES_CHANGED:'+f);files.push({path:f,git_bytes_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),working_bytes_sha256:crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')});
for(const m of bytes.toString().matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)){if(!m[1].startsWith('.'))continue;const p=path.posix.normalize(path.posix.join(path.posix.dirname(f),m[1]));const resolved=[p,p+'.js',p+'.cjs',p+'.json',p+'/index.js'].find(x=>all.has(x));assert(resolved,'UNRESOLVED:'+f+':'+m[1]);queue.push(resolved);}}
for(const f of ['package.json','package-lock.json'])assert(fs.readFileSync(f).toString().replaceAll('\r\n','\n')===git('show',base+':'+f).toString().replaceAll('\r\n','\n'),'PACKAGE_CHANGED:'+f);
const stock=require('../lib/mother-pool-stock-module-write-set'),legacy=require('../lib/mother-pool-module-write-set');assert.deepEqual(stock.identityFields,legacy.identityFields);assert.equal(stock.hash({a:1}),legacy.hash({a:1}));
const round=JSON.parse(fs.readFileSync('scripts/fixtures/b01-ack/ack-round1.json'));const ws=round.writer_write_set;const db=round.db_readback.pages[0].rows,anon=round.anon_readback.pages[0].rows;ws.ack.writer_run_id=round.writer_run_id;
assert.deepEqual(stock.reconcile(ws,db,anon,round,'B01').failed_checks,[]);
ws.ack.writer_run_id='OTHER';assert(stock.reconcile(ws,db,anon,round,'B01').failed_checks.includes('ACK_IDENTITY:writer_run_id'));
console.log(JSON.stringify({status:'STATIC_FUTURES_CLOSURE_AND_STOCK_ACK_PASS',formal_execution:false,base,files,limitation:'Git-normalized literal local imports and package manifests only; archive/raw production bytes need separate binding; no running-process, external dependency or dynamic file-access proof.'},null,2));
