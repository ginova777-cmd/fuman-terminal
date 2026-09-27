'use strict';
const assert=require('node:assert/strict');
const {rankBRows}=require('./premarket-plan-contract.cjs');
const {KEYS,scoreB,buildBEvidence}=require('./premarket-short-ranking.cjs');
const evidence=n=>Object.fromEntries(KEYS.map((k,i)=>[k,i<n]));
const row=(id,n)=>({stock_id:id,short_rank_evidence:evidence(n),preopen_action:'NO_TRADE',direction_qualified:false});
const input=[row('3450',6),row('2330',3),row('2408',6),row('1504',0),{...row('2449',6),short_rank_evidence:{daily_kd_down:true}}];
const before=JSON.stringify(input), ranked=rankBRows(input);
assert.deepEqual(ranked.map(r=>r.stock_id),['2408','3450','2330','1504','2449']);
assert.deepEqual(ranked.map(r=>r.short_ranking.rank),[1,1,3,4,null]);
assert.deepEqual(ranked.map(r=>r.short_ranking.score),[6,6,3,0,null]);
assert.equal(JSON.stringify(input),before);
assert(ranked.every(r=>r.preopen_action==='NO_TRADE' && r.direction_qualified===false));
assert.equal(scoreB({...evidence(0),bollinger_upper:true}).score,0);
for(const bad of [null,undefined,1,'true'])assert.equal(scoreB({...evidence(6),daily_rsi_down:bad}).score,null);
assert.throws(()=>rankBRows([row('3450',1),row('3450',2)]),/DUPLICATE/);
assert.deepEqual(rankBRows([]),[]);
console.log('PASS B ranking: descending count, ties, no threshold, missing evidence, no qualification/action mutation, no Bollinger score');
const source={baseDate:'2026-09-23',previousDate:'2026-09-22',
 current:{date:'2026-09-23',completed:true,timeframe:'1d',kd:{params:[5,3,3],k:30,d:40},rsi:{params:[5,15],short:30,long:40},macd:{params:[5,9,20],dif:-2,signal:-1,histogram:-1}},
 previous:{date:'2026-09-22',completed:true,timeframe:'1d',kd:{params:[5,3,3],k:50,d:50},rsi:{params:[5,15],short:50,long:50},macd:{params:[5,9,20],dif:0,signal:0,histogram:0}},
 institutions:{date:'2026-09-23',foreign_net:-1,trust_net:-1,dealer_self_net:-1}};
assert.equal(scoreB(buildBEvidence(source)).score,12);
assert.equal(scoreB(buildBEvidence(source)).max_score,12);
assert.equal(rankBRows([{stock_id:'3450',short_rank_input:source}])[0].short_ranking.score,12);
let variant=structuredClone(source);
variant.previous.kd={params:[5,3,3],k:45,d:50};
assert.equal(buildBEvidence(variant).daily_kd_death_cross,false);
assert.equal(buildBEvidence(variant).daily_kd_bearish,true);
variant=structuredClone(source);variant.current.rsi.long=50;
assert.equal(buildBEvidence(variant).daily_rsi_down,false);
variant=structuredClone(source);variant.current.kd.k=40;
assert.equal(buildBEvidence(variant).daily_kd_bearish,false);
assert.equal(buildBEvidence(variant).daily_kd_death_cross,false);
variant=structuredClone(source);variant.current.macd.histogram=0;
assert.equal(buildBEvidence(variant).daily_macd_down,false);
for(const mutate of [x=>x.current.completed=false,x=>x.current.timeframe='1m',x=>x.current.date='2026-09-24',x=>x.previousDate=x.baseDate,x=>x.current.rsi.params=[3,6],x=>delete x.current.macd.histogram,x=>x.institutions.date='2026-09-22',x=>x.institutions.dealer_self_net=null]) {
 variant=structuredClone(source);mutate(variant);assert.equal(scoreB(buildBEvidence(variant)).status,'incomplete');
}
variant=structuredClone(source);variant.institutions.dealer_self_net=0;variant.institutions.dealer_hedge_net=-100;
assert.equal(scoreB(buildBEvidence(variant)).score,11);
assert.equal(scoreB(null).score,null);
assert.equal(scoreB(buildBEvidence()).score,null);
console.log('PASS 12-point daily input adapter: cumulative points, equality/cross boundaries, RSI both falling, parameter/date/completion validation, hedge excluded');
