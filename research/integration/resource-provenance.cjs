'use strict';
const {hash,bytes}=require('./offline-store.cjs');
function verifyResource(e,frame){const p=e.provenance;if(!p||p.symbol!==e.symbol||p.trade_date!==frame.trade_date||p.epoch!==frame.epoch||p.as_of!==frame.asOf||p.payload_sha256!==hash(bytes(e.payload))||!Array.isArray(p.sources)||!p.sources.length)throw Error('NATIVE_RESOURCE_PROVENANCE');
 for(const s of p.sources){if(!s.source||!s.version||!/^[a-f0-9]{64}$/.test(s.sha256)||!Number.isFinite(Date.parse(s.available_at))||Date.parse(s.available_at)>Date.parse(frame.asOf)||s.raw===undefined||hash(bytes(s.raw))!==s.sha256)throw Error('NATIVE_RESOURCE_SOURCE');}
 return structuredClone(p);
}
module.exports={verifyResource};
