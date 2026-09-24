"use strict";
async function allCursorPages(fetchPage,maxPages=100){
 const rows=[],ids=new Set(),cursors=new Set();let cursor;
 for(let page=0;page<maxPages;page++){
  const p=await fetchPage(cursor);if(!Array.isArray(p.deployments)||!p.pagination)throw Error('deployment_pagination_missing');
  for(const row of p.deployments){const id=row.uid||row.id||row.url;if(!id||ids.has(id))throw Error('deployment_pagination_duplicate_or_missing_id');ids.add(id);rows.push(row);}
  const next=p.pagination.next;if(next===null||next===undefined||next===0)return {rows,pageCount:page+1,complete:true};
  if(!p.deployments.length||cursors.has(String(next)))throw Error('deployment_pagination_not_advancing');cursors.add(String(next));cursor=next;
 }
 throw Error('deployment_pagination_bound_reached');
}
module.exports={allCursorPages};
