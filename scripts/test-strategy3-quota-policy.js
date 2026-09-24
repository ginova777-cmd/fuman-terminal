const assert=require('node:assert/strict'),{valid,quotaPolicyHash}=require('../lib/strategy3-line-exception');
const scan={run_id:'strategy3v2-recovery-replay-20260917-test',result_count:9};
const line={status:'SKIPPED_QUOTA_EXHAUSTED',ok:false,run_id:scan.run_id,date:'2026-09-17',count:9,authorization_sha256:quotaPolicyHash,line_push_personal_ok:false,line_push_group_ok:false,delivery_evidence:[],quota_evidence:{source:'LINE Messaging API quota and consumption',quota_type:'limited',delivered:false,quota_limit:200,total_usage:200,checked_at:new Date().toISOString()}};
assert.equal(valid(line,scan,line.date),true);
for(const delta of [{quota_evidence:null},{run_id:'wrong'},{ok:true},{count:8},{line_push_personal_ok:true}])assert.equal(valid({...line,...delta},scan,line.date),false);
for(const delta of [{total_usage:199},{checked_at:'2026-01-01'},{quota_limit:0},{delivered:true}])assert.equal(valid({...line,quota_evidence:{...line.quota_evidence,...delta}},scan,line.date),false);
console.log(JSON.stringify({ok:true,official_quota_evidence_required:true,not_delivered:true}));
