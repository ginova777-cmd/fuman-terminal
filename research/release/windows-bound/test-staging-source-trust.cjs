'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict'),crypto=require('crypto'),os=require('os');
const [source,output]=process.argv.slice(2);
if(!source||!output||fs.existsSync(output))throw Error('NEW_OUTPUT_REQUIRED');
fs.mkdirSync(output,{recursive:true});
const exact=path.resolve(source).replace(/\\/g,'/');
// Git clone is not an ownership-preflight API: current Git for Windows may
// accept a local clone with GIT_TEST_ASSUME_DIFFERENT_OWNER set. Exercise the
// source repository lookup directly, then prove the resulting clone identity.
const hash=file=>fs.existsSync(file)?crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null;
const globalFiles=[...new Set([path.join(os.homedir(),'.gitconfig'),path.join(process.env.XDG_CONFIG_HOME||path.join(os.homedir(),'.config'),'git/config'),process.env.GIT_CONFIG_GLOBAL].filter(Boolean))];
const globalBefore=globalFiles.map(file=>({file,sha256:hash(file)}));
const env={...process.env},removedEnvironmentKeys=[];
for(const key of Object.keys(env))if(/^GIT_CONFIG(?:_|$)/i.test(key)||/^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CEILING_DIRECTORIES)$/i.test(key)){removedEnvironmentKeys.push(key);delete env[key];}
const emptyConfig=path.resolve(output,'empty.gitconfig');fs.writeFileSync(emptyConfig,'');
Object.assign(env,{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:emptyConfig,GIT_CONFIG_GLOBAL:emptyConfig,GIT_TEST_ASSUME_DIFFERENT_OWNER:'1'});
function attempt(name,args){const actual=['-c','safe.directory=',...args],r=cp.spawnSync('git',actual,{env,encoding:'utf8',windowsHide:true,timeout:120000});fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify({args:actual,exit:r.status,error:r.error?.code,stdout:r.stdout,stderr:r.stderr},null,2));return r;}
const before=attempt('before',['-C',exact,'rev-parse','--verify','HEAD']);assert.equal(before.status,128,before.stderr);assert.match(before.stderr,/dubious ownership/);
const wrong=attempt('wrong-path',['-c',`safe.directory=${exact}-unrelated`,'-C',exact,'rev-parse','--verify','HEAD']);assert.equal(wrong.status,128,wrong.stderr);assert.match(wrong.stderr,/dubious ownership/);
const after=attempt('after',['-c',`safe.directory=${exact}`,'-c','core.fsmonitor=false','-C',exact,'rev-parse','--verify','HEAD']);assert.equal(after.status,0,after.stderr);assert.match(after.stdout.trim(),/^[0-9a-f]{40}$/);
const clonePath=path.resolve(output,'clone'),clone=attempt('clone',['-c',`safe.directory=${exact}`,'-c','core.fsmonitor=false','clone','--no-hardlinks','--no-checkout',exact,clonePath]);assert.equal(clone.status,0,clone.stderr);
const readback=attempt('clone-readback',['-c',`safe.directory=${clonePath.replace(/\\/g,'/')}`,'-C',clonePath,'rev-parse','--verify','HEAD']);assert.equal(readback.status,0,readback.stderr);assert.equal(readback.stdout.trim(),after.stdout.trim());
const globalAfter=globalFiles.map(file=>({file,sha256:hash(file)}));assert.deepEqual(globalAfter,globalBefore,'global Git configuration changed');
fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify({status:'ISOLATED_SOURCE_TRUST_PASS',formal_execution:false,before_exit:before.status,wrong_path_exit:wrong.status,after_exit:after.status,clone_exit:clone.status,sourceHead:after.stdout.trim(),cloneHead:readback.stdout.trim(),trustScope:'per-command exact repository path; no wildcard or global change',removedEnvironmentKeys,globalBefore,globalAfter,scope:'Synthetic source lookup ownership test and clone identity; not proof of historical clone failure'},null,2));
console.log('ISOLATED_SOURCE_TRUST_PASS');
