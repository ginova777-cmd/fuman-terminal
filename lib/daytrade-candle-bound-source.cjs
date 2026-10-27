'use strict';
const fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function capture(runtime,raw,asOf){const file=path.join(runtime,'state','candle-drain-bound-source.json.gz');const bytes=Buffer.from(raw);const data=zlib.gzipSync(bytes);fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,data);fs.renameSync(tmp,file);return{contract:'candle-fixed-source-v1',file,sha256:hash(bytes),as_of:new Date(asOf).toISOString(),encoding:'gzip'};}
function read(runtime,evidence){const file=path.resolve(runtime,'state','candle-drain-bound-source.json.gz');if(evidence?.contract!=='candle-fixed-source-v1'||path.resolve(evidence.file||'')!==file||evidence.encoding!=='gzip'||!/^[a-f0-9]{64}$/.test(evidence.sha256||'')||!Number.isFinite(Date.parse(evidence.as_of)))throw Error('CANDLE_BOUND_SOURCE_IDENTITY');const bytes=zlib.gunzipSync(fs.readFileSync(file),{maxOutputLength:268435456});if(hash(bytes)!==evidence.sha256)throw Error('CANDLE_BOUND_SOURCE_HASH');return bytes.toString('utf8');}
module.exports={capture,read};
