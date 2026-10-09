'use strict';
const crypto=require('crypto'),assert=require('assert/strict'),{sign,verify}=require('./signed-boundary.cjs');
const k=crypto.generateKeyPairSync('ed25519'),p={scope:'ISOLATED_REVIEW',challenge:'a',pendingRows:0,queuedFiles:0,frozen:true,owner_sid:'SID',producer_creation_date:new Date().toISOString(),producer_pid:1,sequence:1,ack_at:new Date().toISOString(),hashes:{quote:'a'.repeat(64),candle:'b'.repeat(64)}};
assert(verify(sign(p,k.privateKey),k.publicKey,'a',{owner_sid:'SID'}).quiescent);
for(const bad of [{ack_at:'invalid'},{producer_creation_date:'invalid'},{hashes:{}},{pendingRows:1},{queuedFiles:1},{frozen:false}])assert.throws(()=>verify(sign({...p,...bad},k.privateKey),k.publicKey,'a'),/BOUNDARY_ACK/);
assert.throws(()=>verify(sign(p,k.privateKey),k.publicKey,'a',{owner_sid:'OTHER'}),/BOUNDARY_IDENTITY/);
console.log(JSON.stringify({status:'PASS',valid:1,rejected:7,formal_trust_root_installed:false}));
