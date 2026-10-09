'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function algorithmIdentity(){
 const root=path.resolve(__dirname,'../..'),h=crypto.createHash('sha256');
 function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:1)){
  const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);
  else if(/\.(cjs|js|json)$/.test(entry.name)&&!entry.name.startsWith('test-')){h.update(path.relative(root,file).replace(/\\/g,'/'));h.update('\0');h.update(fs.readFileSync(file));h.update('\0');}
 }}
 for(const dir of ['research/phase2','research/phase3','research/phase4','research/integration','research/release','lib','scripts','data/contracts'])walk(path.join(root,dir));
 return h.digest('hex');
}
module.exports={algorithmIdentity};
