"use strict";
const assert=require('node:assert/strict');
const {CONTRACT,deliveryReceiptMatches:match,receiptFilename}=require('../lib/opening-report-receipt-authority');
const row={contract:'opening-report-morning-single-verifier-v1',scope:'stage_delivery',phase:'delivery',require_current:true,trade_date:'2026-09-17',stage:'asia_0850',run_id:'asia-run',canonical_verifier:CONTRACT.canonical_command,complete:true,status:'complete',exitCode:0,failed_checks:[],first_blocker:null};
assert.equal(match(row,'2026-09-17','asia_0850','asia-run'),true);
for(const delta of [{scope:'contract_only'},{phase:'static'},{require_current:false},{stage:'us_0820'},{run_id:'old-run'},{trade_date:'2026-09-16'},{failed_checks:['failed']},{first_blocker:'gap'},{exitCode:1},{complete:false},{canonical_verifier:'retired'}])assert.equal(match({...row,...delta},'2026-09-17','asia_0850','asia-run'),false);
assert.equal(new Set(['static','preflight','delivery'].map(p=>receiptFilename(p,'20260917'))).size,3);
assert.equal(receiptFilename('delivery','20260917'),'opening-report-morning-contract-verifier-20260917.json');
console.log(JSON.stringify({ok:true,static_cannot_overwrite_delivery:true,old_wrong_stage_or_run_receipts_rejected:true}));
