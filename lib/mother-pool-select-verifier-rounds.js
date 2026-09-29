'use strict';
function select(list,requiredWriter){
 const distinct=(a,b)=>['writer_run_id','generation_id','snapshot_generation','mother_pool_run_id'].every(k=>a.value[k]&&b.value[k]&&a.value[k]!==b.value[k]);
 const sorted=[...list].sort((a,b)=>Date.parse(b.value.observed_at)-Date.parse(a.value.observed_at));
 const first=requiredWriter?sorted.find(x=>x.value.writer_run_id===requiredWriter):sorted[0];
 if(!first)return [];
 const second=sorted.find(x=>distinct(first,x));
 return (second?[first,second]:[first]).sort((a,b)=>Date.parse(a.value.observed_at)-Date.parse(b.value.observed_at));
}
module.exports={select};
