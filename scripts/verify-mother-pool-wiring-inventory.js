'use strict';
const fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'..','docs','mother-pool-a01-b24-wiring-inventory.md');
const text=fs.readFileSync(file,'utf8');
const writer=fs.readFileSync(path.join(__dirname,'run-daytrade-source-writer.js'),'utf8');
const preopen=fs.existsSync(path.join(__dirname,'..','lib','preopen-a15-a19.js'));
const detectors=fs.existsSync(path.join(__dirname,'..','lib','intraday-context-detectors-b19-b24.js'));
const ids=[...text.matchAll(/^\| ((?:A|B)\d{2}) \|/gm)].map(m=>m[1]);
const expected=[...Array.from({length:19},(_,i)=>`A${String(i+1).padStart(2,'0')}`),...Array.from({length:24},(_,i)=>`B${String(i+1).padStart(2,'0')}`)];
const duplicates=ids.filter((id,i)=>ids.indexOf(id)!==i);
const missing=expected.filter(id=>!ids.includes(id));
const extra=ids.filter(id=>!expected.includes(id));
if(ids.length!==expected.length||duplicates.length||missing.length||extra.length) {
 console.error(JSON.stringify({ok:false,ids:ids.length,duplicates,missing,extra})); process.exit(1);
}
const wiringChecks={writer_calls_preopen:writer.includes('buildPreopenA15A19Evidence'),writer_calls_b19_b24:writer.includes('buildB19B24Evidence'),preopen_module_present:preopen,event_detectors_present:detectors};
const wiringGaps=Object.entries(wiringChecks).filter(([,ok])=>!ok).map(([k])=>k);
console.log(JSON.stringify({ok:wiringGaps.length===0,inventory:'A01-A19+B01-B24',count:ids.length,source:file,wiring_checks:wiringChecks,wiring_gaps:wiringGaps}));
if(wiringGaps.length) process.exitCode=1;
