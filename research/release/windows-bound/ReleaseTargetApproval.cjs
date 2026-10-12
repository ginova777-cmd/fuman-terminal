'use strict';
// Bounded stdin bridge for the PowerShell in-memory sealed configuration.
const chunks=[];let bytes=0;
process.stdin.on('data',b=>{bytes+=b.length;if(bytes>1024*1024){process.stderr.write('APPROVAL_INPUT_TOO_LARGE');process.exit(1);}chunks.push(b);});
process.stdin.on('end',()=>{try{require('./ReleaseTargetContract.cjs').validate(JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'')),true);}catch(e){process.stderr.write(e.message);process.exitCode=1;}});
