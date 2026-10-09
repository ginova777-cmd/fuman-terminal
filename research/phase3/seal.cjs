'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=__dirname,sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(path.join(dir,x.name)):[path.join(dir,x.name)]);}
const manifest=files(root).filter(f=>!f.endsWith('manifest.json')&&!f.endsWith('go-no-go.json')).map(f=>{const bytes=fs.readFileSync(f);return {path:path.relative(root,f).replaceAll('\\','/'),bytes:bytes.length,sha256:sha(bytes)};});
fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({contract:'phase3-offline-delivery-v1',base_sha:'3a21f4c8cc7d704662b0500fdc06a833021a8125',files:manifest},null,2));
const test=JSON.parse(fs.readFileSync(path.join(root,'receipts/correctness.json')));
fs.writeFileSync(path.join(root,'go-no-go.json'),JSON.stringify({phase:3,IMPLEMENTED:'PARTIAL',OFFLINE_VERIFIED:'COMPONENTS_PASS',test_passed:test.passed,test_failed:test.failed,RUNTIME_VERIFIED:false,status:'BLOCKED',blockers:['NATIVE_FEED_NOT_INTEGRATED','RAW_REVISION_TO_INDICATORS_UNVERIFIED','GLOBAL_RANK_AND_TIME_INCREMENTAL_OPTIMIZATION_INCOMPLETE','NATIVE_NO_TRADE_RESOLVER_UNAVAILABLE','NATURAL_PARITY_NOT_VERIFIED'],runtime_enabled:false,production_mutated:false,manifest_sha256:sha(fs.readFileSync(path.join(root,'manifest.json')))},null,2));
console.log(JSON.stringify({files:manifest.length,test_passed:test.passed,status:'BLOCKED'}));
