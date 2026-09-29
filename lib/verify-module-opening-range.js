'use strict';
function validRange(range,tradeDate,symbol){
 if(range?.valid!==true||range.symbol!==symbol||range.trade_date!==tradeDate||!Array.isArray(range.bars)||range.bars.length!==5)return false;
 const event=Date.parse(range.as_of);
 if(!Number.isFinite(event)||event<Date.parse(tradeDate+'T09:05:00+08:00'))return false;
 return range.bars.every((bar,i)=>bar.symbol===symbol&&bar.trade_date===tradeDate&&bar.synthetic===false&&bar.natural===true&&bar.completed===true&&
  Date.parse(bar.timestamp)===Date.parse(tradeDate+`T09:0${i}:00+08:00`)&&Date.parse(bar.timestamp)+60000<=event&&
  Number.isFinite(bar.high)&&Number.isFinite(bar.low)&&bar.high>=bar.low&&bar.low>0)&&
  range.high===Math.max(...range.bars.map(b=>b.high))&&range.low===Math.min(...range.bars.map(b=>b.low));
}
function validAll(envelope,tradeDate,symbols){
 const map=envelope?.by_symbol;
 return Array.isArray(symbols)&&symbols.length>0&&map&&Object.keys(map).length===symbols.length&&symbols.every(s=>validRange(map[s],tradeDate,s));
}
module.exports={validRange,validAll};
