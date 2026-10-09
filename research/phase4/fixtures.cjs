'use strict';
// Synthetic offline evidence only. No formal source/quality assertion.
function bars(symbol,{date='2026-10-06',start='12:38',count=22}={}){
 return Array.from({length:count},(_,i)=>{const t=Date.parse(`${date}T${start}:00+08:00`)+i*60000,p=100+i*.01;return {stock_id:symbol,trade_date:date,timestamp:new Date(t).toISOString(),open:p,high:p+.1,low:p-.1,close:p,volume_raw:i===count-1?50:10,volume_raw_unit:'LOTS',complete:true,is_synthetic:false,available_at:new Date(t+60000).toISOString(),source:'Fugle.websocket.candles.TSE_OTC'};});
}
function data(symbol,options={}){const date=options.date||'2026-10-06';return {current:bars(symbol,options),history:[],pool:{name:symbol,trade_date:date},quote:{price:106,previous_close:100,change_percent:6,limit_up_price:110},technical:{source_ready:false},atr:{source_ready:false}};}
function gate(identity,{date='2026-10-06',asOf=date+'T13:00:00+08:00'}={}){return {ok:true,identity,mode:'OFFLINE_FIXTURE',trade_date:date,as_of:asOf};}
module.exports={bars,data,gate};
