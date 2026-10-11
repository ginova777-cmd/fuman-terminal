'use strict';
// Frozen Phase 1 inventory. Unknown modules never inherit another strategy's verifier.
const map={
 strategy3:{scope:'CONFIRMED',runner:'run-strategy3-v2-complete-scan.ps1',verifier:'scripts/verify-strategy3-complete.js',receipt:'strategy3.json'},
 strategy4:{scope:'CONFIRMED',runner:'run-strategy4.ps1',verifier:'scripts/verify-strategy4-complete.js',receipt:'strategy4.json'},
 strategy5:{scope:'CONFIRMED',runner:'run-strategy5-complete.ps1',verifier:'scripts/verify-strategy5-complete.js',receipt:'strategy5-complete.json'},
 institution:{scope:'CONFIRMED',runner:'run-institution.ps1',verifier:'scripts/verify-institution-e2e-closure.js',readbackVerifier:'scripts/verify-institution-live-readback.js',receipt:'institution.json'},
 strategy2:{scope:'PAUSED_BY_USER',runner:null,verifier:null,receipt:null},
};
for(const name of ['strategy1/open-buy','seven-strategies','heatmap','market-ai','realtime-radar','cb','warrant'])map[name]={scope:'UNVERIFIED',runner:null,verifier:null,receipt:null};
for(const name of ['strategy1/open-buy','heatmap','market-ai','realtime-radar','cb','warrant'])map[name]={scope:'PAUSED_BY_USER',runner:null,verifier:null,receipt:null};
module.exports=Object.freeze(map);

