"use strict";
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const source='C:/fuman-release-owner/fuman-terminal';
const authority=JSON.parse(fs.readFileSync(path.join(source,'data/contracts/release_root_authority_v1.json'),'utf8'));
const real=p=>fs.realpathSync(p).toLowerCase();
const root=path.resolve(__dirname,'..');
if(real(authority.sourceRoot)!==real(source)||real(root)!==real(authority.productionRoot))throw Error('STRATEGY3_REQUIRES_APPROVED_PRODUCTION_ROOT');
// The source authority owns the current approval; a detached release cannot
// embed its own SHA in a committed contract. Delegate without weakening gates.
const r=spawnSync(process.execPath,[path.join(source,'scripts/verify-release-root-authority.js'),'--require-production-root'],{cwd:source,stdio:'inherit',windowsHide:true});
process.exitCode=r.status===0?0:1;
