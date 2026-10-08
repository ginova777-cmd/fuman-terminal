'use strict';
// Production-bound port design, executable only against isolated ports today.
// No production runner imports this module; no DB or sender is loaded here.
const {hash,bytes,OfflineStore}=require('../integration/offline-store.cjs');
const NAMES=['MP_PHASE2_ENABLED','MP_PHASE3_ENABLED','MP_PHASE4_ENABLED'];
function flags(env={}){const v=NAMES.map(k=>{if(env[k]===undefined||env[k]==='0')return false;if(env[k]==='1')return true;throw Error('INVALID_FLAG:'+k);});if(v[1]&&!v[0]||v[2]&&!v[1])throw Error('PHASE_DEPENDENCY');return v;}
class Wiring{
 constructor({directory,env={},ports,stop=()=>false,mode='OFFLINE_ONLY'}){this.enabled=flags(env);if(mode!=='OFFLINE_ONLY')throw Error('FORMAL_PORTS_NOT_AUTHORIZED');this.directory=directory;this.ports=ports;this.stop=stop;this.mode=mode;this.busy=false;}
 async run(input){
  if(!this.enabled.some(Boolean))return {status:'OFF',called:[],formal_connected:false};
  if(this.busy)throw Error('WIRING_BUSY');this.busy=true;
  try{
   if(this.stop())return {status:'STOPPED',called:[]};
   const store=new OfflineStore(this.directory),identity=hash(bytes({input,flags:this.enabled,port_versions:this.ports?.map(p=>p.version??null)})),prior=store.root();
   if(!Number.isSafeInteger(input.sequence)||input.sequence<1||!input.epoch||!/^\d{4}-\d{2}-\d{2}$/.test(input.trade_date))throw Error('INPUT_IDENTITY');
   if(prior&&(prior.epoch!==input.epoch||prior.trade_date!==input.trade_date))throw Error('REBASE_REQUIRED');
   if(prior&&JSON.stringify(prior.port_versions)!==JSON.stringify(this.ports?.map(p=>p.version??null)))throw Error('PORT_REBASE_REQUIRED');
   if(prior&&JSON.stringify(prior.flags)!==JSON.stringify(this.enabled))throw Error('FLAG_REBASE_REQUIRED');
   if(prior?.sequence===input.sequence){if(prior.identity!==identity)throw Error('REPLAY_CONFLICT');return {status:'REPLAY_DEDUP',root:prior};}
   if(input.sequence!==(prior?.sequence||0)+1)throw Error('SEQUENCE_GAP');
   let value=input;const called=[],proofs=[];
   for(let i=0;i<3;i++)if(this.enabled[i]){
    if(this.stop())return {status:'STOPPED',called};
    const port=this.ports?.[i];if(!port||port.scope!=='ISOLATED'||typeof port.version!=='string'||!port.version||typeof port.prepare!=='function'||typeof port.readback!=='function')throw Error('PORT_UNVERIFIED');
    const output=await port.prepare(value,{input,idempotency_key:identity,phase:i+2});
    // readback MUST be independent of the returned preparation object.
    const saved=await port.readback({input,idempotency_key:identity,phase:i+2});
    if(!saved||saved.epoch!==input.epoch||saved.trade_date!==input.trade_date||saved.sequence!==input.sequence||saved.idempotency_key!==identity||saved.sha256!==hash(bytes(saved.payload))||saved.sha256!==hash(bytes(output)))throw Error('READBACK_MISMATCH');
    proofs.push({phase:i+2,version:port.version,sha256:saved.sha256});called.push(i+2);value=output;
   }
   if(this.stop())return {status:'STOPPED',called};
   const root=store.transaction(old=>{if(hash(bytes(old))!==hash(bytes(prior)))throw Error('CONCURRENT_ROOT');return {epoch:input.epoch,trade_date:input.trade_date,sequence:input.sequence,identity,flags:this.enabled,port_versions:this.ports?.map(p=>p.version??null),proofs,previous_root:prior?store.put(prior):null,mode:'OFFLINE_ONLY',notification_authorized:false};});
   return {status:'OFFLINE_READBACK_VERIFIED',called,root,formal_connected:false};
  }finally{this.busy=false;}
 }
}
module.exports={flags,Wiring,NAMES};


