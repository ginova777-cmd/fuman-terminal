"use strict";
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os');
const {assertTree,treeExpired}=require('./cleanup-path-protection');
const context=require('./cleanup-maintenance-context');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fuman-cleanup-test-'));
const authFile=path.join(dir,'auth.json'),old=Date.now()-20*86400000;
const auth={contract:'cleanup-maintenance-authorization-v1',scope:'five-stage-cleanup',authorizedBy:'user',authorizationText:'test only',date:context.date(),runId:'test-maintenance-only',keepDays:15,preserveWorkdaySchedule:true,sourceRoot:context.ROOT,runtimeRoot:context.RUNTIME,issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};
function check(value){fs.writeFileSync(authFile,JSON.stringify(value));return context.authorization(authFile);}
assert.equal(check(auth).runId,auth.runId);
for(const patch of [{date:'2000-01-01'},{expiresAt:'2000-01-01T00:00:00Z'},{keepDays:7},{preserveWorkdaySchedule:false},{scope:'all-strategies'},{runId:'../../outside'},{authorizedBy:'agent'}])assert.throws(()=>check({...auth,...patch}));
const sub=path.join(dir,'old-test');fs.mkdirSync(sub);const fresh=path.join(sub,'fresh.json');fs.writeFileSync(fresh,'protected');fs.utimesSync(sub,old/1000,old/1000);assert.equal(treeExpired(sub,Date.now()-7*86400000),false);
fs.utimesSync(fresh,old/1000,old/1000);assert.equal(treeExpired(sub,Date.now()-7*86400000),true);assertTree(dir,sub);assert.throws(()=>assertTree(sub,dir));assert.throws(()=>assertTree(dir,dir));
console.log('PASS: expired/wrong-scope authorization rejected; new children and path boundaries protected. Test fixtures retained at '+dir);
