'use strict';
// Encode Maps explicitly: structuredClone and advanced IPC discard Map.meta.
// This is a warmup-only transfer, never part of the per-second detection path.
function encode(value, ancestors=new Set(), memo=new WeakMap()) {
 if(value===null||typeof value!=='object') {
  if(typeof value==='function'||typeof value==='symbol')throw Error('BASELINE_TRANSFER_UNSUPPORTED');
  return {kind:'value',value};
 }
 if(ancestors.has(value))throw Error('BASELINE_TRANSFER_CYCLE');
 if(memo.has(value))return memo.get(value);
 ancestors.add(value);
 const visit=v=>encode(v,ancestors,memo);
 let result;
 if(value instanceof Map)result={kind:'map',entries:[...value].map(([k,v])=>[visit(k),visit(v)]),props:Object.keys(value).map(k=>[k,visit(value[k])])};
 else if(value instanceof Set)result={kind:'set',entries:[...value].map(visit)};
 else if(value instanceof Date)result={kind:'date',value:value.toISOString()};
 else if(Array.isArray(value))result={kind:'array',entries:value.map(visit),props:Object.keys(value).filter(k=>! /^(0|[1-9]\d*)$/.test(k)).map(k=>[k,visit(value[k])])};
 else {
  if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('BASELINE_TRANSFER_UNSUPPORTED');
  result={kind:'object',entries:Object.keys(value).map(k=>[k,visit(value[k])])};
 }
 ancestors.delete(value);memo.set(value,result);return result;
}
function decode(node, memo=new WeakMap()) {
 if(!node||typeof node!=='object')throw Error('BASELINE_TRANSFER_INVALID');
 if(memo.has(node))return memo.get(node);
 const visit=value=>decode(value,memo);
 switch(node.kind) {
  case 'value': return node.value;
  case 'date': {const value=new Date(node.value);memo.set(node,value);return value;}
  case 'array': {
   const array=node.entries.map(visit);memo.set(node,array);
   for(const [key,value]of node.props||[])Object.defineProperty(array,key,{value:visit(value),enumerable:true,writable:true,configurable:true});
   return array;
  }
  case 'set': {const value=new Set(node.entries.map(visit));memo.set(node,value);return value;}
  case 'object': {const value=Object.fromEntries(node.entries.map(([k,v])=>[k,visit(v)]));memo.set(node,value);return value;}
  case 'map': {
   const map=new Map(node.entries.map(([k,v])=>[visit(k),visit(v)]));memo.set(node,map);
   for(const [key,value] of node.props)Object.defineProperty(map,key,{value:visit(value),enumerable:true,writable:true,configurable:true});
   return map;
  }
  default: throw Error('BASELINE_TRANSFER_INVALID');
 }
}
const cloneBaseline=value=>decode(encode(value));
module.exports={encodeBaseline:encode,decodeBaseline:decode,cloneBaseline};
