'use strict';
const fs=require('fs');
const {local,sha}=require('./producer-handoff.cjs');
function build(file){const bytes=fs.readFileSync(local(file)),m=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));if(!/^[a-f0-9]{40}$/.test(m.candidate||'')||!/^[a-f0-9]{40}$/.test(m.production_base||'')||!Array.isArray(m.files)||!m.files.length||m.files.some(f=>!f.path.startsWith('research/')||!/^[a-f0-9]{64}$/.test(f.sha256)))throw Error('CANDIDATE_MANIFEST_INVALID');return {contract:'isolated-release-config-v1',scope:'ISOLATED_REVIEW',target:m.candidate,expected:m.production_base,rollback:m.production_base,manifest_hash:sha(m),manifest_raw_hash:sha(bytes),file_count:m.files.length,approval:null,formal_apply_authorized:false,flags:{FUMAN_CHANGE_EVIDENCE_PHASE1:'0',MP_PHASE2_ENABLED:'0',MP_PHASE3_ENABLED:'0',MP_PHASE4_ENABLED:'0',MP_RELEASE_PREP_PUBLISHER:'0'}};}
module.exports={build};
