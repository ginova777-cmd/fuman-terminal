'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict'),{createRequire}=require('module');
const file=path.join(__dirname,'cleanup-supabase-vercel-history.js');
const source=fs.readFileSync(file,'utf8').split('main().catch(')[0];
const ctx={require:createRequire(file),__dirname,process:{env:{},argv:[]},console,URL,URLSearchParams,setTimeout,clearTimeout};vm.createContext(ctx);vm.runInContext(source,ctx);
(async()=>{
 vm.runInContext(`fetchRunRows=async()=>[{run_id:'new-failed',strategy:'s',status:'failed',complete:false,finished_at:'2026-09-11'},{run_id:'latest-good',strategy:'s',status:'complete',complete:true,finished_at:'2020-01-01'},{run_id:'old-good',strategy:'s',status:'complete',complete:true,finished_at:'2019-01-01'}]; deleteRows=async(table,query,apply)=>{ if(query.includes('latest-good')) throw Error('protected run deleted'); return {deleted:0}; };`,ctx);
 const r=await vm.runInContext(`cleanupRunPair({key:'s',runsTable:'runs',resultsTable:'results',dateColumn:'finished_at',strategy:'s'},{supabaseRetentionDays:45,keepRuns:1,batchSize:80,apply:true})`,ctx);
 assert.equal(r.candidateRuns,1);console.log('PASS latest complete protected even outside retention and keep-count');
 vm.runInContext(`fetchRunRows=async()=>[{run_id:'failed',status:'failed',complete:false,finished_at:'2020-01-01'}]`,ctx);
 await assert.rejects(vm.runInContext(`cleanupRunPair({key:'s',dateColumn:'finished_at'},{supabaseRetentionDays:45,keepRuns:1,batchSize:80,apply:true})`,ctx),/latest_complete_protection_unproven/);
 console.log('PASS missing latest complete blocks deletion');
 assert(source.includes('item.target === "preview"')&&source.includes('aliases.length === 0'));console.log('PASS preview-only, no-alias deployment policy wired');
})().catch(e=>{console.error(e);process.exitCode=1});
