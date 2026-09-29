'use strict';
// Log field sizes only; never log payload values or credentials.
function inspect(payload) {
  return Object.entries(payload || {}).map(([field,value])=>({
    field,bytes:Buffer.byteLength(JSON.stringify(value) ?? 'null','utf8'),
    items:Array.isArray(value)?value.length:null,
  })).sort((a,b)=>b.bytes-a.bytes||a.field.localeCompare(b.field)).slice(0,15);
}
module.exports={inspect};
