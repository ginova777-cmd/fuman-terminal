'use strict';
// Configuration parsing only. Recovery files are verified in the side worker.
const path=require('node:path');
function startup({root,producerVersion,limitsJson,startJson,quoteCacheFile,candleCacheFile}){
 if(!path.isAbsolute(root||'')||typeof startJson!=='string'||startJson.length>16384||typeof limitsJson!=='string'||limitsJson.length>4096)throw Error('C2_EXPLICIT_START_CONFIG_REQUIRED');
 const s=JSON.parse(startJson),limits=JSON.parse(limitsJson);
 if(!path.isAbsolute(quoteCacheFile||'')||!path.isAbsolute(candleCacheFile||''))throw Error('C2_FORMAL_CACHE_PATHS_REQUIRED');
 if(s.contract!=='mother-evidence-start-v2-c2'||! /^[0-9a-f-]{36}$/i.test(s.epoch||''))throw Error('C2_START_IDENTITY_INVALID');
 for(const kind of ['quote','candle'])if(!path.isAbsolute(s.recovery?.[kind]?.path||'')||! /^[0-9a-f]{64}$/i.test(s.recovery[kind].sha256||''))throw Error('C2_RECOVERY_REFERENCE_REQUIRED');
 const common={producerVersion,epoch:s.epoch,limits,controlFile:path.join(root,'control.json')};
 return {quote:{...common,kind:'quote',dir:path.join(root,s.epoch,'quotes'),recovery:s.recovery.quote,recoverySourceCache:quoteCacheFile},candle:{...common,kind:'candle',dir:path.join(root,s.epoch,'candles'),recovery:s.recovery.candle,recoverySourceCache:candleCacheFile}};
}
module.exports={startup};
