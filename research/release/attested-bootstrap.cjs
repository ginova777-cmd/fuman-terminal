'use strict';
// Isolated CJS-only launcher. Unsupported child/native/ESM execution is rejected.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),Module=require('module');
const {local}=require('./producer-handoff.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const config=JSON.parse(fs.readFileSync(local(process.argv[2])));
if(config.scope!=='ISOLATED_REVIEW'||!process.send||!config.challenge||!config.manifest)throw Error('ATTESTATION_SCOPE');
const raw=fs.readFileSync(local(config.manifest)),manifest=JSON.parse(raw);
if(hash(raw)!==config.manifest_hash||manifest.node_version!==process.version||hash(fs.readFileSync(process.execPath))!==manifest.node_hash)throw Error('MANIFEST_NODE_DRIFT');
const loaded=[],root=local(manifest.root),entry=local(config.entrypoint);
function receipt(status,reason){process.send({contract:'loaded-bytes-attestation-v1',scope:'ISOLATED_REVIEW',status,reason,pid:process.pid,parent_pid:process.ppid,challenge:config.challenge,entrypoint:entry,node_version:process.version,node_hash:manifest.node_hash,release_sha:manifest.release_sha,manifest_hash:hash(raw),loaded,coverage:'CJS_JS_JSON_ONLY',formal_verified:false});}
function bytes(file){local(file);const rel=path.relative(root,file).replaceAll('\\','/');if(rel.startsWith('..')||path.isAbsolute(rel)||!manifest.files[rel])throw Error('UNDECLARED_MODULE');const b=fs.readFileSync(file);if(hash(b)!==manifest.files[rel])throw Error('LOADED_BYTES_DRIFT');loaded.push({path:rel,sha256:hash(b),bytes:b.length});return b;}
Module._extensions['.js']=(m,f)=>m._compile(bytes(f).toString('utf8'),f);
Module._extensions['.cjs']=Module._extensions['.js'];
Module._extensions['.json']=(m,f)=>{m.exports=JSON.parse(bytes(f).toString('utf8').replace(/^\uFEFF/,''));};
Module._extensions['.node']=()=>{throw Error('NATIVE_UNATTESTED');};
const original=Module._load;
Module._load=function(request,...args){if(['worker_threads','child_process','vm','module'].includes(request.replace(/^node:/,'')))throw Error('UNATTESTED_EXECUTION_PATH');if(/\.mjs$/.test(request))throw Error('ESM_UNATTESTED');return original.call(this,request,...args);};
// VM dynamic import is not covered: the runtime flag disallows code generation;
// candidates using dynamic import require a separate loader and remain blocked.
try{if(!/\.(cjs|js)$/.test(entry))throw Error('ENTRY_FORMAT');require(entry);receipt('LOADED_DECLARED_CJS');}catch(e){receipt('BLOCKED',e.message);process.exitCode=1;}
