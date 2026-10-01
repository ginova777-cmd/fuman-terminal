'use strict';
// Never retry a write. Wait only for its exact immutable round to become visible.
async function waitForRound(read,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),delays=[1000,2000,4000]}={}){
 let rounds=await read();
 for(const delay of delays){if(!Array.isArray(rounds)||rounds.length!==0)break;await sleep(delay);rounds=await read();}
 return rounds;
}
module.exports={waitForRound};
