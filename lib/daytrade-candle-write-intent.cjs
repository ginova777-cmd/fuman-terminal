'use strict';
const fs=require('node:fs'),path=require('node:path');
const {atomicJson,hashBytes}=require('./mother-pool-receipt-current.cjs');
function beforeWrite({runtime,rows,writer}){
 if(!rows.length)return;
 // Invalidate the published proof before any HTTP mutation. A crash leaves it blocked.
 atomicJson(path.join(runtime,'state/daytrade-fast-supabase-sync.json'),{ok:false,status:'CANDLE_WRITE_IN_PROGRESS',writer,started_at:new Date().toISOString()});
 const file=path.join(runtime,'state',writer==='writer'?'daytrade-fast-candle-delta.json':'daytrade-writer-candle-delta.json');
 if(!fs.existsSync(file))return;
 const saved=JSON.parse(fs.readFileSync(file,'utf8')), checkpoint=writer==='writer'?saved:saved.checkpoint;
 if(!checkpoint||!checkpoint.hashes)throw Error('CANDLE_COUNTERPART_CHECKPOINT_INVALID');
 if(writer!=='writer'&&saved.sha256!==hashBytes(JSON.stringify(checkpoint)))throw Error('CANDLE_COUNTERPART_CHECKPOINT_HASH');
 for(const row of rows){const id=row.symbol+'|'+row.candle_time;delete checkpoint.hashes[id];if(checkpoint.save_evidence)delete checkpoint.save_evidence[id];}
 atomicJson(file,writer==='writer'?checkpoint:{checkpoint,sha256:hashBytes(JSON.stringify(checkpoint))});
}
module.exports={beforeWrite};
