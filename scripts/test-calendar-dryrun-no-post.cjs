'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'scripts/run-daytrade-source-writer.js'),'utf8');
const code=source.slice(source.indexOf('async function syncMarketCalendarEvidence()'),source.indexOf('async function tick('));
const {fixture}=require(path.join(root,'scripts/test-a04-calendar-history.cjs'));
const stamp=Date.parse('2026-10-13T00:45:00Z');
class Clock extends Date { constructor(...a){super(...(a.length?a:[stamp]));} static now(){return stamp;} }
const f=fixture(),calls=[],writes=[];
const ctx={APPLY:false,DRY_RUN:true,Date:Clock,process:{env:{}},a04CalendarHistory:null,SUPABASE_URL:'https://offline.invalid',requireSupabaseKey:()=> 'FAKE',console:{log(){}},runtimePath:(...x)=>x.join('/'),readJson:()=>null,writeJsonAtomic:(...x)=>writes.push(x),supabaseUpsert:async()=>({written:0,dryRun:true}),require:n=>{
 if(n.includes('daytrade-calendar-publication'))return {buildCalendarPublication:async()=>[{trade_date:'2026-10-13'}]};
 if(n.includes('a04-calendar-io'))return {createCalendarIO:opts=>require(path.join(root,'lib/a04-calendar-io.cjs')).createCalendarIO({...opts,clock:()=>stamp,fetchImpl:async(url,o)=>{calls.push({method:o.method,url,rows:o.body?JSON.parse(o.body).length:0});return new Response(o.method==='GET'?'[]':null,{status:200});}})};
 if(n.includes('twse-trading-day'))return {isTwseTradingDay:f.options.resolveDay};
 if(n.includes('a04-calendar-history'))return require(path.join(root,'lib/a04-calendar-history.cjs'));
 throw Error(n);
}};
vm.createContext(ctx);vm.runInContext(code+';globalThis.run=syncMarketCalendarEvidence;',ctx);
ctx.run().then(()=>{const posts=calls.filter(x=>x.method==='POST');assert.equal(posts.length,0);assert.equal(writes.length,0);assert.equal(ctx.a04CalendarHistory.status,'SKIPPED_READ_ONLY');assert.equal(ctx.a04CalendarHistory.complete,false);console.log(JSON.stringify({finding:'DRY_RUN_CALENDAR_ZERO_WRITES_PASS',apply:false,dry_run:true,real_network:false,post_batches:posts.length,post_rows:posts.reduce((n,x)=>n+x.rows,0),local_cache_writes:writes.length,status:ctx.a04CalendarHistory.status},null,2));}).catch(e=>{console.error(e);process.exitCode=1;});

