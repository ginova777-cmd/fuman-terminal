"use strict";
const fs=require('fs'),path=require('path');
function within(root,target){const r=path.relative(root,target);return r!==''&&!r.startsWith('..')&&!path.isAbsolute(r);}
function assertTree(root,target){
  const realRoot=fs.realpathSync(root), resolved=path.resolve(target);
  if(!within(realRoot,resolved)||!within(realRoot,fs.realpathSync(resolved))||fs.lstatSync(resolved).isSymbolicLink())throw Error(`cleanup_path_outside_root_or_link:${resolved}`);
  if(fs.statSync(resolved).isDirectory())for(const item of fs.readdirSync(resolved))assertTree(realRoot,path.join(resolved,item));
}
function treeExpired(target,cutoff){
  const s=fs.lstatSync(target);if(s.isSymbolicLink()||s.mtimeMs>=cutoff)return false;
  return !s.isDirectory()||fs.readdirSync(target).every(n=>treeExpired(path.join(target,n),cutoff));
}
module.exports={assertTree,treeExpired};
