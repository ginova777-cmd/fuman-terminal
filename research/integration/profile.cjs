'use strict';
const fs=require('fs'),path=require('path');let stage='setup',last=performance.now();const stages={},calls={};
const output=path.join(__dirname,'storm-profile.json');
function save(){fs.writeFileSync(output,JSON.stringify({stage,stages,calls,elapsed_ms:performance.now(),rss:process.memoryUsage().rss},null,2));}
function mark(next){const t=performance.now();stages[stage]=(stages[stage]||0)+t-last;last=t;stage=next;if(process.env.MP_PROFILE==='1')save();}
function measure(name,f){if(process.env.MP_PROFILE!=='1')return f();const t=performance.now();try{return f();}finally{const c=calls[name]||(calls[name]={count:0,ms:0});c.count++;c.ms+=performance.now()-t;}}
module.exports={mark,measure,save};
