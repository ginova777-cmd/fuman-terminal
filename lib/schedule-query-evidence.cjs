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
function rootPolicy(contract, gate, resolvePath=require('fs').realpathSync) {
 if(gate?.ok!==true || gate.productionClean!==true || gate.productionHead!==contract.approvedProductionSha) throw Error('RELEASE_ROOT_DRIFT');
 const win=require('path').win32;
 const norm=x=>{try {if(!/^[a-z]:[\\/]/i.test(String(x)))return '';return win.normalize(resolvePath(String(x))).replace(/\\+$/,'').toLowerCase();}catch{return '';}};
 const roots=[contract.sourceRoot,contract.productionRoot].map(norm);
 if(roots.some(x=>!x))throw Error('INVALID_ROOT_AUTHORITY');
 function entry(task){
  const executors={
   'c:\\program files\\powershell\\7\\pwsh.exe':'pwsh.exe',
   'c:\\windows\\system32\\windowspowershell\\v1.0\\powershell.exe':'powershell.exe',
   'c:\\program files\\nodejs\\node.exe':'node.exe'
  };
  const value=String(task?.execute||'').trim();
  const rawExe=/^"[^"\r\n]+"$/.test(value)?value.slice(1,-1):value;
  if(!/^[a-z]:[\\/]/i.test(rawExe))return '';
  const lexicalExe=win.normalize(rawExe).toLowerCase();
  const exe=executors[lexicalExe];
  // No PATH lookup; an approved spelling redirected elsewhere is also rejected.
  if(!exe || norm(rawExe)!==lexicalExe)return '';
  const raw=String(task?.arguments||'');
  // Accept only unambiguous task argument tokens; no shell evaluation.
  if(/[\r\n`]/.test(raw))return '';
  const tokens=[];const re=/\s*(?:"([^"\r\n]*)"|([^\s"]+))/gy;let pos=0;
  while(pos<raw.length){if(!raw.slice(pos).trim())break;re.lastIndex=pos;const m=re.exec(raw);if(!m)return '';tokens.push(m[1]??m[2]);pos=re.lastIndex;if(pos<raw.length&&!/\s/.test(raw[pos]))return '';}
  let file='';
  if(['pwsh.exe','powershell.exe'].includes(exe)){
   let i=0;for(;i<tokens.length;i++){
    const t=tokens[i].toLowerCase();
    if(t==='-file'){file=tokens[i+1]||'';if(tokens.slice(i+2).some(x=>/^-file$/i.test(x)))return '';break;}
    if(['-noprofile','-noninteractive','-nologo'].includes(t))continue;
    if(['-executionpolicy','-windowstyle'].includes(t)){if(!tokens[++i])return '';continue;}
    return '';
   }
   if(!/\.ps1$/i.test(file))return '';
  }else if(exe==='node.exe'){
   let i=0;while(tokens[i]==='--use-system-ca')i++;
   file=tokens[i]||'';if(!/\.(?:js|cjs|mjs)$/i.test(file))return '';
  }else return '';
  return norm(file);
 }
 const under=(file,root)=>!!file&&!!root&&file.startsWith(root+'\\');
 return {isRoot:value=>roots.includes(norm(value)),entry,actionUsesRoot:task=>roots.some(root=>under(entry(task),root)),actionUsesRuntime:task=>under(entry(task),norm(win.join(contract.runtimeRoot||'', 'ops')))};
}
module.exports={checkedText,rows,rootPolicy};
