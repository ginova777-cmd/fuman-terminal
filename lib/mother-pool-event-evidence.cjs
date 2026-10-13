'use strict';
// Isolated event evidence protocol. No network, production writer, or synthetic success adapter.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {writeExclusive}=require('./daytrade-durable-json');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function need(v,c){if(!v)throw Error(c);}
function inside(root,file){const r=fs.realpathSync(root),p=fs.realpathSync(file);need(p.startsWith(r+path.sep),'EVIDENCE_PATH_ESCAPE');return p;}
function raw(root,ref){need(ref&&/^[a-f0-9]{64}$/.test(ref.sha256),'REFERENCE_HASH_REQUIRED');const p=inside(root,ref.file);need(fs.statSync(p).size<=16*1024*1024,'EVIDENCE_SIZE_LIMIT');const b=fs.readFileSync(p);need(b.length===ref.bytes&&digest(b)===ref.sha256,'EVIDENCE_BYTES_MISMATCH');return b;}
function read(root,ref){return JSON.parse(raw(root,ref));}
function reference(file){const b=fs.readFileSync(file);return {file:path.resolve(file),bytes:b.length,sha256:digest(b)};}
function save(root,value){fs.mkdirSync(root,{recursive:true});const b=JSON.stringify(value),file=path.join(root,digest(b)+'.json');if(!fs.existsSync(file))writeExclusive(file,value);need(digest(fs.readFileSync(file))===digest(b),'IMMUTABLE_EVIDENCE_CHANGED');return reference(file);}
function clock(now){const t=Date.parse(now);need(Number.isFinite(t),'INVALID_CLOCK');return t;}
function live(root,file){const p=inside(root,file);need(fs.statSync(p).size<=1024*1024,'CURRENT_SIZE_LIMIT');return JSON.parse(fs.readFileSync(p));}
module.exports={need,raw,read,reference,save,clock,live,digest};
