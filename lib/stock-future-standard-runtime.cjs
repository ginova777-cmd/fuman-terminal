'use strict';
const catalogue=require('./mother-pool-futures-catalogue');
const products=require('./stock-future-products-cache.cjs');
const contract=require('./stock-future-candidate-contract.cjs');
const fs=require('node:fs'),path=require('node:path');
async function refresh(options){
 const snapshot=await catalogue.refresh(options);
 const productEvidence=await products.obtain(options);
 const expiryEvidence={};
 const productMap=new Map(JSON.parse(productEvidence.raw_text).data.map(p=>[p.symbol,p]));
 const files=fs.readdirSync(path.join(options.runtime,'data','futures-catalogue')).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)&&f.slice(0,7)===options.tradeDate.slice(0,7)&&f.slice(0,10)<options.tradeDate).sort().reverse().slice(0,31);
 for(const file of files){
  const past=JSON.parse(fs.readFileSync(path.join(options.runtime,'data','futures-catalogue',file),'utf8'));
  const check=catalogue.inspect(past,past.trade_date,past.observed_at);if(check.status!=='READY')continue;
  const native=new Map(past.raw_fugle.data.map(r=>[r.symbol,r]));
  for(const m of check.mapped){const raw=native.get(m.future_symbol);
   if(expiryEvidence[m.underlying_symbol]||!raw||raw.endDate?.slice(0,7)!==options.tradeDate.slice(0,7)||raw.settlementDate!==raw.endDate||Date.parse(raw.endDate+'T13:30:00+08:00')>Date.parse(options.asOf))continue;
   const p=productMap.get(raw.symbol.slice(0,-2));
   if(p?.underlyingSymbol!==m.underlying_symbol||p.contractSize!==2000||p.name.startsWith('小型')||!/^\w\wF$/.test(p.symbol))continue;
   expiryEvidence[m.underlying_symbol]={verified:true,contract_month:raw.endDate.slice(0,7),valid_until:raw.endDate+'T13:30:00+08:00',future_symbol:raw.symbol,catalogue_run_id:past.run_id,catalogue_source_hash:past.source_hash,catalogue_observed_at:past.observed_at,raw_contract:raw};
  }
 }
 return {...snapshot,standard_product_evidence:productEvidence,standard_expiry_evidence:expiryEvidence};
}
function resolve(snapshot,tradeDate,asOf){return contract.build(snapshot,snapshot.standard_product_evidence,{tradeDate,asOf,expiryEvidence:snapshot.standard_expiry_evidence||{}});}
module.exports={refresh,resolve};
