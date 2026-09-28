'use strict';
function describe(rows,baseDate){
 const prices=rows.filter(r=>r.date<=baseDate).sort((a,b)=>a.date.localeCompare(b.date));const r=prices.at(-1);
 if(!r||r.date!==baseDate||![r.open,r.high,r.low,r.close].every(Number.isFinite))return {candle:'未確認',close_position:'未確認',bollinger:'未確認'};
 const body=r.close>r.open?'紅K':r.close<r.open?'黑K':'開收同價';const upper=r.high>Math.max(r.open,r.close),lower=r.low<Math.min(r.open,r.close);
 const candle=[body,upper?'有上影線':'無上影線',lower?'有下影線':'無下影線'].join('／');
 const close_position=r.high===r.low?'單一價':r.close===r.high?'收最高':r.close===r.low?'收最低':r.close>(r.high+r.low)/2?'收高（區間上半）':r.close<(r.high+r.low)/2?'收低（區間下半）':'收區間中點';
 const window=prices.slice(-20);let bollinger='未確認（不足20日）',bands=null;
 if(window.length===20&&new Set(window.map(r=>r.date)).size===20&&window.every(r=>Number.isFinite(r.close))){const middle=window.reduce((s,r)=>s+r.close,0)/20,std=Math.sqrt(window.reduce((s,r)=>s+(r.close-middle)**2,0)/20),upper=middle+2*std,lower=middle-2*std;bands={period:20,multiplier:2,middle,upper,lower};bollinger=std===0?'中軌（三軌重合）':r.close>upper?'上軌外':r.close===upper?'上軌':r.close>middle?'中上軌間':r.close===middle?'中軌':r.close>lower?'中下軌間':r.close===lower?'下軌':'下軌外';}
 return {candle,close_position,bollinger,bands,scope:'display_only_not_strategy_signal'};
}
module.exports={describe};

