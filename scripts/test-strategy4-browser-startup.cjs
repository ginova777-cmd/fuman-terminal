const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {failedExit}=require('../lib/browser-startup-status.cjs');
test('running and successful launcher handoff remain pending CDP',()=>{assert.equal(failedExit(null),false);assert.equal(failedExit(0),false);});
test('nonzero launcher failure remains blocking',()=>{for(const n of [1,-1,127])assert.equal(failedExit(n),true);});
test('bounded dual CDP readiness and content gates remain intact',()=>{const s=fs.readFileSync(path.join(__dirname,'verify-terminal-ui-e2e.js'),'utf8');assert(s.includes('attempt < 80'));assert(s.includes('stableHits >= 2'));assert(s.includes('/json/list'));assert(s.includes('sameSymbols'));assert(s.includes("control.send('Browser.close'"));});
