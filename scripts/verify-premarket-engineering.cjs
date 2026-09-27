'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {digest}=require('../lib/telegram-detectors/premarket-plan-contract.cjs');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function verify(dir){
 const repo=path.resolve(__dirname,'..'),artifact=path.join(dir,'validation.json'),payload=read(artifact),engineering=read(path.join(dir,'engineering-receipt.json')),ui=read(path.join(dir,'ui/tri-surface.json'));
 assert.equal(payload.contract,'telegram_premarket_validation_v1');assert.equal(payload.mode,'validation');assert.equal(payload.no_send,true);assert.equal(payload.notifications_sent,0);assert.equal(payload.formal_complete,false);
 assert.equal(payload.rows_sha256,digest(payload.rows));assert.equal(engineering.artifact_sha256,digest(payload));assert.equal(engineering.run_id,payload.run_id);assert.equal(engineering.local_readback_ok,true);
 assert.equal(payload.coverage.requested,payload.rows.length);assert.equal(payload.coverage.evaluated,payload.rows.length);
 for(const entry of payload.input_files||[])assert.equal(hash(entry.path),entry.sha256,'input changed '+entry.path);
 assert.equal(ui.run_id,payload.run_id);assert.equal(ui.rows_sha256,payload.rows_sha256);assert.equal(ui.complete,true);assert.equal(ui.formal_complete,false);
 for(const [file,expected]of Object.entries(ui.source_hashes))assert.equal(hash(path.join(repo,file)),expected,'UI source changed');
 for(const name of ['desktop','mobile','scorecard']){const s=ui.surfaces[name];assert.equal(s.run_id,payload.run_id);assert.equal(s.rows_sha256,payload.rows_sha256);assert.equal(s.row_count,payload.rows.length);assert.equal(s.visible,true);assert.equal(hash(path.join(dir,'ui',name+'.png')),s.screenshot_sha256);}
 for(const row of payload.rows){assert.equal(row.formal_eligible,false);assert.equal(row.preopen_action,'NO_TRADE');assert(row.blockers.includes('ADDITIONAL_VETO_RULES_PENDING'));}
 for(const event of payload.observations){assert.equal(event.notification_allowed,false);if(event.gate.eligible)assert(event.gate.matches.every(m=>m.direction===event.required_direction));}
 assert(payload.notification_previews.every(p=>p.sent===false));
 const final={contract:'premarket_engineering_receipt_v1',scope:'steps_1_to_3_no_send_local_integration',status:'complete',complete:true,exitCode:0,run_id:payload.run_id,rows_sha256:payload.rows_sha256,evaluated_count:payload.rows.length,tri_surface_status:'complete',notifications_sent:0,formal_complete:false,production_deployed:false,unconfirmed_rules_remain_blocking:true,render_scope:ui.scope,artifact_sha256:digest(payload),checked_at:new Date().toISOString()};
 fs.writeFileSync(path.join(dir,'final-engineering-receipt.json'),JSON.stringify(final,null,2));return final;
}
if(require.main===module){try{console.log(JSON.stringify(verify(path.resolve(process.argv[2]))));}catch(e){console.error(e.stack);process.exitCode=1;}}
module.exports={verify};
