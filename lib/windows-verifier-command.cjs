'use strict';
const path=require('node:path');
// The caller retains its existing timeout/maxBuffer. The Windows host owns a
// non-inheritable, non-breakaway Job handle, so killing it kills its descendants.
function command(executable,args){
 if(process.platform!=='win32')return {file:executable,args};
 const payload=Buffer.from(JSON.stringify({executable,args})).toString('base64');
 return {file:path.join(process.env.ProgramFiles||'C:/Program Files','PowerShell','7','pwsh.exe'),args:['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(__dirname,'windows-verifier-job.ps1'),'-Payload',payload]};
}
module.exports={command};
