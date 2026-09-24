'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const v=require('../lib/strategy4-v4-evidence');
function row(kd,rsi){const g={contract:v.GATE_CONTRACT,mode:'bonus_only',ok:true,available:true,kdK:kd?61:59,kdD:kd?61:59,kdPrevK:60,kdPrevD:60,rsi3:rsi?61:59,rsi6:rsi?61:59,rsi3Prev:60,rsi6Prev:60,kdTrendUp:kd,rsiTrendUp:rsi};return {recentVolumeBonus:require('../lib/strategy4-recent-volume-bonus').calculate([],[],'2026-09-17'),code:'1234',score:Math.min(100,95+(kd?5:0)+(rsi?5:0)),swingScore:Math.min(100,95+(kd?5:0)+(rsi?5:0)),baseScore:95,rawBaseScore:95,dailyTechnicalGate:g,technicalBonus:v.technicalBonus(g),mutakiV17:{...g}};}
for(const [kd,rsi,expected] of [[false,false,0],[true,false,5],[false,true,5],[true,true,10]])test(`KD ${kd}, RSI ${rsi}: bonus ${expected}, never exclude`,()=>{const r=row(kd,rsi);assert.equal(r.technicalBonus.total,expected);assert.equal(v.dailyTechnicalGateValid(r),true);});
test('score cap retains bonus priority',()=>assert.ok(v.compareRank(row(true,true),row(true,false))<0));
test('higher total precedes lower total',()=>assert.ok(v.compareRank(row(false,false),row(true,false))>0));
test('tampered bonus rejected',()=>{const r=row(false,false);r.technicalBonus.total=10;assert.equal(v.dailyTechnicalGateValid(r),false);});
test('missing indicator earns no points',()=>assert.deepEqual(v.technicalBonus({available:false}),{contract:v.GATE_CONTRACT,kd:0,rsi:0,total:0}));
test('legacy verifier fails closed',()=>assert.throws(()=>require('../lib/strategy4-v3-evidence'),/RETIRED_STRATEGY4_V3_EVIDENCE/));
test('volume bonus wins tied capped scores',()=>{const a=row(true,true),b=row(true,true);a.recentVolumeBonus.points=5;assert.ok(v.compareRank(a,b)<0);});
