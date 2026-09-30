'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const {spawnSync}=require('child_process');
async function cleanupCase(error,exitCode,failStep='intraday') {
  const files=new Map(),calls=[];let unlocked=false;
  const auth={runId:'isolated-test',sha256:'test',date:'2026-09-30',file:'auth',journalFile:'journal'};
  const fakeFs={mkdirSync(){},existsSync(){return false},openSync(){return 1},closeSync(){},unlinkSync(){unlocked=true},writeFileSync(f,v){files.set(f,v)},readFileSync(f){return files.get(f)||''}};
  const context={ROOT:'isolated',RUNTIME:'isolated',authorization(){return auth},receipts(){return Object.fromEntries(['retired','history','intraday','runtime','priority','observability','extended','cost','janitor'].map(n=>[n,[]]))},verifyJournal(){}};
  const sandbox={require(n){if(n==='fs')return fakeFs;if(n==='path')return path;if(n==='child_process')return {};if(n==='./cleanup-maintenance-context')return context;if(n==='./twse-trading-day')return {isTwseTradingDay:async()=>({isTradingDay:true,date:auth.date,source:'cache'})};throw Error(n)},process:{argv:['node','test','--apply','--authorization=auth'],execPath:'node'},console:{log(){}},Date,setTimeout,clearTimeout,
    mockCommand:async(file,args,log)=>{const name=path.basename(log,'.log');calls.push(name);files.set(log,name===failStep?error:'');return {exitCode:name===failStep?exitCode:0}}};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'run-cleanup-maintenance.js'),'utf8').split('main().catch(')[0],sandbox);
  vm.runInContext('command=mockCommand; protectedFiles=()=>[];',sandbox);
  let caught;try{await vm.runInContext('main()',sandbox)}catch(e){caught=e}
  const journal=JSON.parse(files.get('journal'));
  assert(unlocked,'own lock must be released');assert(journal.finishedAt);
  if(failStep){assert(caught,'failure must propagate');assert.equal(calls.at(-1),failStep,'no later stage may execute');assert.equal(journal.firstFailure.step,failStep)}
  else {assert(!caught);assert.equal(journal.steps.length,9)}
}
function writerCase(exitCode,message) {
  const source=fs.readFileSync(path.join(__dirname,'../ops/public-slot/Run-DaytradeSourceWriter.ps1'),'utf8');
  // Normalize CRLF before locating the production block.
  const normalized=source.replace(/\r\n/g,'\n');
  const begin=normalized.lastIndexOf('if ($Apply',normalized.indexOf('$fastSyncScript ='));
  const end=normalized.indexOf('\ntry {',begin);
  assert(begin>=0&&end>begin);
  const script=`$Apply=$true; $runCloseout=$false; $RepoRoot='isolated';
function Test-Path { return $true }
function node { $global:LASTEXITCODE=${exitCode}; '${message}' }
function Write-WrapperLog { param($Message) }
function Update-WriterDatabaseBackoff { param($Action,$Diagnostic) }
function Write-FailureArtifact { param($ExitCode,$Reason); Write-Output "FAILURE:$Reason" }
function Invoke-MotherPoolReceiptRollover { param($FastSyncExitCode); Write-Output 'ROLLOVER' }
${normalized.slice(begin,end)}
Write-Output 'MAIN_WRITER_STARTED'
`;
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',timeout:15000});
  assert(!r.error,r.error?.message);
  if(exitCode){assert.notEqual(r.status,0);assert.match(r.stdout,/FAILURE:fast_supabase_sync_failed/);assert(!r.stdout.includes('ROLLOVER'));assert(!r.stdout.includes('MAIN_WRITER_STARTED'))}
  else {assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/ROLLOVER/);assert.match(r.stdout,/MAIN_WRITER_STARTED/)}
}
(async()=>{
  for(const message of ['HTTP 521','HTTP_522','TimeoutError','AbortError','fetch failed','unknown failure']){
    await cleanupCase(message,1);writerCase(1,message);
  }
  await cleanupCase('HTTP 521',0);
  await cleanupCase('TimeoutError',1,'retired');
  await cleanupCase('',0,null);writerCase(0,'ok');
  console.log('PASS: 9 cleanup scenarios and 7 Writer scenarios; failure blocks downstream, success continues; no network/database calls');
})().catch(e=>{console.error(e);process.exitCode=1});
