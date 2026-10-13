'use strict';
const {createHash}=require('node:crypto');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function collect(a){
 const b=a.segmentBinding,from=Date.parse(b?.window?.from),to=Date.parse(b?.window?.to),now=Date.parse(a.asOf);
 const gaps=[],tradesBySymbol={},receipts={};
 const binding={contract:'isolated_verified_trade_window_v1',epoch:b?.epoch??null,trade_date:a.tradeDate,requested_window:b?.window??null,observed_at:a.asOf,provider_completeness:false,scope:'local captured received-time window [from,to]',gaps};
 const fail=r=>gaps.push(r);
 if(!b||!/^\w[\w-]*$/.test(b.epoch||''))fail('EPOCH_REQUIRED');
 if(![from,to,now].every(Number.isFinite)||from>=to||to>now||[from,to].some(t=>new Date(t+28800000).toISOString().slice(0,10)!==a.tradeDate))fail('INVALID_WINDOW');
 if(!Array.isArray(a.symbols)||!a.symbols.length||new Set(a.symbols).size!==a.symbols.length||a.symbols.some(s=>!/^\d{4}$/.test(s)))throw Error('SYMBOLS_REQUIRED');
 for(const n of [a.maxTotalBytes,a.maxTotalRows,a.maxSymbols,b?.maxFiles])if(!Number.isSafeInteger(n)||n<1)fail('BUDGET_REQUIRED');
 if(a.symbols.length>a.maxSymbols)fail('SYMBOL_BUDGET');
 if(!gaps.length){
  const s=await require('./verify-trade-session.cjs').read({evidenceRoot:b.evidenceRoot,journalRoot:a.root,epoch:b.epoch,asOf:a.asOf,maxFiles:b.maxFiles,maxBytes:a.maxTotalBytes,maxRows:a.maxTotalRows,includeRows:true});
  const {captured,...evidence}=s;binding.session_evidence=evidence;
  if(!s.continuity_verified)fail('SESSION_DATA_GAP');
  const covering=s.sessions.filter(x=>Date.parse(x.opened_at)<=from&&Date.parse(x.closed_at)>=to);
  if(covering.length!==1)fail('WINDOW_GAP_OR_RECONNECT');
  if(!gaps.length){
   for(const symbol of a.symbols){
    const rows=captured.filter(x=>x.row.stock_id===symbol&&x.row.trade_date===a.tradeDate&&x.connection_id===covering[0].connection_id&&Date.parse(x.row.received_at)>=from&&Date.parse(x.row.received_at)<=to);
    if(!s.proofs.some(p=>p.symbol===symbol&&p.trade_date===a.tradeDate&&p.connection_id===covering[0].connection_id)){fail('SYMBOL_CAPTURE_UNPROVEN:'+symbol);continue;}
    // Consume the exact rows decoded from verified bytes, never a second file read.
    const used=rows.filter(x=>Date.parse(x.row.event_at)>=Date.parse(a.tradeDate+'T09:02:00+08:00'));
    tradesBySymbol[symbol]=used.map(x=>x.row);
    receipts[symbol]={epoch:b.epoch,window:b.window,rows:used.map(({row,...proof})=>({...proof,row_sha256:hash(row)})),trades_sha256:hash(tradesBySymbol[symbol])};
   }
  }
 }
 binding.status=gaps.length?'DATA_GAP':'LOCAL_WINDOW_VERIFIED';binding.symbols=receipts;binding.binding_sha256=hash(binding);
 return {tradesBySymbol:gaps.length?{}:tradesBySymbol,receipts,gaps:Object.fromEntries(a.symbols.filter(()=>gaps.length).map(s=>[s,gaps.join('|')])),continuity_verified:!gaps.length,segment_binding:binding};
}
module.exports={collect};
