'use strict';
const crypto=require('node:crypto');
const {select,POLICY}=require('./stock-future-standard-selection.cjs');
const catalogue=require('./mother-pool-futures-catalogue');
const mapping=require('./taifex-stock-future-mapping');
const sha=s=>crypto.createHash('sha256').update(s,'utf8').digest('hex');
const PRODUCTS='https://api.fugle.tw/marketdata/v1.0/futopt/intraday/products?type=FUTURE&exchange=TAIFEX&session=REGULAR&contractType=S';
const DISPLAY='stock-future-standard-display-v1';
function build(snapshot,observation,{tradeDate,asOf,expiryEvidence={}}){
 const checked=catalogue.inspect(snapshot,tradeDate,asOf);
 if(checked.status!=='READY')throw Error('CANDIDATE_CATALOGUE_INVALID');
 const at=Date.parse(asOf),observed=Date.parse(observation?.received_at);
 const observationOk=observation?.url===PRODUCTS&&observation?.http_status===200&&typeof observation.raw_text==='string'&&sha(observation.raw_text)===observation.raw_sha256&&Number.isFinite(observed)&&observed<=at&&new Date(observed+28800000).toISOString().slice(0,10)===tradeDate;
 let products=[];
 if(observationOk){const p=JSON.parse(observation.raw_text);if(p.type==='FUTURE'&&p.exchange==='TAIFEX'&&p.session==='REGULAR'&&p.contractType==='S'&&Array.isArray(p.data))products=p.data;}
 const productMap=new Map();
 for(const p of products){if(productMap.has(p.symbol))throw Error('DUPLICATE_PRODUCT_METADATA');productMap.set(p.symbol,p);}
 const official=new Map(mapping.parse(snapshot.raw_taifex_html).map(r=>[r.product_code,r]));
 const candidates=[];
 for(const r of snapshot.raw_fugle.data){
  if(r.contractType!=='S')continue;
  const code=r.symbol.slice(0,-2),o=official.get(code.slice(0,2));
  if(!o?.common_stock||!o.stock_future||!/^\d{4}$/.test(o.symbol))continue;
  const p=productMap.get(code),reasons=[];
  let classification='UNKNOWN',verified=false;
  const identity=p&&p.symbol===code&&p.underlyingSymbol===o.symbol&&p.type==='FUTURE'&&p.contractType==='S'&&p.underlyingType==='S'&&p.expiryType==='S';
  if(identity){
   // Product identity and size classify first. Display transformations never classify.
   if(/^[A-Z]{2}[0-9]$/.test(code))classification='ADJUSTED';
   else if(/^[A-Z]{2}F$/.test(code)&&p.contractSize===100&&p.name.startsWith('小型'))classification='MINI';
   else if(/^[A-Z]{2}F$/.test(code)&&p.contractSize===2000&&!p.name.startsWith('小型'))classification='STANDARD';
   verified=classification!=='UNKNOWN';
  }
  if(!verified)reasons.push('PRODUCT_CLASSIFICATION_UNVERIFIED');
  if(!observationOk)reasons.push('SAME_DAY_PRODUCT_EVIDENCE_MISSING');
  const expiry=r.endDate,validDate=/^\d{4}-\d{2}-\d{2}$/.test(expiry||'')&&r.settlementDate===expiry;
  const month=validDate?expiry.slice(0,7):null;
  const suffix=validDate?expiry.slice(5,7)+expiry.slice(3,4):null;
  const nameOk=!!(identity&&validDate&&r.name===p.name+suffix&&p.name.endsWith('期貨'));
  if(!nameOk)reasons.push('NAME_MONTH_YEAR_CONFLICT');
  if(!validDate)reasons.push('EXPIRY_UNVERIFIED');
  const active=!!(p&&p.statusCode==='N'&&p.quoteAcceptable===true&&p.startDate<=tradeDate&&r.startDate<=tradeDate);
  if(!active)reasons.push('PRODUCT_NOT_ACTIVE');
  const display=nameOk&&classification==='STANDARD'?p.name.slice(0,-2)+'期'+expiry.slice(5,7):null;
  candidates.push({underlying_symbol:o.symbol,stock_name:o.name,future_symbol:r.symbol,product_code:code,raw_name:r.name,display_name:display,display_name_rule:DISPLAY,display_name_origin:'mother_pool_derived_not_provider_screen_capture',contract_month:month,expiry_date:expiry,contract_size:p?.contractSize??null,contract_size_unit:'underlying_shares',classification,classification_verified:verified&&observationOk&&nameOk&&active&&validDate,evidence_trade_date:observationOk?tradeDate:null,evidence_observed_at:observation?.received_at??null,valid_from:r.startDate+'T00:00:00+08:00',valid_until:validDate?expiry+'T13:30:00+08:00':null,expiry_time_source:'https://www.taifex.com.tw/cht/2/sTF',catalogue_run_id:snapshot.run_id,catalogue_source_hash:snapshot.source_hash,catalogue_observed_at:snapshot.observed_at,product_source_url:PRODUCTS,product_source_sha256:observation?.raw_sha256??null,raw_product:p??null,raw_contract:r,exclusion_reasons:reasons});
 }
 const resolutions=select(candidates,{tradeDate,asOf,expiryEvidence});
 for(const r of resolutions)for(const c of r.candidates){c.selection_status=r.status;c.selected=r.selected===c.future_symbol;c.target_month=r.target_month;if(!c.selected){if(c.classification!=='STANDARD')c.exclusion_reasons.push('NOT_STANDARD');if(c.contract_month!==r.target_month)c.exclusion_reasons.push('NOT_TARGET_MONTH');if(r.reason)c.exclusion_reasons.push(r.reason);}}
 return {contract:'stock-future-candidates-v1',policy:POLICY,trade_date:tradeDate,catalogue_run_id:snapshot.run_id,catalogue_source_hash:snapshot.source_hash,generated_at:asOf,product_observed_at:observation?.received_at??null,candidates:candidates.sort((a,b)=>a.underlying_symbol.localeCompare(b.underlying_symbol)||a.future_symbol.localeCompare(b.future_symbol)),resolutions:resolutions.map(({candidates,...r})=>r),counts:{symbols:resolutions.length,candidates:candidates.length,unique:resolutions.filter(r=>r.status==='UNIQUE').length,missing_evidence:resolutions.filter(r=>r.status==='MISSING_EVIDENCE').length,no_match:resolutions.filter(r=>r.status==='NO_MATCH').length,multiple:resolutions.filter(r=>r.status==='MULTIPLE').length}};
}
module.exports={build,PRODUCTS,DISPLAY};
