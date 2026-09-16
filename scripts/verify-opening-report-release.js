"use strict";
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(__dirname,'..');
const bootstrap=JSON.parse(fs.readFileSync(path.join(root,'data/contracts/release_root_authority_v1.json'),'utf8'));
const authority=JSON.parse(fs.readFileSync(path.join(bootstrap.sourceRoot,'data/contracts/release_root_authority_v1.json'),'utf8'));
if(fs.realpathSync(root).toLowerCase()!==fs.realpathSync(authority.productionRoot).toLowerCase())throw Error('morning_runner_not_approved_production_root');
const result=cp.spawnSync(process.execPath,[path.join(authority.sourceRoot,'scripts/verify-release-root-authority.js'),'--require-production-root'],{cwd:authority.sourceRoot,encoding:'utf8',windowsHide:true});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exitCode=result.status===0?0:1;
