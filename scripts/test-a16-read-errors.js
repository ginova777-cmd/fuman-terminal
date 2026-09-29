'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{read}=require('../lib/mother-pool-a16-io');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'a16-read-errors-')),file=path.join(dir,'launch.json');
try{assert.throws(()=>read(file),e=>e.code==='ENOENT'&&e.cause.code==='ENOENT');fs.writeFileSync(file,'\0\0');assert.throws(()=>read(file),e=>e.code==='A16_JSON_INVALID'&&e.cause instanceof SyntaxError);fs.writeFileSync(file,'{"pid":123}');assert.equal(read(file).pid,123);console.log('PASS real A16 IO distinguishes absent launch from damaged JSON');}finally{fs.rmSync(dir,{recursive:true,force:true});}
