'use strict';
// Encode Maps explicitly: structuredClone and advanced IPC discard Map.meta.
// This is a warmup-only transfer, never part of the per-second detection path.
function encode(value, ancestors=new Set()) {
 if(value===null||typeof value!=='object') {
  if(typeof value==='function'||typeof value==='symbol')throw Error('BASELINE_TRANSFER_UNSUPPORTED');
  return {kind:'value',value};
 }
 if(ancestors.has(value))throw Error('BASELINE_TRANSFER_CYCLE');
 ancestors.add(value);
 const visit=v=>encode(v,ancestors);
 let result;
 if(value instanceof Map)result={kind:'map',entries:[...value].map(([k,v])=>[visit(k),visit(v)]),props:Object.keys(value).map(k=>[k,visit(value[k])])};
 else if(value instanceof Set)result={kind:'set',entries:[...value].map(visit)};
 else if(value instanceof Date)result={kind:'date',value:value.toISOString()};
 else if(Array.isArray(value))result={kind:'array',entries:value.map(visit),props:Object.keys(value).filter(k=>! /^(0|[1-9]\d*)$/.test(k)).map(k=>[k,visit(value[k])])};
 else {
  if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('BASELINE_TRANSFER_UNSUPPORTED');
  result={kind:'object',entries:Object.keys(value).map(k=>[k,visit(value[k])])};
 }
 ancestors.delete(value);return result;
}
function decode(node) {
 if(!node||typeof node!=='object')throw Error('BASELINE_TRANSFER_INVALID');
 switch(node.kind) {
  case 'value': return node.value;
  case 'date': return new Date(node.value);
  case 'array': {
   const array=node.entries.map(decode);
   for(const [key,value]of node.props||[])Object.defineProperty(array,key,{value:decode(value),enumerable:true,writable:true,configurable:true});
   return array;
  }
  case 'set': return new Set(node.entries.map(decode));
  case 'object': return Object.fromEntries(node.entries.map(([k,v])=>[k,decode(v)]));
  case 'map': {
   const map=new Map(node.entries.map(([k,v])=>[decode(k),decode(v)]));
   for(const [key,value] of node.props)Object.defineProperty(map,key,{value:decode(value),enumerable:true,writable:true,configurable:true});
   return map;
  }
  default: throw Error('BASELINE_TRANSFER_INVALID');
 }
}
const cloneBaseline=value=>decode(encode(value));
module.exports={encodeBaseline:encode,decodeBaseline:decode,cloneBaseline};
