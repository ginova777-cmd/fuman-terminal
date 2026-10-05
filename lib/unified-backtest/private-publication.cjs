'use strict';
const {hash}=require('./core.cjs'),{validate}=require('./publication-snapshot.cjs');
let cached=null,loadedAt=0;
async function readPrivatePublication(){
 if(cached&&Date.now()-loadedAt<15000)return cached;
 const {get}=await import('@vercel/blob');
 const result=await get('unified-backtest/current.json',{access:'private',useCache:false});
 if(!result||result.statusCode!==200||!result.stream)throw Error('UBT_PUBLICATION_UNAVAILABLE');
 const p=JSON.parse(await new Response(result.stream).text());
 if(p.contract!=='unified-backtest-publication-v1'||p.content_sha256!==hash(p.view))throw Error('UBT_PUBLICATION_INTEGRITY');
 cached=validate(p.view);loadedAt=Date.now();return cached;
}
module.exports={readPrivatePublication};
