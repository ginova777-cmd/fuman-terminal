'use strict';
function fail(code, source, result) {
 const error = new Error(`${code}:${source}`);
 error.evidence = {source, code, exitCode:result?.status ?? null, errorCode:result?.error?.code || null, stderr:String(result?.stderr || '').slice(0,4096)};
 throw error;
}
function checkedText(result, source) {
 if(result.error || result.status !== 0 || String(result.stderr || '').trim()) fail('SCHEDULE_QUERY_FAILED',source,result);
 const text=String(result.stdout || '').replace(/^\uFEFF/,'').trim();
 if(!text) fail('SCHEDULE_QUERY_EMPTY_OUTPUT',source,result);
 return text;
}
function rows(result,source) {
 const text=checkedText(result,source); let parsed;
 try {parsed=JSON.parse(text);} catch {fail('SCHEDULE_QUERY_INVALID_JSON',source,result);}
 const list=Array.isArray(parsed)?parsed:[parsed];
 if(!list.length || list.some(x=>!x || typeof x.name!=='string' || !x.name.trim())) fail('SCHEDULE_QUERY_INVALID_ROWS',source,result);
 return list;
}
function rootPolicy(contract, gate) {
 if(gate?.ok!==true || gate.productionClean!==true || gate.productionHead!==contract.approvedProductionSha) throw Error('RELEASE_ROOT_DRIFT');
 const norm=x=>String(x||'').replace(/\//g,'\\').replace(/\\+$/,'').toLowerCase();
 const roots=[contract.sourceRoot,contract.productionRoot].map(norm);
 if(roots.some(x=>!x))throw Error('INVALID_ROOT_AUTHORITY');
 return {isRoot:value=>roots.includes(norm(value)),actionUsesRoot:value=>roots.some(root=>norm(value).includes(root+'\\'))};
}
module.exports={checkedText,rows,rootPolicy};
