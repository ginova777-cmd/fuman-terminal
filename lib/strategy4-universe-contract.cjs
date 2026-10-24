'use strict';
const fs=require('fs'),crypto=require('crypto');
const COUNT=1943,SHA='3588d7c97604cc3569812592f3a62120e94e8afd4f411b8b855b4db9745c8403';
const digest=s=>crypto.createHash('sha256').update(JSON.stringify([...s].sort())).digest('hex');
function load(file,targetDate){
 const contract=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')),symbols=contract.symbols;
 if(contract.contract!=='strategy4_user_approved_fixed_universe_v1'||contract.approved_by!=='user')throw Error('strategy4_universe_approval_missing');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)||targetDate<contract.trade_date)throw Error('strategy4_universe_reference_date_invalid');
 if(!Array.isArray(symbols)||symbols.length!==COUNT||contract.requested_count!==COUNT||new Set(symbols).size!==COUNT||symbols.some(s=>typeof s!=='string'||!/^\d{4}$/.test(s)))throw Error('strategy4_universe_symbols_invalid');
 if(digest(symbols)!==SHA||contract.symbols_sha256!==SHA)throw Error('strategy4_universe_hash_invalid');
 return {file,contract,symbols:[...symbols],sha:SHA,count:COUNT};
}
function freeze(approved,rows,targetDate){
 const symbols=rows.map(r=>String(r.code||r.symbol));
 if(symbols.length!==COUNT||new Set(symbols).size!==COUNT||digest(symbols)!==SHA)throw Error('strategy4_eligible_set_drift_requires_approval');
 return {contract:'strategy4_scan_universe_v2',referenceDate:approved.contract.trade_date,tradeDate:targetDate,count:COUNT,sha256:SHA,symbols:[...symbols].sort(),source:'strategy4_stock_universe_view',sourceReadAt:new Date().toISOString(),legacyExclusionsApplied:false};
}
function validateEvidence(e,scanned,date){
 return !!e&&e.contract==='strategy4_scan_universe_v2'&&e.tradeDate===date&&e.count===COUNT&&e.sha256===SHA&&e.legacyExclusionsApplied===false&&e.source==='strategy4_stock_universe_view'&&Array.isArray(e.symbols)&&e.symbols.length===COUNT&&new Set(e.symbols).size===COUNT&&digest(e.symbols)===SHA&&Array.isArray(scanned)&&scanned.length===COUNT&&new Set(scanned).size===COUNT&&digest(scanned)===SHA;
}
module.exports={COUNT,SHA,digest,load,freeze,validateEvidence};
