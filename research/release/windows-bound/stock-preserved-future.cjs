'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const fields=['pid','creation_ticks','exe','entry','command_sha256'];
function assertIdentity(expected,inventory){
 if(!expected||!Array.isArray(inventory)||inventory.length!==1)throw Error('PRESERVED_FUTURE_NOT_UNIQUE');
 const actual=inventory[0];if(actual.role!=='future'||actual.entry_verified!==true)throw Error('PRESERVED_FUTURE_ENTRY_INVALID');
 for(const k of fields){if(expected[k]==null||actual[k]==null||String(actual[k])!==String(expected[k]))throw Error('PRESERVED_FUTURE_IDENTITY:'+k);}
 if(!/^\d+$/.test(String(expected.creation_ticks))||!Number.isSafeInteger(expected.pid)||expected.pid<=0)throw Error('INVALID_PRESERVED_IDENTITY');
}
function capture(root,relativeFiles){
 const absolute=fs.realpathSync(root);if(!Array.isArray(relativeFiles)||!relativeFiles.length||new Set(relativeFiles).size!==relativeFiles.length)throw Error('PRESERVATION_FILES_REQUIRED');
 return relativeFiles.map(file=>{if(typeof file!=='string'||path.isAbsolute(file)||file.split(/[\\/]/).some(x=>x==='..'||x===''))throw Error('PRESERVATION_PATH_INVALID');const f=path.resolve(absolute,file),real=fs.realpathSync(f);if(!real.toLowerCase().startsWith((absolute+path.sep).toLowerCase()))throw Error('PRESERVATION_PATH_ESCAPE');const st=fs.statSync(real);if(!st.isFile()||st.size>32*1024*1024)throw Error('PRESERVATION_FILE_INVALID');return {file,bytes:st.size,sha256:hash(fs.readFileSync(real))};});
}
function verify(root,baseline,identity,inventory){
 assertIdentity(identity,inventory);
 if(!Array.isArray(baseline)||!baseline.length)throw Error('PRESERVATION_BASELINE_REQUIRED');
 const current=capture(root,baseline.map(x=>x.file));for(let i=0;i<current.length;i++){const b=baseline[i],a=current[i];if(!/^[a-f0-9]{64}$/.test(b.sha256)||b.bytes!==a.bytes||b.sha256!==a.sha256)throw Error('PRESERVED_BYTES_CHANGED:'+a.file);}
 return {status:'PRESERVED_BOUND_FILES_AND_IDENTITY',files:current,identity,source_quality:'NOT_EVALUATED',scope:'Only exact supplied dependency manifest; completeness must be separately reviewed'};
}
module.exports={capture,verify,assertIdentity};
