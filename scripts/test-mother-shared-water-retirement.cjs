'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {save,prepareRetirement}=require('../lib/mother-shared-water-local-archive.cjs');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'water-retirement-')),now=Date.parse('2026-10-06T12:00:00Z');
const bytes=Buffer.from('isolated evidence'),hash=crypto.createHash('sha256').update(bytes).digest('hex');
try{
 const receipt={contract:'mother-pool-shared-water-acceptance-v1',verification_run_id:'isolated-retirement',checked_at:'2026-10-06T10:00:00Z',valid_until:'2026-10-06T10:00:30Z',evidence_hashes:[hash]};
 const saved=save({receipt,blobs:new Map([['sha256:'+hash,bytes]])},{directory}),record={...saved,verification_run_id:receipt.verification_run_id};
 const result=prepareRetirement([record],{directory,nowMs:now});assert.equal(result.items.length,1);assert.equal(result.local_evidence_deleted,false);assert(fs.existsSync(record.path));
 assert.equal(prepareRetirement([record],{directory,nowMs:Date.parse('2026-10-06T10:30:00Z')}).items.length,0);
 assert.throws(()=>prepareRetirement([{...record,path:path.join(directory,'other.gz')}],{directory,nowMs:now}),/PATH/);
 assert.throws(()=>prepareRetirement([{...record,verification_run_id:'other'}],{directory,nowMs:now}),/MANIFEST/);
 assert.throws(()=>prepareRetirement([record,record],{directory,nowMs:now}),/RECORD/);
 fs.writeFileSync(record.path,'corrupted');assert.throws(()=>prepareRetirement([record],{directory,nowMs:now}),/HASH/);
 console.log(JSON.stringify({ok:true,cases:6,mode:'isolated_archive_reopen',database_requests:0,local_evidence_deleted:false}));
}finally{for(const name of fs.readdirSync(directory))fs.unlinkSync(path.join(directory,name));fs.rmdirSync(directory);}
