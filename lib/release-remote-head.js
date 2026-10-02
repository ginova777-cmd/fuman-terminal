'use strict';
const {spawnSync}=require('node:child_process');
function readGithubHead({root,repository,branch,spawn=spawnSync}) {
  const fail=error=>({ok:false,value:'',error,transport:'github-api'});
  if(!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository||'') || repository.includes('..') || !/^\w[\w./-]*$/.test(branch||'') || branch.includes('..'))return fail('REMOTE_IDENTITY_INVALID');
  const options={cwd:root,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024};
  const origin=spawn('git',['remote','get-url','origin'],options);
  if(origin.status!==0)return fail('ORIGIN_UNREADABLE');
  const match=String(origin.stdout||'').trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/i);
  if(!match || match[1].toLowerCase()!==repository.toLowerCase())return fail('ORIGIN_REPOSITORY_MISMATCH');
  const endpoint=`repos/${repository}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`;
  const response=spawn('gh',['api','--hostname','github.com',endpoint],options);
  if(response.status!==0)return fail('GITHUB_REF_READ_FAILED');
  let payload;try{payload=JSON.parse(response.stdout);}catch{return fail('GITHUB_REF_INVALID_JSON');}
  if(payload.ref!==`refs/heads/${branch}` || payload.object?.type!=='commit' || !/^[a-f0-9]{40}$/.test(payload.object?.sha||''))return fail('GITHUB_REF_IDENTITY_INVALID');
  return {ok:true,value:payload.object.sha,error:'',transport:'github-api'};
}
module.exports={readGithubHead};
