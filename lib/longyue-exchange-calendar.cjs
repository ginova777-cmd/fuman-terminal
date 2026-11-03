'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifestHash='303bff06400e4f09956bc221d55498b6bf3147c71780a01a56710b67794b1bea';
function resolve(date,fallback){
 if(date!=='2026-10-23')return fallback(date);
 const dir=path.join(__dirname,'calendar-evidence'),raw=fs.readFileSync(path.join(dir,'manifest.json'));
 if(hash(raw)!==manifestHash)throw Error('EXCHANGE_NOTICE_MANIFEST_HASH');
 const m=JSON.parse(raw);for(const s of m.sources){const b=fs.readFileSync(path.join(dir,s.file));if(b.length!==s.bytes||hash(b)!==s.sha256)throw Error('EXCHANGE_NOTICE_SOURCE_HASH');}
 return {date,isTradingDay:false,source:'exchange_notice',reason:'reviewed_exchange_full_day_closure',calendar_evidence:m};
}
module.exports={resolve};
