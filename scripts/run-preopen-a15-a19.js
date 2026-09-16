"use strict";
const fs=require("fs"),path=require("path"); const {a15,a16,a17,a18,a19}=require("../lib/preopen-a15-a19");
const arg=n=>{const x=process.argv.find(v=>v.startsWith(`--${n}=`));return x?x.slice(n.length+3):null};
const input=arg("input"), out=arg("out")||path.join(process.env.FUMAN_RUNTIME_DIR||"C:/fuman-runtime","data","scan-receipts",`preopen-a15-a19-${new Date().toISOString().slice(0,10).replace(/-/g,"")}.json`);
let src={}; if(input&&fs.existsSync(input)) src=JSON.parse(fs.readFileSync(input,"utf8"));
const evidence={a15:a15(src.a15||{}),a16:a16(src.a16||[]),a17:a17(src.a17||[]),a18:a18(src.a18||[])}; const receipt=a19(evidence); const payload={contract:"preopen_a15_a19_runner_v1",trade_date:src.trade_date||null,canonical_run_id:src.canonical_run_id||null,generated_at:new Date().toISOString(),...evidence,...receipt,receipt_path:out}; fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out,JSON.stringify(payload,null,2)+"\n"); console.log(JSON.stringify(payload,null,2)); process.exitCode=payload.complete?0:1;
