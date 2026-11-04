'use strict';
// Exact website-only release profile. The default and morning profiles are unchanged.
const {execFileSync,spawnSync}=require('node:child_process');
const PROFILE='strategy4-desktop-164-20261104-v1';
const BASE='4ceaa49eeda8998cd172c8689c1805715023dbd1';
const REVIEWED='131d0a55d41c6ecdd5d6802c10902871f8826f82';
const PROJECT='prj_x0R2mMFsL0Xto4whcbPTKQTKJRUl';
const PREVIOUS_DEPLOYMENT='dpl_GUn4ZLoCNtgKm3eBTwm8AkXs6GhS';
const BUSINESS=['terminal-desktop-fast-shell.js'];
const GOVERNANCE=['lib/morning-publish-applicability.cjs','lib/strategy4-web-publish-applicability.cjs','scripts/test-strategy4-web-publish-applicability.cjs'];
const UNRELATED=['buySellFieldContractGuard','terminal_water_root','daytrade_source_host_role'];
function validate(o){
 const failures=[];const check=(ok,name)=>{if(!ok)failures.push(name);};
 check(o.clean===true,'UI_SCOPE_DIRTY');
 check(/^[a-f0-9]{40}$/.test(o.head||'')&&o.head===o.releaseSha,'UI_SCOPE_SHA_MISMATCH');
 check(o.remote==='https://github.com/ginova777-cmd/fuman-terminal.git','UI_SCOPE_REMOTE');
 check(o.main===o.head,'UI_SCOPE_MAIN_DRIFT');
 check(o.ancestor===true,'UI_SCOPE_REVIEWED_ANCESTRY');
 check(JSON.stringify(o.businessChanges)===JSON.stringify(BUSINESS),'UI_SCOPE_BUSINESS_DRIFT');
 check(Array.isArray(o.governanceChanges)&&o.governanceChanges.every(p=>GOVERNANCE.includes(p)),'UI_SCOPE_UNREVIEWED_CHANGE');
 const d=o.live;
 check(d?.projectId===PROJECT&&d?.target==='production'&&d?.readyState==='READY'&&Array.isArray(d?.alias)&&d.alias.includes('fuman-terminal.vercel.app'),'UI_SCOPE_PROJECT_OR_ALIAS');
 check(d?.id===PREVIOUS_DEPLOYMENT&&(d?.meta?.gitCommitSha||d?.meta?.githubCommitSha)===BASE||(d?.meta?.gitCommitSha||d?.meta?.githubCommitSha)===o.head,'UI_SCOPE_LIVE_BASE_DRIFT');
 if(failures.length)throw Error(failures.join(','));
 return {status:'SCOPED_UI',profile:PROFILE,head:o.head,base:BASE,reviewedBusinessSha:REVIEWED,businessChanges:BUSINESS,governanceChanges:o.governanceChanges,notApplicable:UNRELATED,
   reason:'Exact production website plus user-approved Strategy4 desktop 160-to-2000 display bound only. No changes to existing release gates; existing website-only applicability excludes unchanged local supply checks. No strategy/API/Writer/Collector code changes. Three unchanged local Mother Pool availability/host checks are outside this website-only release; no supply acceptance is claimed. All other publish gates remain required.'};
}
function assess(root,env=process.env){
 if(env.FUMAN_PUBLISH_SCOPE!==PROFILE)throw Error('UI_SCOPE_PROFILE');
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:4*1024*1024}).trim();
 const list=(...args)=>git(...args).split('\n').filter(Boolean);
 git('merge-base','--is-ancestor',BASE,REVIEWED);git('merge-base','--is-ancestor',REVIEWED,'HEAD');
 const r=spawnSync('cmd.exe',['/d','/s','/c','vercel api /v13/deployments/fuman-terminal.vercel.app --raw'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:2*1024*1024});
 if(r.status!==0)throw Error('UI_SCOPE_LIVE_READBACK_FAILED');
 return validate({clean:!git('status','--porcelain','--untracked-files=all'),head:git('rev-parse','HEAD'),releaseSha:env.FUMAN_RELEASE_SHA,main:git('rev-parse','origin/main'),remote:git('remote','get-url','origin'),ancestor:true,
   businessChanges:list('diff','--name-only','--no-renames',BASE,REVIEWED),governanceChanges:list('diff','--name-only','--no-renames',REVIEWED,'HEAD'),live:JSON.parse(r.stdout)});
}
module.exports={PROFILE,BASE,REVIEWED,BUSINESS,GOVERNANCE,validate,assess};
