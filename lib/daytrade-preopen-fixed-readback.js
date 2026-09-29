'use strict';
const fields=['trade_date','canonical_run_id','writer_run_id','generation_id'];
async function read({identity,request}){
 for(const k of fields)if(typeof identity?.[k]!=='string'||!identity[k])throw Error('PREOPEN_FIXED_IDENTITY_REQUIRED:'+k);
 const rows=[],pages=[];let total=null;
 for(let offset=0;offset<10000;offset+=500){
  const q=new URLSearchParams({select:'*',order:'symbol.asc',limit:'500',offset:String(offset)});for(const k of fields)q.set(k,'eq.'+identity[k]);
  const r=await request(q.toString()),match=/^(\d+)-(\d+)\/(\d+)$/.exec(r.contentRange||'');
  if(![200,206].includes(r.status)||!Array.isArray(r.rows)||!match)throw Error('PREOPEN_PAGE_HTTP_OR_RANGE_INVALID');
  const [start,end,count]=match.slice(1).map(Number);
  if(start!==offset||end-start+1!==r.rows.length||r.rows.length>500||!r.rows.length||total!==null&&count!==total||end>=count)throw Error('PREOPEN_PAGE_COUNT_INVALID');total=count;
  if(total>10000||r.rows.some(row=>fields.some(k=>row[k]!==identity[k])))throw Error('PREOPEN_PAGE_IDENTITY_INVALID');
  rows.push(...r.rows);pages.push({offset,http_status:r.status,content_range:r.contentRange,row_count:r.rows.length});
  if(rows.length===total){if(new Set(rows.map(x=>x.symbol)).size!==rows.length||rows.some(x=>typeof x.symbol!=='string'||!x.symbol))throw Error('PREOPEN_SYMBOL_SET_INVALID');return {rows,pages};}
  if(r.rows.length!==500)throw Error('PREOPEN_PAGE_TRUNCATED');
 }
 throw Error('PREOPEN_PAGE_LIMIT');
}
module.exports={read};
