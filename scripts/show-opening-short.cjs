'use strict';
const fs=require('fs'),arg=(n,d)=>process.argv.find(x=>x.startsWith('--'+n+'='))?.slice(n.length+3)||d;
const r=JSON.parse(fs.readFileSync(arg('report'))),m=r.premarket_final;
const valid=v=>typeof v==='number'&&Number.isFinite(v),fmt=(v,n=2)=>valid(v)?v.toLocaleString('zh-TW',{maximumFractionDigits:n}):'未確認';
const flow=x=>!valid(x?.net)?'未確認':x.net===0?'買賣超 0張':(x.net>0?'買超 ':'賣超 ')+fmt(Math.abs(x.net))+'張';
const yn=v=>v===true?'符合':v===false?'不符合':'未確認';
console.log(`空方盤前篩選｜資料日 ${r.trade_date}｜掃描 ${r.rows.length}檔`);
if(r.universe_counts)console.log(`母池：官方上市 ${r.universe_counts.TWSE}檔／上櫃 ${r.universe_counts.TPEX}檔普通股；不使用終端策略名單`);
console.log(`通過分級及總量>2,000張：${m.symbols.length}檔｜條件分數由高到低，同分依代號；同時符合可列兩欄`);
console.log('A高檔出貨空：位階四捨五入成整數≥8及急漲背景；B弱勢延續空：月斜率<0、0≤位階<8。');
if(!m.symbols.length)console.log('目前無符合候選。');
function card(symbol,i,scenario){const lines=[];const x=r.rows.find(x=>x.symbol===symbol),p=x.premarket_final,d=x.daily_metrics,h=x.hourly_evidence,b=x.top_buy_branch,t=x.telegram_intraday_notification;
 const score=scenario==='B'?x.b_condition_score:x.condition_score;
 lines.push('\n'+'━'.repeat(40));
 lines.push(`第 ${i+1} 名｜${symbol} ${x.name}｜${scenario==='B'?x.dual_scenario.b.grade.replace(/^B-/,'A-'):'B弱勢延續／'+({A:'最佳區',B:'次佳區',WATCH:'偏低觀察'}[p.short_candidate_grade]||'未確認')}｜條件分數 ${score?.score??0}/${score?.max_score??8}`);
 if(score?.missing?.length)lines.push('  尚未確認：'+score.missing.join('、'));
 lines.push(`  1. 總成交量：${fmt(d.volume_lots)}張｜>2,000張：${yn(d.volume_lots>2000)}`);
 lines.push(`  2. 外資：${flow(x.foreign)}｜投信：${flow(x.trust)}`);
 lines.push(`  3. 布林位階：${fmt(p.boll_level_raw,4)}；高檔門檻取整：${fmt(x.dual_scenario.b.level_gate_value,0)}`);
 lines.push(`  4. 月線斜率：${fmt(p.month_slope_raw,1)}%（原始 ${fmt(p.month_slope_raw,4)}%）`);
 lines.push(`     昨日：${fmt(p.month_slope_yesterday,4)}%｜變化：${fmt(p.slope_delta,4)}百分點`);
 lines.push(`     連續下降：${fmt(p.slope_down_days,0)}日`);
 if(scenario==='B'){lines.push('     背景：'+x.dual_scenario.b.background_evidence.join('、')+'｜'+x.dual_scenario.b.zone);lines.push('     轉弱證據：'+(x.dual_scenario.b.evidence.join('、')||'尚無已確認訊號')+'；等待盤中確認');}
 else lines.push('     趨勢：'+p.month_trend_strength+'｜位置：'+({BEST:'最佳區',ACCEPTABLE:'中軌附近',LOW_WARNING:'偏低觀察'}[x.dual_scenario.a.position]||'未確認'));
 lines.push(`  5. 日K均線：股價低於MA5／MA10／MA20：${yn(d.price_below_all_ma)}`);
 lines.push(`  6. 60分K均線：最後一根收盤低於MA5／MA10／MA20：${yn(h?.price_below_all_ma)}`);
 lines.push(`  7. 週轉率：${fmt(x.turnover_rate)}%｜>5%：${yn(valid(x.turnover_rate)?x.turnover_rate>5:null)}`);
 lines.push(`  8. 漲跌幅：${fmt(d.change_percent)}%｜漲幅>5%：${yn(valid(d.change_percent)?d.change_percent>5:null)}｜收盤漲停：${yn(d.limit_locked)}`);
 lines.push(`  9. 自營商：買量${fmt(x.dealer?.buy)}張／賣量${fmt(x.dealer?.sell)}張｜${flow(x.dealer)}`);
 lines.push(`  10. TELEGRAM盤中巨量：${t?.status==='SENT'?'有通知（'+t.count+'筆）':t?.status==='NO_SENT_BURST'?'未查到已發送的巨量通知':'通知來源未確認'}`);
 lines.push(`  11. 買超第一分點：${b?.securities_trader||'未確認'}／成本${fmt(b?.price)}元`);
 if(scenario==='B')lines.push('  優先加分：漲停＋凱基城中買一成本＝收盤：'+yn(x.branch_priority?.matched)+(x.branch_priority?.matched===true?'，加1分':''));
 lines.push('\n  預言家（策略價位）：');
 if(valid(b?.price)&&b.price>0){
  lines.push(`    ${fmt(b.price)} × 1.03 ＝ ${(b.price*1.03).toFixed(2)}元 → 做空觀察價`);
  lines.push(`    ${fmt(b.price)} × 0.98 ＝ ${(b.price*0.98).toFixed(2)}元 → 回補、做多觀察價`);
 }else lines.push('    買一分點成本未確認，無法計算');
 lines.push('\n  備註：隔天相對昨收開高／開低達5%，直接跳過（人工確認）。');
 lines.push(scenario==='A'?'  盤中：不追開低；等反彈壓力無法突破、再次轉弱。':'  盤中：不摸頭；等壓力不過、破支撐或反彈站不回。');
 lines.push('  真正進場須由開盤定位、支撐壓力與盤中結構確認。');
 lines.push('  策略價位僅供觀察，非自動進出場訊號。');
return lines.flatMap(line=>line.split('\n'));}

const chosen=m.symbols.map(symbol=>r.rows.find(x=>x.symbol===symbol));
const top=Number(arg('top',30));
const aRows=m.a_symbols.map(s=>r.rows.find(x=>x.symbol===s));
// Report keys remain backward compatible; presentation A=high distribution, B=weak continuation.
const left=m.b_symbols.map(s=>r.rows.find(x=>x.symbol===s)).slice(0,top);
const right=aRows.filter(x=>x.dual_scenario.a.grade!=='WATCH').slice(0,top);
const cells=Array.from({length:Math.max(left.length,right.length)},(_,i)=>({left:left[i]?card(left[i].symbol,i,'B'):[],right:right[i]?card(right[i].symbol,i,'A'):[]}));
const width=text=>[...text].reduce((n,c)=>n+(/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\ufe10-\ufe6f\uff01-\uff60\uffe0-\uffe6]/u.test(c)?2:1),0);
const columnWidth=Math.max(36,...cells.flatMap(c=>c.left.map(width)))+2;
const pair=(a,b)=>console.log(a+' '.repeat(Math.max(0,columnWidth-width(a)))+'│ '+b);
pair('A高檔出貨空','B弱勢延續空');
 pair('依分數由高至低（'+left.length+'檔）','依分數由高至低（'+right.length+'檔）');
if(!left.length&&!right.length)pair('目前無A劇本候選','目前無B劇本候選');
else {if(!left.length)pair('目前無A劇本主要候選','');if(!right.length)pair('','目前無B劇本候選');}
for(const c of cells)for(let i=0;i<Math.max(c.left.length,c.right.length);i++)pair(c.left[i]||'',c.right[i]||'');
console.log('\nB偏低觀察｜位階低於0，追空風險提高｜依分數由高至低');
const watch=aRows.filter(x=>x.dual_scenario.a.grade==='WATCH').slice(0,top);
if(!watch.length)console.log('目前無偏低觀察標的。');
for(const x of watch)console.log(x.symbol+' '+x.name+'｜'+x.condition_score.score+'/8分｜位階 '+fmt(x.premarket_final.boll_level_raw)+'｜月斜率 '+fmt(x.premarket_final.month_slope_raw,4)+'%');
