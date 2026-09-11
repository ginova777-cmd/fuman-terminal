"use strict";
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{spawnSync}=require('child_process');
const {inspect}=require('./build-opening-strategy-inspection');
const root=path.resolve(process.argv[2]||'work/opening-ranking-test');fs.mkdirSync(root,{recursive:true});
const date='2026-09-11';
const raw={ok:true,trade_date:date,symbols_requested:['2330'],rule_definitions:Object.fromEntries(Array.from({length:10},(_,i)=>[i,{no:i+1,label:`策略${i+1}`} ])),rows:[{symbol:'2330',evidence:{close:100,previous_close:99,daily_history_count:300,ma60:90,ma240:80,ma60_support_retest:false,ma240_breakout:false,w_neckline:{two_day_hold:false},previous_limit_up:false,limit_down_reopened:false}}]};
const report=inspect(raw);
for(const no of [1,3,4,8,10])assert.equal(report.rows[0].strategies[no-1].status,'NOT_MATCHED');
assert.equal(report.rows[0].strategies[5].status,'DATA_GAP');
// Ranking fixture: one-source stock with three matches must beat four-source stock with one match.
for(const key of ['strategy3','strategy4','strategy5','institution']){
 const symbols=key==='strategy3'?['2330','2481','3374']:['2330','3374'];
 fs.writeFileSync(path.join(root,`${key}.json`),JSON.stringify({ok:true,tradeDate:date,run_id:'fixture',rows:symbols.map(symbol=>({symbol,name:symbol}))}));
}
report.rows=['2330','2481','3374'].map((symbol,i)=>({symbol,matched_strategy_numbers:[[2],[2,3,8],[]][i],pending_strategy_numbers:[],strategies:Array.from({length:10},(_,j)=>({no:j+1,status:[[2],[2,3,8],[]][i].includes(j+1)?'MATCHED':'NOT_MATCHED'}))}));
report.symbol_count=3;fs.writeFileSync(path.join(root,'inspection.json'),JSON.stringify(report));
const csv=path.join(root,'ranking.csv');
const r=spawnSync('pwsh',['-NoProfile','-File',path.join(__dirname,'../ops/Show-OpeningPredictionRanking.ps1'),'-Once','-InputDirectory',root,'-OpeningLimitOrderDirectory',root,'-OpeningReportDirectory',root,'-OpeningStrategyInspectionPath',path.join(root,'inspection.json'),'-OutputCsv',csv,'-Top','3'],{encoding:'utf8',windowsHide:true});
fs.writeFileSync(path.join(root,'console.log'),r.stdout+r.stderr);assert.equal(r.status,0,r.stderr);
const check=spawnSync('pwsh',['-NoProfile','-Command',`$r=Import-Csv -LiteralPath '${csv.replace(/'/g,"''")}'; if($r.Count -ne 3 -or $r[0].Code -ne '2481' -or $r[0].OpeningStrategyCount -ne '3' -or $r[1].Code -ne '2330'){throw 'Ranking incorrect'}; if($r | Where-Object Direction){throw 'Diagnostic published direction'}`],{encoding:'utf8',windowsHide:true});
assert.equal(check.status,0,check.stderr);console.log('PASS: single-source inclusion, strategy-first ranking, missing versus false prerequisites, no prediction');
