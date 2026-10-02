'use strict';
const assert=require('node:assert/strict');
const {readGithubHead}=require('../lib/release-remote-head');
const sha='a'.repeat(40),branch='agent/collector-closing-drain-20261002',repository='ginova777-cmd/fuman-terminal';
const payload={ref:'refs/heads/'+branch,object:{type:'commit',sha}};
function run({origin='https://github.com/'+repository+'.git',body=JSON.stringify(payload),status=0,repo=repository}={}){
 const calls=[];
 const result=readGithubHead({root:'.',repository:repo,branch,spawn:(command,args,options)=>{calls.push({command,args});assert.equal(options.timeout,30000);assert.equal(options.windowsHide,true);if(command==='git'){assert.deepEqual(args,['remote','get-url','origin']);return{status:0,stdout:origin};}assert.equal(command,'gh');return{status,stdout:body};}});
 return {result,calls};
}
assert.equal(run().result.value,sha);
assert.equal(run({origin:'git@github.com:'+repository+'.git'}).result.value,sha);
assert.equal(run({origin:'https://github.com/wrong/repo.git'}).calls.length,1);
assert.equal(run({origin:'https://github.com.evil.test/'+repository+'.git'}).result.ok,false);
assert.equal(run({status:1}).result.ok,false);
assert.equal(run({status:null}).result.ok,false);
assert.equal(run({body:'invalid'}).result.ok,false);
for(const changed of [{ref:'refs/heads/other'},{object:{type:'tag',sha}},{object:{type:'commit',sha:'short'}}])assert.equal(run({body:JSON.stringify({...payload,...changed})}).result.ok,false);
assert.equal(run({repo:'../wrong'}).calls.length,0);
console.log('PASS: GitHub ref identity, origin binding, bounded errors, no Git HTTPS invocation; 11 cases');
