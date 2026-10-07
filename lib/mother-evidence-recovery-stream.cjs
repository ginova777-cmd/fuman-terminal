'use strict';
// Offline/background only. Never invoked in the WS or cache ACK path.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');
const { keyOf } = require('./mother-change-evidence.cjs');
const DEFAULTS = Object.freeze({ chunkBytes:65536, rowBytes:1048576, depth:32, runBytes:1048576, fanIn:16, maxKeys:10000000, scratchBytes:512*1048576 });
class Reader {
  constructor(file, maxBytes, options={}) {
    this.fd=fs.openSync(file,'r'); this.before=fs.fstatSync(this.fd);
    if(!this.before.isFile()||this.before.size>maxBytes){fs.closeSync(this.fd);throw Error('RECOVERY_FILE_LIMIT');}
    this.max=maxBytes;this.buffer=Buffer.alloc(options.chunkBytes||65536);this.decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
    this.text='';this.pos=0;this.eof=false;this.bytes=0;this.hash=crypto.createHash('sha256');
  }
  peek(){while(this.pos>=this.text.length&&!this.eof){const n=fs.readSync(this.fd,this.buffer,0,this.buffer.length,null);this.pos=0;if(!n){this.text=this.decoder.decode();this.eof=true;}else{this.bytes+=n;if(this.bytes>this.max)throw Error('RECOVERY_FILE_LIMIT');this.hash.update(this.buffer.subarray(0,n));this.text=this.decoder.decode(this.buffer.subarray(0,n),{stream:true});}}return this.text[this.pos];}
  take(){const c=this.peek();if(c!==undefined)this.pos++;return c;}
  finish(){const after=fs.fstatSync(this.fd);if(this.bytes!==this.before.size||after.size!==this.before.size||after.mtimeMs!==this.before.mtimeMs)throw Error('RECOVERY_SOURCE_CHANGED');return {bytes:this.bytes,sha256:this.hash.digest('hex')};}
  close(){fs.closeSync(this.fd);}
}
class Parser {
  constructor(reader,options){this.r=reader;this.o=options;this.units=0;}
  take(){if(++this.units>this.o.rowBytes)throw Error('RECOVERY_VALUE_LIMIT');return this.r.take();}
  ws(){while(/[\x20\t\r\n]/.test(this.r.peek()||'!'))this.take();}
  expect(c){if(this.take()!==c)throw Error('RECOVERY_JSON_INVALID');}
  string(){this.expect('"');let s='"';for(;;){const c=this.take();if(c===undefined)throw Error('RECOVERY_JSON_TRUNCATED');s+=c;if(c==='"')break;if(c==='\\'){const d=this.take();if(d===undefined)throw Error('RECOVERY_JSON_TRUNCATED');s+=d;}}if(Buffer.byteLength(s)>this.o.rowBytes)throw Error('RECOVERY_VALUE_LIMIT');return JSON.parse(s);}
  value(depth=0){if(depth>this.o.depth)throw Error('RECOVERY_DEPTH_LIMIT');this.ws();const c=this.r.peek();
    if(c==='"')return this.string();
    if(c==='{'||c==='['){const obj=c==='{'?Object.create(null):[],names=new Set(),end=c==='{'?'}':']';this.take();this.ws();if(this.r.peek()===end){this.take();return obj;}for(;;){let k;if(c==='{'){if(this.r.peek()!=='"')throw Error('RECOVERY_JSON_INVALID');k=this.string();if(names.has(k))throw Error('RECOVERY_DUPLICATE_MEMBER');names.add(k);this.ws();this.expect(':');}const v=this.value(depth+1);if(c==='{')obj[k]=v;else obj.push(v);this.ws();const sep=this.take();if(sep===end)break;if(sep!==',')throw Error('RECOVERY_JSON_INVALID');this.ws();}return obj;}
    let token='';while(this.r.peek()!==undefined&&!/[\x20\t\r\n,\]}]/.test(this.r.peek())){token+=this.take();if(token.length>128)throw Error('RECOVERY_SCALAR_LIMIT');}if(!token)throw Error('RECOVERY_JSON_INVALID');const v=JSON.parse(token);if(typeof v==='number'&&!Number.isFinite(v))throw Error('RECOVERY_NUMBER_INVALID');return v;
  }
  rows(kind,onRow){this.units=0;if(this.r.peek()==='\uFEFF')this.take();this.ws();this.expect('{');const members=new Set();let found=false,count=0;this.ws();if(this.r.peek()==='}')throw Error('RECOVERY_FULL_CACHE_INVALID');for(;;){this.units=0;const k=this.string();if(members.size>=1024||members.has(k))throw Error('RECOVERY_DUPLICATE_MEMBER_OR_ROOT_LIMIT');members.add(k);this.ws();this.expect(':');this.ws();if(k===(kind==='quote'?'quotes':'candles')){found=true;this.expect('[');this.ws();if(this.r.peek()!==']')for(;;){this.units=0;const row=this.value();if(!row||Array.isArray(row)||typeof row!=='object')throw Error('RECOVERY_ROW_INVALID');onRow(row);count++;this.ws();const sep=this.r.peek();if(sep===']')break;this.expect(',');}this.expect(']');}else this.value();this.units=0;this.ws();const sep=this.take();if(sep==='}')break;if(sep!==',')throw Error('RECOVERY_JSON_INVALID');this.ws();}this.units=0;this.ws();if(this.r.peek()!==undefined||!found)throw Error('RECOVERY_FULL_CACHE_INVALID');return count;}
}
function writeAll(fd,buffer){let at=0;while(at<buffer.length){const n=fs.writeSync(fd,buffer,at,buffer.length-at);if(!n)throw Error('RECOVERY_SHORT_WRITE');at+=n;}}
// Exact key strings, length prefixed UTF-8; neither hashes nor probabilistic filters.
class KeySort {
  constructor(dir,options){this.dir=dir;this.o=options;fs.mkdirSync(dir,{recursive:false});this.keys=[];this.memory=0;this.files=[];this.disk=0;this.count=0;this.id=0;}
  add(key){const size=Buffer.byteLength(key);if(!key.isWellFormed()||size>65536||++this.count>this.o.maxKeys)throw Error('RECOVERY_KEY_LIMIT');this.keys.push(key);this.memory+=size*2+64;if(this.memory>=this.o.runBytes)this.flush();}
  put(fd,key){const b=Buffer.from(key),h=Buffer.alloc(4);h.writeUInt32BE(b.length);this.disk+=b.length+4;if(this.disk>this.o.scratchBytes)throw Error('RECOVERY_SCRATCH_LIMIT');writeAll(fd,h);writeAll(fd,b);}
  flush(){if(!this.keys.length)return;this.keys.sort();const file=path.join(this.dir,`${this.id++}.keys`),fd=fs.openSync(file,'wx');try{let prev;for(const k of this.keys){if(k===prev)throw Error('RECOVERY_DUPLICATE_KEY');this.put(fd,k);prev=k;}}finally{fs.closeSync(fd);}this.files.push(file);this.keys=[];this.memory=0;if(this.files.length>4096)throw Error('RECOVERY_RUN_LIMIT');}
  static next(fd){const h=Buffer.alloc(4);const n=fs.readSync(fd,h,0,4,null);if(!n)return null;if(n!==4)throw Error('RECOVERY_SORT_TRUNCATED');const size=h.readUInt32BE();if(size>65536)throw Error('RECOVERY_KEY_LIMIT');const b=Buffer.alloc(size);let at=0;while(at<size){const got=fs.readSync(fd,b,at,size-at,null);if(!got)throw Error('RECOVERY_SORT_TRUNCATED');at+=got;}return new TextDecoder('utf-8',{fatal:true}).decode(b);}
  finish(){this.flush();const initial=this.files.length;while(this.files.length>1){const next=[];for(let start=0;start<this.files.length;start+=this.o.fanIn){const group=this.files.slice(start,start+this.o.fanIn),fds=[],file=path.join(this.dir,`${this.id++}.keys`);let out;try{for(const f of group)fds.push(fs.openSync(f,'r'));out=fs.openSync(file,'wx');const heads=fds.map(KeySort.next);let prev;for(;;){let best=-1;for(let i=0;i<heads.length;i++)if(heads[i]!==null&&(best<0||heads[i]<heads[best]))best=i;if(best<0)break;const k=heads[best];if(k===prev)throw Error('RECOVERY_DUPLICATE_KEY');this.put(out,k);prev=k;heads[best]=KeySort.next(fds[best]);}}finally{if(out!==undefined)fs.closeSync(out);for(const fd of fds)fs.closeSync(fd);}next.push(file);}this.files=next;}return {duplicate_count:0,sort_runs:initial,scratch_bytes:this.disk,key_count:this.count};}
}
function options(value={}){const o={...DEFAULTS,...value};for(const [k,v]of Object.entries(o))if(!Number.isSafeInteger(v)||v<1)throw Error('RECOVERY_STREAM_LIMIT_INVALID');if(o.chunkBytes>1048576||o.rowBytes>1048576||o.depth>64||o.runBytes>8*1048576||o.fanIn<2||o.fanIn>16||o.maxKeys>10000000||o.scratchBytes>512*1048576)throw Error('RECOVERY_STREAM_LIMIT_INVALID');return o;}
function inspect(file,kind,maxBytes,scratch,config={}){const o=options(config),sort=new KeySort(scratch,o),r=new Reader(file,maxBytes,o);try{const rows=new Parser(r,o).rows(kind,row=>sort.add(keyOf(row,kind).key));return {...r.finish(),rows,...sort.finish(),parser_version:'bounded-json-v1',key_version:'existing-keyOf-v1',limits:o};}finally{r.close();}}
function hashFile(file,maxBytes=512*1048576,copyTo=null){const r=fs.openSync(file,'r'),before=fs.fstatSync(r);let out;const h=crypto.createHash('sha256'),b=Buffer.alloc(65536);let bytes=0;try{if(!before.isFile()||before.size>maxBytes)throw Error('RECOVERY_FILE_LIMIT');if(copyTo)out=fs.openSync(copyTo,'wx');for(;;){const n=fs.readSync(r,b,0,b.length,null);if(!n)break;bytes+=n;if(bytes>maxBytes)throw Error('RECOVERY_FILE_LIMIT');h.update(b.subarray(0,n));if(out!==undefined)writeAll(out,b.subarray(0,n));}const after=fs.fstatSync(r);if(bytes!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw Error('RECOVERY_SOURCE_CHANGED');if(out!==undefined)fs.fsyncSync(out);return {bytes,sha256:h.digest('hex')};}finally{fs.closeSync(r);if(out!==undefined)fs.closeSync(out);}}
module.exports={inspect,hashFile,Reader,Parser,KeySort,DEFAULTS};
