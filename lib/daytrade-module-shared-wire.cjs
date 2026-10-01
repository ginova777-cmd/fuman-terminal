'use strict';
const {compact}=require('./daytrade-module-compact-wire');
// Replace repeated JSON subtrees on the wire only. Literal pieces retain key
// order, escaping and numeric spelling, so the server rebuilds the exact plan.
function shared(body){
 const original=compact(body),plan=JSON.parse(original.p_plan),counts=new Map();
 function count(value){if(value&&typeof value==='object'){const text=JSON.stringify(value);if(text.length>=256)counts.set(text,(counts.get(text)||0)+1);for(const child of Object.values(value))count(child);}}
 count(plan);
 const dictionary=[],indexes=new Map(),pieces=[];let literal='';
 function emit(value){
  const text=JSON.stringify(value);
  if(value&&typeof value==='object'&&counts.get(text)>1){
   if(literal){pieces.push(literal);literal='';}
   if(!indexes.has(text)){indexes.set(text,dictionary.length);dictionary.push(text);}
   pieces.push(indexes.get(text));return;
  }
  if(Array.isArray(value)){literal+='[';value.forEach((child,i)=>{if(i)literal+=',';emit(child);});literal+=']';}
  else if(value&&typeof value==='object'){literal+='{';Object.entries(value).forEach(([key,child],i)=>{if(i)literal+=',';literal+=JSON.stringify(key)+':';emit(child);});literal+='}';}
  else literal+=text;
 }
 emit(plan);if(literal)pieces.push(literal);
 const wire={p_metadata:original.p_metadata,p_dictionary:dictionary,p_pieces:pieces};
 if(pieces.map(x=>typeof x==='number'?dictionary[x]:x).join('')!==original.p_plan)throw Error('SHARED_WIRE_ROUNDTRIP');
 if(dictionary.length>10000||pieces.length>100000||Buffer.byteLength(JSON.stringify(wire))>=Buffer.byteLength(JSON.stringify(original)))return {endpoint:'persist_daytrade_module_round_compact_v1',wire:original};
 return {endpoint:'persist_daytrade_module_round_shared_v1',wire};
}
module.exports={shared};
