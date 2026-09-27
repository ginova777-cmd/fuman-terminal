'use strict';
const fs=require('node:fs'),path=require('node:path');
const {isClosedRow,isExplicitTradingRow}=require('../../scripts/twse-trading-day');
const {produce}=require('./natural-source-runner.cjs');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
function calendarFromCache({runtimeRoot,tradeDate}){
 const year=Number(tradeDate.slice(0,4)),file=path.join(runtimeRoot,'state',`twse-holiday-schedule-${year}.json`);
 let p;try{p=read(file);}catch{return {verified:false,source:file,trading_dates:[],reason:'CALENDAR_CACHE_MISSING'};}
 if(!Array.isArray(p.rows)||!p.rows.length||!Number.isFinite(Date.parse(p.cachedAt)))return {verified:false,source:file,trading_dates:[],reason:'CALENDAR_CACHE_INVALID'};
 const dates=[];
 for(let d=new Date(Date.UTC(year,0,1));d.getUTCFullYear()===year;d.setUTCDate(d.getUTCDate()+1)){
  const date=d.toISOString().slice(0,10),roc=String(year-1911)+date.slice(5).replace('-','');
  const row=p.rows.find(r=>String(r.Date)===roc);
  if(row&&isExplicitTradingRow(row)||!(row&&isClosedRow(row))&&![0,6].includes(d.getUTCDay()))dates.push(date);
 }
 return {verified:true,source:file,cached_at:p.cachedAt,trading_dates:dates,scope:'cached_twse_calendar_no_network',year};
}
function readIntraday({runtimeRoot,asOf}){
 try{const p=produce({runtimeRoot,now:asOf}),histories={};for(const symbol of Object.keys(p.groups)){try{histories[symbol]=read(path.join(runtimeRoot,'data/telegram-detectors/history',symbol+'.json')).candles||[];}catch{histories[symbol]=[];}}return {groups:p.groups,quotes:p.quotes,histories,source_proof:p.proof};}
 catch(e){return {groups:{},quotes:{},histories:{},source_proof:{complete:false,failed_checks:[e.message]}};}
}
module.exports={calendarFromCache,readIntraday};
