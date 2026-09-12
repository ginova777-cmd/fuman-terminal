"use strict";
const crypto=require("crypto");
const CONTRACT="opening-report-delivery-v2";
function deliveryPayload(mode,observations){return {contract:CONTRACT,mode,observations};}
function contentHash(mode,observations){return crypto.createHash("sha256").update(JSON.stringify(deliveryPayload(mode,observations))).digest("hex");}
function validateReuse(receipt,runId,hash){
  return receipt?.line_push_attempted===true && receipt.line_push_ok===true && receipt.ok===true
    && receipt.report_run_id===runId && receipt.delivery_content_hash===hash
    && receipt.has_user_target===true && receipt.has_group_target===true && receipt.delivered_count>=2;
}
module.exports={CONTRACT,deliveryPayload,contentHash,validateReuse};
