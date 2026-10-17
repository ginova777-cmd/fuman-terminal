'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict');
const [source,output]=process.argv.slice(2);
if(!source||!output||fs.existsSync(output))throw Error('NEW_OUTPUT_REQUIRED');
fs.mkdirSync(output,{recursive:true});
const exact=path.resolve(source).replace(/\\/g,'/');
const env={...process.env,GIT_TEST_ASSUME_DIFFERENT_OWNER:'1'};
function attempt(name,extra){const r=cp.spawnSync('git',['-c','safe.directory=',...extra,'clone','--no-hardlinks','--no-checkout',source,path.join(output,name)],{env,encoding:'utf8',windowsHide:true,timeout:120000});fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify({exit:r.status,error:r.error?.code,stdout:r.stdout,stderr:r.stderr},null,2));return r;}
const before=attempt('before',[]);assert.equal(before.status,128);assert.match(before.stderr,/dubious ownership/);
const after=attempt('after',['-c',`safe.directory=${exact}`,'-c',`safe.directory=${exact}/.git`,'-c','core.fsmonitor=false']);assert.equal(after.status,0,after.stderr);
fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify({status:'ISOLATED_SOURCE_TRUST_PASS',formal_execution:false,before_exit:before.status,after_exit:after.status,scope:'Synthetic different-owner test; not proof of historical stderr'},null,2));
console.log('ISOLATED_SOURCE_TRUST_PASS');
