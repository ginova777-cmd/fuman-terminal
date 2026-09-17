'use strict';
const fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'..','docs','mother-pool-a01-b24-wiring-inventory.md');
const text=fs.readFileSync(file,'utf8');
const ids=[...text.matchAll(/^\| ((?:A|B)\d{2}) \|/gm)].map(m=>m[1]);
const expected=[...Array.from({length:19},(_,i)=>`A${String(i+1).padStart(2,'0')}`),...Array.from({length:24},(_,i)=>`B${String(i+1).padStart(2,'0')}`)];
const duplicates=ids.filter((id,i)=>ids.indexOf(id)!==i);
const missing=expected.filter(id=>!ids.includes(id));
const extra=ids.filter(id=>!expected.includes(id));
if(ids.length!==expected.length||duplicates.length||missing.length||extra.length) {
 console.error(JSON.stringify({ok:false,ids:ids.length,duplicates,missing,extra})); process.exit(1);
}
console.log(JSON.stringify({ok:true,inventory:'A01-A19+B01-B24',count:ids.length,source:file}));
