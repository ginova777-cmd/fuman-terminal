'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),names=require('./mops-industry-names');
const file=path.join(__dirname,'..','api','heatmap.js');
let cached;
function staticMapping(){
 if(cached)return cached;
 const text=fs.readFileSync(file,'utf8'),start=text.indexOf('const BB_HEATMAP_GROUPS ='),begin=text.indexOf('{',start);
 if(start<0||begin<0)throw Error('STATIC_MAPPING_MISSING');
 let depth=0,quote='',escape=false,end=-1;
 for(let i=begin;i<text.length;i++){const c=text[i];if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote='';continue;}if(c==='"'||c==="'"||c==='`'){quote=c;continue;}if(c==='{')depth++;if(c==='}'&&--depth===0){end=i+1;break;}}
 if(end<0)throw Error('STATIC_MAPPING_INVALID');
 const groups=Function('"use strict";return ('+text.slice(begin,end)+');')();
 cached={version:crypto.createHash('sha256').update(text).digest('hex'),groups,valid_from:'2026-07-09'};return cached;
}
function publicationDate(value){
 const digits=String(value||'').replace(/\D/g,'');
 if(digits.length===7)return String(Number(digits.slice(0,3))+1911)+'-'+digits.slice(3,5)+'-'+digits.slice(5,7);
 if(digits.length===8)return digits.slice(0,4)+'-'+digits.slice(4,6)+'-'+digits.slice(6,8);
 return null;
}
function evaluate({symbol,classification:c,tradeDate,asOf}){
 const failed=[];const e=c?.officialEvidence,d=c?.detailedEvidence,raw=e?.raw_row;
 const sourceDate=publicationDate(raw?.['出表日期']),code=String(raw?.['產業別']||'').padStart(2,'0'),official=names[code];
 const age=Date.parse(asOf)-Date.parse(e?.fetched_at);
 if(!['https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv','https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv'].includes(e?.source_url)||!/^[a-f0-9]{64}$/.test(e?.response_sha256||''))failed.push('OFFICIAL_SOURCE_UNPROVEN');
 if(!raw||String(raw['公司代號'])!==symbol||!official||official!==c?.industryParent)failed.push('OFFICIAL_MAPPING_MISMATCH');
 if(!sourceDate||sourceDate>tradeDate||!Number.isFinite(age)||age<0||age>12*3600000)failed.push('OFFICIAL_MAPPING_DATE_OR_AGE');
 let mapping;try{mapping=staticMapping();}catch{failed.push('STATIC_MAPPING_UNAVAILABLE');}
 if(!d||d.source!=='api/heatmap.js:BB_HEATMAP_GROUPS'||d.symbol!==symbol||d.version!==mapping?.version||d.valid_from!==mapping?.valid_from||d.valid_from>tradeDate||({'IC生產製造':'IC代工','IC設計服務':'IC設計','CPU/ASIC/IP':'IC設計'}[d.industry]||d.industry)!==c?.industry||!mapping?.groups[d.industry]?.map(String).includes(symbol))failed.push('DETAILED_MAPPING_UNPROVEN');
 return {failed_checks:failed,industry_code:code,industry_name:c?.industry||null,official_industry:official||null,source_date:sourceDate,mapping_source:d?.source||null,mapping_version:d?.version||null,valid_from:d?.valid_from||null};
}
function verify(row,asOf){const r=evaluate({symbol:row.symbol,classification:row.classification,tradeDate:row.trade_date,asOf});return row.status==='READY'&&!r.failed_checks.length&&['industry_code','industry_name','official_industry','source_date','mapping_source','mapping_version','valid_from'].every(k=>row[k]===r[k]);}
module.exports={evaluate,verify,staticMapping};
