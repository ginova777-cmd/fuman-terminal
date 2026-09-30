'use strict';
// Bound the actual UTF-8 request body, including brackets and separators.
function* batches(rows,{maxRows,maxBytes=Infinity}) {
 if(!Number.isInteger(maxRows)||maxRows<1||!(maxBytes>=2))throw Error('WRITE_BATCH_LIMIT_INVALID');
 let parts=[],bytes=2,offset=0;
 for(const row of rows){
  const wire=JSON.stringify(row);
  if(typeof wire!=='string')throw Error('WRITE_BATCH_ROW_NOT_SERIALIZABLE');
  const size=Buffer.byteLength(wire,'utf8');
  if(size+2>maxBytes)throw Error('WRITE_BATCH_SINGLE_ROW_EXCEEDS_BYTE_LIMIT');
  if(parts.length&&(parts.length>=maxRows||bytes+1+size>maxBytes)){
   const body='['+parts.join(',')+']';yield {offset,body,chunk:JSON.parse(body)};
   offset+=parts.length;parts=[];bytes=2;
  }
  bytes+=size+(parts.length?1:0);parts.push(wire);
 }
 if(parts.length){const body='['+parts.join(',')+']';yield {offset,body,chunk:JSON.parse(body)};}
}
module.exports={batches};
