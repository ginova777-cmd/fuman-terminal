'use strict';
// Transport evidence only: never retry a state-changing RPC or log its body/key.
async function invoke({resource,send,onFailure,now=Date.now}) {
  const started=now(); let status=null,requestId=null,phase='request';
  try {
    const response=await send(); status=response.status;
    requestId=response.headers?.get('sb-request-id')||response.headers?.get('x-request-id')||response.headers?.get('cf-ray')||null;
    phase='response_body'; const text=await response.text();
    if(!response.ok) { const error=new Error(`${resource} RPC HTTP ${status}: ${text.slice(0,240)}`); throw error; }
    phase='json_decode'; return text?JSON.parse(text):[];
  } catch(error) {
    const evidence={stage:'supabase_rpc_failed',resource,phase,http_status:status,request_id:requestId,elapsed_ms:now()-started,error_name:error.name,execution_outcome:'unknown',retry_performed:false};
    if(onFailure) await onFailure(evidence);
    throw error;
  }
}
module.exports={invoke};
