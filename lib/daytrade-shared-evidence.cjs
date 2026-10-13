'use strict';
// Disk representation only. Reconstitutes the exact compact JSON bytes before
// existing validators see an object. Never changes RPC or strategy contracts.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const LIMIT=16*1024*1024, CONTRACT='mother-pool-shared-evidence-v1';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const keys=['module_id','contract','contract_version','version','trade_date','canonical_run_id','writer_run_id','generation','generation_id','mother_pool_run_id','snapshot_generation','snapshot_sequence','run_id','source_hash','source_version','observed_at'];
const selection=v=>({db_readback:Boolean(v?.db_readback),anon_readback:Boolean(v?.anon_readback),rounds_verified:Boolean(v?.rounds_verified)});
const identity=v=>Object.fromEntries(keys.filter(k=>v&&v[k]!==undefined).map(k=>[k,v[k]]));
const recordCounts=v=>({root:Array.isArray(v)?v.length:null,rows:Array.isArray(v?.rows)?v.rows.length:null,plan_rows:Array.isArray(v?.plan?.rows)?v.plan.rows.length:null,rounds:Array.isArray(v?.rounds_verified)?v.rounds_verified.length:null,modules:v?.modules?Object.fromEntries(Object.entries(v.modules).map(([k,m])=>[k,m?.plan?.rows?.length??null])):null});
function root(runtime){return path.resolve(runtime,'data','shared-evidence');}
function checkedPath(runtime,name){
 if(!/^[a-f0-9]{64}\.json$/.test(name))throw Error('EVIDENCE_PATH_ESCAPE');
 const dir=root(runtime),file=path.join(dir,name);
 if(fs.existsSync(dir)&&fs.realpathSync(dir).toLowerCase()!==dir.toLowerCase())throw Error('EVIDENCE_PATH_ESCAPE');
 if(fs.existsSync(file)&&(fs.lstatSync(file).isSymbolicLink()||fs.realpathSync(file).toLowerCase()!==file.toLowerCase()))throw Error('EVIDENCE_PATH_ESCAPE');
 return file;
}
function put(runtime,text,source={}){
 const b=Buffer.from(text),sha256=hash(b);if(b.length>LIMIT)throw Error('EVIDENCE_SIZE_LIMIT');
 fs.mkdirSync(root(runtime),{recursive:true});const file=checkedPath(runtime,sha256+'.json');
 try{const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 catch(e){if(e.code!=='EEXIST')throw e;const old=fs.readFileSync(file);if(!old.equals(b))throw Error('EVIDENCE_OVERWRITTEN');}
 return {file:sha256+'.json',sha256,bytes:b.length,source_identity:source};
}
function pack(value,runtime){
 const raw=JSON.stringify(value),counts=new Map();
 function count(v){if(!v||typeof v!=='object')return;const s=JSON.stringify(v);if(s.length>=1024&&Buffer.byteLength(s)<=LIMIT){const previous=counts.get(s)||0;counts.set(s,previous+1);if(previous)return;}for(const c of Object.values(v))count(c);}
 count(value);const pieces=[],saved=new Map(),textByHash=new Map();let literal='';
 function flush(){if(literal){pieces.push(literal);literal='';}}
 function emit(v){const s=JSON.stringify(v);if(v&&typeof v==='object'&&counts.get(s)>1){flush();if(!saved.has(s)){saved.set(s,put(runtime,s,identity(v)));textByHash.set(saved.get(s).sha256,s);}pieces.push(saved.get(s));return;}
 if(Array.isArray(v)){literal+='[';v.forEach((c,i)=>{if(i)literal+=',';emit(c);});literal+=']';}
 else if(v&&typeof v==='object'){literal+='{';Object.entries(v).forEach(([k,c],i)=>{if(i)literal+=',';literal+=JSON.stringify(k)+':';emit(c);});literal+='}';}
 else literal+=s;}
 emit(JSON.parse(raw));flush();
 if(pieces.map(p=>typeof p==='string'?p:textByHash.get(p.sha256)).join('')!==raw)throw Error('EVIDENCE_ROUNDTRIP');
 return {storage_contract:CONTRACT,identity:identity(value),selection:selection(value),record_counts:recordCounts(value),sha256:hash(raw),bytes:Buffer.byteLength(raw),pieces};
}
function read(file,runtime,knownValue=null,expectedContentHash=null){
 if(fs.statSync(file).size>LIMIT)throw Error('RECEIPT_SIZE_LIMIT');
 const envelope=JSON.parse(fs.readFileSync(file,'utf8'));if(expectedContentHash&&envelope.storage_contract!==CONTRACT)throw Error('EVIDENCE_PROCESS_CONTRACT_REQUIRED');if(envelope.storage_contract!==CONTRACT){if(knownValue){if(JSON.stringify(envelope)!==JSON.stringify(knownValue))throw Error('EVIDENCE_PARENT_CHANGED');return pack(knownValue,runtime).pieces;}return envelope;}
 if(!Number.isSafeInteger(envelope.bytes)||envelope.bytes<0||envelope.bytes>512*1024*1024)throw Error('EVIDENCE_MANIFEST');
 const verified=new Map();
 function load(p){
  if(!p||p.file!==p.sha256+'.json')throw Error('EVIDENCE_PATH_ESCAPE');
  const cached=verified.get(p.sha256);
  if(cached){if(cached.bytes!==p.bytes||cached.identity!==JSON.stringify(p.source_identity))throw Error('EVIDENCE_REFERENCE_DRIFT');return cached.text;}
  const f=checkedPath(runtime,p.file);if(fs.statSync(f).size>LIMIT)throw Error('EVIDENCE_SIZE_LIMIT');
  const b=fs.readFileSync(f);if(b.length!==p.bytes||hash(b)!==p.sha256)throw Error('EVIDENCE_HASH_DRIFT');
  if(JSON.stringify(identity(JSON.parse(b)))!==JSON.stringify(p.source_identity))throw Error('EVIDENCE_IDENTITY_DRIFT');const text=b.toString('utf8');verified.set(p.sha256,{bytes:b.length,identity:JSON.stringify(p.source_identity),text});return text;
 }
 let pieces=envelope.pieces;
 if(envelope.piece_chunks){
  if(pieces||!Array.isArray(envelope.piece_chunks)||!envelope.piece_chunks.length)throw Error('EVIDENCE_CHUNK_MANIFEST');
  pieces=[];const seen=new Set();
  for(const [i,ref] of envelope.piece_chunks.entries()){
   if(ref.index!==i||seen.has(ref.sha256))throw Error('EVIDENCE_CHUNK_ORDER');seen.add(ref.sha256);
   const chunk=JSON.parse(load(ref));
   if(chunk.index!==i||chunk.total!==envelope.piece_chunks.length||JSON.stringify(chunk.owner_identity)!==JSON.stringify(envelope.identity)||!Array.isArray(chunk.pieces)||chunk.pieces.length!==ref.piece_count)throw Error('EVIDENCE_CHUNK_IDENTITY');
   pieces.push(...chunk.pieces);
  }
  if(pieces.length!==envelope.total_pieces)throw Error('EVIDENCE_CHUNK_COUNT');
 }
 if(!Array.isArray(pieces))throw Error('EVIDENCE_MANIFEST');
 if(expectedContentHash){
  // Hash the identical logical UTF-8 stream without allocating its joined JSON.
  // Keep a trailing UTF-16 high surrogate across piece boundaries.
  const digest=crypto.createHash('sha256');let bytes=0,tail='';
  for(const piece of pieces){let text=tail+(typeof piece==='string'?piece:load(piece));tail='';const last=text.charCodeAt(text.length-1);if(last>=0xd800&&last<=0xdbff){tail=text.slice(-1);text=text.slice(0,-1);}const b=Buffer.from(text);bytes+=b.length;digest.update(b);}
  if(tail){const b=Buffer.from(tail);bytes+=b.length;digest.update(b);}
  if(bytes!==envelope.bytes||digest.digest('hex')!==envelope.sha256)throw Error('EVIDENCE_CONTENT_DRIFT');
  if(!/^[a-f0-9]{64}$/.test(expectedContentHash)||expectedContentHash!==envelope.sha256)throw Error('EVIDENCE_PROCESS_RESULT_DRIFT');
  return {sha256:envelope.sha256,bytes:envelope.bytes};
 }
 const raw=pieces.map(p=>typeof p==='string'?p:load(p)).join('');
 if(Buffer.byteLength(raw)!==envelope.bytes||hash(raw)!==envelope.sha256)throw Error('EVIDENCE_CONTENT_DRIFT');
 const v=knownValue||JSON.parse(raw);if(knownValue&&hash(JSON.stringify(v))!==envelope.sha256)throw Error('EVIDENCE_PARENT_CHANGED');if(JSON.stringify(identity(v))!==JSON.stringify(envelope.identity))throw Error('EVIDENCE_RUN_GENERATION_DRIFT');if(JSON.stringify(recordCounts(v))!==JSON.stringify(envelope.record_counts))throw Error('EVIDENCE_RECORD_COUNT');if(envelope.selection&&JSON.stringify(selection(v))!==JSON.stringify(envelope.selection))throw Error('EVIDENCE_SELECTION_DRIFT');return knownValue?pieces:v;
}
// Untrusted hints for candidate selection only. Never use this as acceptance.
// Selected files must still be fully read by the independent verifier.
function inspect(file,runtime){
 if(fs.statSync(file).size>LIMIT)throw Error('RECEIPT_SIZE_LIMIT');
 const e=JSON.parse(fs.readFileSync(file,'utf8'));
 if(e.storage_contract!==CONTRACT||!e.selection)return read(file,runtime);
 return {...e.identity,db_readback:e.selection.db_readback?{}:null,anon_readback:e.selection.anon_readback?{}:null,rounds_verified:e.selection.rounds_verified?[]:null};
}
function logicalDigest(pieces,runtime){
 const digest=crypto.createHash('sha256'),verified=new Map();let bytes=0,tail='';
 for(const p of pieces){
  let text;
  if(typeof p==='string')text=p;
  else {
   if(!p||p.file!==p.sha256+'.json')throw Error('EVIDENCE_PATH_ESCAPE');
   let cached=verified.get(p.sha256);
   if(!cached){const f=checkedPath(runtime,p.file);if(fs.statSync(f).size>LIMIT)throw Error('EVIDENCE_SIZE_LIMIT');const b=fs.readFileSync(f);
    if(b.length!==p.bytes||hash(b)!==p.sha256)throw Error('EVIDENCE_HASH_DRIFT');
    cached={text:b.toString('utf8'),bytes:b.length,identity:JSON.stringify(identity(JSON.parse(b)))};verified.set(p.sha256,cached);
   }
   if(cached.bytes!==p.bytes||cached.identity!==JSON.stringify(p.source_identity))throw Error('EVIDENCE_REFERENCE_DRIFT');text=cached.text;
  }
  text=tail+text;tail='';const last=text.charCodeAt(text.length-1);if(last>=0xd800&&last<=0xdbff){tail=text.slice(-1);text=text.slice(0,-1);}
  const b=Buffer.from(text);bytes+=b.length;digest.update(b);
 }
 if(tail){const b=Buffer.from(tail);bytes+=b.length;digest.update(b);}
 return {sha256:digest.digest('hex'),bytes};
}
function write(file,value,runtime,options={}){
 let envelope;
 if(options.roundFiles){
  if(!Array.isArray(value.rounds_verified)||options.roundFiles.length!==value.rounds_verified.length)throw Error('EVIDENCE_PARENT_COUNT');
  const pieces=['{'];let first=true;
  for(const [key,v]of Object.entries(value)){if(!first)pieces.push(',');first=false;pieces.push(JSON.stringify(key)+':');
   if(key==='rounds_verified'){pieces.push('[');options.roundFiles.forEach((parent,i)=>{if(i)pieces.push(',');pieces.push(...read(parent,runtime,value.rounds_verified[i]));});pieces.push(']');}
   else pieces.push(JSON.stringify(v));
  }pieces.push('}');
  // Parent bytes and their equality to the verified objects were checked above.
  // Hash that exact stream without serializing the complete pair a second time.
  envelope={storage_contract:CONTRACT,identity:identity(value),selection:selection(value),record_counts:recordCounts(value),...logicalDigest(pieces,runtime),pieces};
 }else envelope=pack(value,runtime);
 let raw=JSON.stringify(envelope);
 if(Buffer.byteLength(raw)>LIMIT){
  // Activated only after sharing still exceeds the unchanged per-file limit.
  const groups=[];let group=[],bytes=0;
  const parts=envelope.pieces.flatMap(p=>typeof p==='string'&&p.length>1024*1024?Array.from({length:Math.ceil(p.length/(1024*1024))},(_,i)=>p.slice(i*1024*1024,(i+1)*1024*1024)):[p]);
  for(const p of parts){const n=Buffer.byteLength(JSON.stringify(p))+1;if(bytes+n>8*1024*1024&&group.length){groups.push(group);group=[];bytes=0;}group.push(p);bytes+=n;}if(group.length)groups.push(group);
  envelope.total_pieces=parts.length;
  envelope.piece_chunks=groups.map((pieces,index)=>({...put(runtime,JSON.stringify({owner_identity:envelope.identity,index,total:groups.length,pieces})),index,piece_count:pieces.length}));
  delete envelope.pieces;raw=JSON.stringify(envelope);
 }
 if(Buffer.byteLength(raw)>LIMIT)throw Error('EVIDENCE_MANIFEST_SIZE_LIMIT');
 fs.mkdirSync(path.dirname(file),{recursive:true});const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return envelope;
}
module.exports={pack,read,write,inspect,LIMIT,CONTRACT,verifyProcessBytes:(file,runtime,sha)=>{if(!sha)throw Error('EVIDENCE_PROCESS_HASH_REQUIRED');const r=read(file,runtime,null,sha);if(r.sha256!==sha)throw Error('EVIDENCE_PROCESS_RESULT_DRIFT');return r;}};
