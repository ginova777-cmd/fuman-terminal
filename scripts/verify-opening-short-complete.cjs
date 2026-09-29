'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const {verifyRules}=require('./opening-short-rule-checks.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const finite=Number.isFinite,avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
const RETIRED_OPENING_SHORT_FILES=["scripts/verify-short-dual.cjs","scripts/verify-opening-short-readonly.js","ops/Run-OpeningShortPostcloseReadonly.ps1"];
function assertRetirement(){const root=path.resolve(__dirname,'..');const found=RETIRED_OPENING_SHORT_FILES.filter(f=>fs.existsSync(path.join(root,f)));if(found.length)throw Error('RETIRED_OPENING_SHORT_VERIFIER_PRESENT:'+found.join(','));}
function verify(file){
 assertRetirement();
 const r=JSON.parse(fs.readFileSync(file)),issues=[],check=(v,k)=>{if(!v)issues.push(k);};
 const near=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<1e-7*Math.max(1,Math.abs(b));
 const cache=path.join(path.dirname(file),'opening-short-sources-'+r.trade_date);
 const load=f=>JSON.parse(fs.readFileSync(f));
 const universe=load(r.source_files.universe).rows.filter(x=>!x.listing_date||x.listing_date<=r.trade_date.replaceAll('-',''));
 const symbols=a=>a.map(x=>x.symbol).sort();
 check(JSON.stringify(symbols(universe))===JSON.stringify(symbols(r.rows)),'universe_membership');
 check(new Set(symbols(r.rows)).size===r.rows.length&&r.checked_count===r.rows.length,'scan_count');
 for(const market of ['TWSE','TPEX'])check(r.universe_counts[market]===r.rows.filter(x=>x.market===market).length,'market_count:'+market);
 const rawDaily=load(path.join(cache,'daily.json'));
 for(const f of fs.readdirSync(cache).filter(f=>/^history-.*\.json$/.test(f)))rawDaily.push(...load(path.join(cache,f)));
 const by=new Map();for(const b of rawDaily){if(b.trade_date>r.trade_date)continue;const m=by.get(b.symbol)||new Map();m.set(b.trade_date,b);by.set(b.symbol,m);}
 const selected=new Set(r.premarket_final.symbols),unknownHourly=[];
 for(const x of r.rows){
  const bars=[...(by.get(x.symbol)?.values()||[])].sort((a,b)=>a.trade_date.localeCompare(b.trade_date));
  const last=bars.at(-1),p=x.premarket_final,d=x.daily_metrics;
  if(p.status==='OK'){
   const closes=bars.slice(-21).map(b=>b.close);
   check(last?.trade_date===r.trade_date&&closes.length===21&&closes.every(v=>finite(v)&&v>0),'daily_source:'+x.symbol);
   const m=avg(closes.slice(1)),prev=avg(closes.slice(0,20)),sd=Math.sqrt(avg(closes.slice(1).map(v=>(v-m)**2)));
   check(near(p.ma20_today,m)&&near(p.ma20_yesterday,prev)&&near(p.std20,sd)&&near(p.boll_level_raw,5*(last.close-m)/sd),'raw_formula:'+x.symbol);
  }
  if(last?.trade_date===r.trade_date){for(const n of [5,10,20]){const a=bars.slice(-n).map(b=>b.close);if(a.length===n&&a.every(finite))check(near(d['ma'+n],avg(a)),'daily_ma'+n+':'+x.symbol);}}
  check(x.creates_order!==true&&x.short_entry_signal==null&&x.dual_scenario.b.short_entry_signal==null,'no_order:'+x.symbol);
  if(!selected.has(x.symbol))continue;
  check(last?.trade_date===r.trade_date&&p.status==='OK'&&d.volume_lots>2000,'selected_required:'+x.symbol);
  for(const f of ['foreign','trust','dealer'])check(x[f]?.trade_date===r.trade_date&&['buy','sell','net'].every(k=>finite(x[f]?.[k])),'institution_fields:'+x.symbol+':'+f);
  const inst=load(path.join(cache,'institution.json')).filter(b=>String(b.stock_id)===x.symbol&&b.date===r.trade_date);
  for(const [field,names]of [['foreign',['Foreign_Investor','Foreign_Dealer_Self']],['trust',['Investment_Trust']],['dealer',inst.some(b=>b.name==='Dealer_self')?['Dealer_self','Dealer_Hedging']:['Dealer']]]){
   const a=inst.filter(b=>names.includes(b.name));check(names.every(n=>a.some(b=>b.name===n)),'institution_source:'+x.symbol+':'+field);
   check(near(x[field]?.buy,a.reduce((s,b)=>s+Number(b.buy),0)/1000)&&near(x[field]?.sell,a.reduce((s,b)=>s+Number(b.sell),0)/1000),'institution_raw:'+x.symbol+':'+field);
  }
  const branch=load(path.join(cache,'branch-'+x.symbol+'.json')),groups=new Map();
  for(const b of branch){if(b.date!==r.trade_date||String(b.stock_id)!==x.symbol||!b.securities_trader_id)continue;const g=groups.get(b.securities_trader_id)||{name:b.securities_trader,buy:0,sell:0,amount:0};g.buy+=Number(b.buy);g.sell+=Number(b.sell);g.amount+=Number(b.buy)*Number(b.price);groups.set(b.securities_trader_id,g);}
  const top=[...groups.values()].filter(b=>b.buy>b.sell).sort((a,b)=>(b.buy-b.sell)-(a.buy-a.sell))[0];
  check(top&&x.top_buy_branch?.securities_trader===top.name&&near(x.top_buy_branch?.price,top.amount/top.buy),'branch_raw:'+x.symbol);
  const h=x.hourly_evidence;
  if(!h?.source||!finite(h.ma20)){unknownHourly.push(x.symbol);check(h?.price_below_all_ma!==true,'missing_hourly_not_positive:'+x.symbol);continue;}
  const source=load(h.source);let a;
  if(source.sources){a=source.sources[x.symbol]?.hourly60||[];a=[...new Map(a.filter(b=>b.date.slice(0,10)<=r.trade_date).map(b=>[b.date,b])).values()].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));}
  else{
   check(source.symbol===x.symbol&&source.timeframe==='30','hourly_identity:'+x.symbol);const groups=new Map();
   for(const b of source.data||[]){const local=new Date(Date.parse(b.date)+8*3600000).toISOString(),day=local.slice(0,10),hour=Number(local.slice(11,13)),minute=Number(local.slice(14,16));if(day>r.trade_date||hour<9||hour>13||![0,30].includes(minute)||![b.open,b.high,b.low,b.close].every(v=>finite(v)&&v>0))continue;const k=day+'T'+local.slice(11,13);const g=groups.get(k)||new Map();g.set(minute,b);groups.set(k,g);}
   a=[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).filter(([,g])=>g.has(0)&&g.has(30)).map(([k,g])=>({date:k+':00:00+08:00',close:g.get(30).close}));
  }
  check(a.length>=20&&Date.parse(a.at(-1)?.date)===Date.parse(r.trade_date+'T13:00:00+08:00')&&Date.parse(a.at(-2)?.date)===Date.parse(r.trade_date+'T12:00:00+08:00'),'hourly_session:'+x.symbol);
  for(const n of [5,10,20])check(near(h['ma'+n],avg(a.slice(-n).map(b=>Number(b.close)))),'hourly_ma'+n+':'+x.symbol);
  check(h.price_below_all_ma===[h.ma5,h.ma10,h.ma20].every(v=>h.close<v),'hourly_below_ma:'+x.symbol);
 }
 const tests={daily:x=>x.daily_metrics.volume_lots!==null&&x.daily_metrics.change_percent!==null,technical:x=>[x.daily_metrics.ma5,x.daily_metrics.ma10,x.daily_metrics.ma20,x.daily_metrics.previous_ma20,x.daily_metrics.bollinger_upper].every(finite),turnover:x=>finite(x.turnover_rate),institution:x=>x.foreign&&x.trust&&x.dealer,branch:x=>x.top_buy_branch};
 for(const [key,test]of Object.entries(tests)){const a=['institution','branch'].includes(key)?r.rows.filter(x=>selected.has(x.symbol)):r.rows;const passed=a.filter(test).length,ratio=a.length?passed/a.length:1,minimum=['institution','branch'].includes(key)?1:.9,v=r.coverage_checks[key];check(v&&v.passed===passed&&v.total===a.length&&v.minimum===minimum&&near(v.ratio,ratio)&&ratio>=minimum,'coverage:'+key);}
 const rules=verifyRules(r);for(const issue of rules.issues)check(false,'rules:'+issue);
 const rendered=cp.spawnSync(process.execPath,[path.join(__dirname,'show-opening-short.cjs'),'--report='+file,'--top='+r.rows.length],{encoding:'utf8',windowsHide:true,maxBuffer:20*1024*1024});
 check(rendered.status===0,'display_exit');const display=rendered.stdout||'';
 check(display.includes(r.trade_date)&&display.includes('A高檔出貨空')&&display.includes('B弱勢延續空'),'display_header');
 for(const x of r.rows.filter(x=>selected.has(x.symbol)))check(display.includes(x.symbol+' '+x.name),'display_member:'+x.symbol);
 if(!selected.size)check(display.includes('目前無符合候選'),'display_zero');
 const counts={scanned:r.rows.length,high:r.premarket_final.b_symbols.length,weak:r.premarket_final.a_symbols.filter(s=>r.rows.find(x=>x.symbol===s).dual_scenario.a.grade!=='WATCH').length,lowWatch:r.premarket_final.a_symbols.filter(s=>r.rows.find(x=>x.symbol===s).dual_scenario.a.grade==='WATCH').length,selected:selected.size};
 return {ok:!issues.length,issues,counts,coverage:r.coverage_checks,optional_hourly_missing:unknownHourly,display,display_sha256:hash(display),trade_date:r.trade_date,source_cache:cache};
}
module.exports={verify,hash,assertRetirement};
if(require.main===module){const file=process.argv.find(x=>x.startsWith('--report='))?.slice(9);try{const v=verify(file);delete v.display;console.log(JSON.stringify(v,null,2));if(!v.ok)process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
