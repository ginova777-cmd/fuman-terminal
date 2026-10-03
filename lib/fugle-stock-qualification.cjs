'use strict';
const {createHash}=require('node:crypto');
const DOC='https://developer.fugle.tw/docs/data/http-api/intraday/ticker/';
const boolean=value=>typeof value==='boolean'?value:null;
function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
function mapFugleStockQualification({body,expectedSymbol,tradeDate,receivedAt,nowMs=Date.now()}){
 const raw=body&&typeof body==='object'&&!Array.isArray(body)?body:{};
 const reasons=[];
 if(!/^\d{4}$/.test(expectedSymbol||'')||raw.symbol!==expectedSymbol)reasons.push('SYMBOL_MISMATCH');
 if(!validDate(tradeDate)||raw.date!==tradeDate)reasons.push('TRADE_DATE_MISMATCH');
 const received=typeof receivedAt==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(receivedAt)?Date.parse(receivedAt):NaN;
 if(!Number.isFinite(nowMs)||!Number.isFinite(received)||received>nowMs)reasons.push('RECEIVE_TIME_INVALID');
 const market={TSE:'TWSE',OTC:'TPEx',TIB:'TWSE',ESB:'TPEx'}[raw.market];
 if(!market||raw.exchange!==market)reasons.push('MARKET_EXCHANGE_MISMATCH');
 const valid=!reasons.length;
 const knownType=typeof raw.securityType==='string'&&/^(0[1-9]|[1-3][0-9]|4[0-7])$/.test(raw.securityType);
 const common=valid&&knownType?(raw.securityType==='01'?(raw.type==='EQUITY'?true:null):false):null;
 const status=valid&&['NORMAL','SUSPENDED','TERMINATED'].includes(raw.securityStatus)?raw.securityStatus:null;
 const fields={is_common_stock:common,
  // Security status only; consumers must additionally check current halt/trial.
  is_tradable:status===null?null:status==='NORMAL',
  daytrade_allowed:valid?boolean(raw.canDayTrade):null,
  buy_daytrade_allowed:valid?boolean(raw.canBuyDayTrade):null,
  is_suspended:status===null?null:status==='SUSPENDED',
  is_disposition:valid?boolean(raw.isDisposition):null,
  is_attention:valid?boolean(raw.isAttention):null,
  is_halted:null,is_trial:null};
 const sourceFields={is_common_stock:'securityType + type',is_tradable:'securityStatus',daytrade_allowed:'canDayTrade',
  buy_daytrade_allowed:'canBuyDayTrade',is_suspended:'securityStatus',is_disposition:'isDisposition',is_attention:'isAttention'};
 const evidence=Object.fromEntries(Object.keys(fields).map(field=>[field,{value:fields[field],
  source_field:sourceFields[field]||null,missing_reason:fields[field]!==null?null:
    !valid?reasons.join('|'):!sourceFields[field]?'NOT_PROVIDED_BY_TICKER':'MISSING_INVALID_OR_CONFLICTING_FIELD'}]));
 return {contract:'fugle-stock-qualification-v1',symbol:expectedSymbol,trade_date:tradeDate,provider:'Fugle',
  identity_valid:valid,identity_errors:reasons,source:'fugle.intraday.ticker',source_documentation:DOC,
  source_date:raw.date||null,source_event_at:null,received_at:Number.isFinite(received)?new Date(received).toISOString():null,
  raw_json_sha256:createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
  security_type:raw.securityType??null,security_status:raw.securityStatus??null,
  stock_type:common===true?'COMMONSTOCK':common===false?'NON_COMMON_STOCK':null,
  ...fields,fields:evidence,missing_fields:Object.keys(fields).filter(key=>fields[key]===null),
  formal_eligibility_evaluated:false,raw};
}
module.exports={mapFugleStockQualification};
