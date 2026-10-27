'use strict';
const fs=require('node:fs'),path=require('node:path');
const integrationId='legacy-supply-round-v1-20261023';
function enabled(runtime,env=process.env){
 // Read only at tick entry. Invalid or absent configuration preserves legacy work.
 if(env.FUMAN_SUPPLY_ROUND_OPTIMIZATION==='0')return false;
 try{
  const p=path.join(runtime,'state','supply-round-optimization.json');
  if(fs.statSync(p).size>4096)return false;
  const c=JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
  return c.schema===1&&c.integration_id===integrationId&&c.enabled===true;
 }catch{return false;}
}
module.exports={enabled,integrationId};
