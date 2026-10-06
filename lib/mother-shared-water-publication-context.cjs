'use strict';
const {expectedFromSource}=require('./mother-shared-water-consumer.cjs');
const {createHash}=require('node:crypto');
// Inputs must come from an independent source-status read and exact Snapshot
// bytes. A receipt cannot supply its own expected publication identity.
async function bindPublishedContext({read,tradeDate,producerVersion}){
 if(typeof read!=='function')throw Error('PUBLICATION_CONTEXT_READER_REQUIRED');
 async function inspect(){
  const input=await read();
  return expectedFromSource({...input,tradeDate,producerVersion});
 }
 const expected=await inspect(),canonical=JSON.stringify(expected);
 return {expected:structuredClone(expected),context_sha256:createHash('sha256').update(canonical).digest('hex'),
  async assertCurrent(){
   if(JSON.stringify(await inspect())!==canonical)throw Error('PUBLISHED_CONTEXT_CHANGED');
   return true;
  }};
}
module.exports={bindPublishedContext};
