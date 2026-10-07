'use strict';
const {parentPort,workerData:c}=require('node:worker_threads'),fs=require('node:fs'),path=require('node:path');
let fd,bytes=0;
try{if(!path.isAbsolute(c.file)||!Number.isSafeInteger(c.maxFileBytes)||c.maxFileBytes<1||c.maxFileBytes>64*1048576)throw Error('MONITOR_CONFIG');fs.mkdirSync(path.dirname(c.file),{recursive:true});fd=fs.openSync(c.file,'wx');parentPort.postMessage({ready:true});}catch(e){parentPort.postMessage({error:e.code||e.message});}
parentPort.on('message',m=>{try{if(fd===undefined)throw Error('MONITOR_NOT_OPEN');const b=Buffer.from(m.json);if(b.length>32768||bytes+b.length>c.maxFileBytes)throw Error('MONITOR_DISK_LIMIT');let offset=0;while(offset<b.length){const n=fs.writeSync(fd,b,offset,b.length-offset);if(!n)throw Error('MONITOR_SHORT_WRITE');offset+=n;}bytes+=b.length;parentPort.postMessage({seq:m.seq});}catch(e){parentPort.postMessage({error:e.code||e.message});}});
