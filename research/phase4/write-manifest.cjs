'use strict';
const fs=require('node:fs'),path=require('node:path');
const {sha,strategyCore}=require('./original-adapters.cjs');
const root=path.resolve(__dirname,'../..');
const files=[];function walk(dir){for(const name of fs.readdirSync(dir)){const p=path.join(dir,name);if(fs.statSync(p).isDirectory())walk(p);else if(name!=='manifest.json'){const b=fs.readFileSync(p);files.push({path:path.relative(root,p).replaceAll('\\','/'),bytes:b.length,sha256:sha(b)});}}}walk(__dirname);
const original=['scripts/run-strategy3-v2-complete-scan.js','scripts/strategy3-v2-contract.js','lib/strategy3-score-bonuses.js','data/contracts/strategy3_technical_trend_v2.json','lib/telegram-detectors/natural-source-runner.cjs','lib/telegram-detectors/volume-detector.cjs','lib/telegram-detectors/price-detector.cjs','lib/telegram-detectors/verify-natural-calculation.cjs','lib/telegram-detectors/level-cross-gate.cjs','lib/telegram-detectors/level-cross-indicators.cjs','lib/telegram-detectors/premarket-plan-contract.cjs'].map(p=>{const b=fs.readFileSync(path.join(root,p));return {path:p,bytes:b.length,sha256:sha(b),modified:false};});
const core=strategyCore('2026-10-06');
const result={contract:'phase4_offline_manifest_v1',generated_at:new Date().toISOString(),base_sha:'3a21f4c8cc7d704662b0500fdc06a833021a8125',implementation_commit:'ASSIGNED_BY_ROOT_INTEGRATION',files,original_dependencies:original,strategy_core_function_sha256:core.function_sha256,implemented:'PARTIAL_OFFLINE_CONSUMER',offline_tests:'PASS_34',runtime_verified:false,formal_go:'NO_GO',production_modified:false,notifications_sent:0,capacity:'BOUNDED_256_FIXTURE_PASS_2000_OPTIMIZED_UNVERIFIED'};
fs.writeFileSync(path.join(__dirname,'manifest.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({files:files.length,status:result.formal_go}));

