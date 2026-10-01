'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash, randomUUID} = require('node:crypto');
const TARGETS = new Set(['v_fugle_daytrade_canonical_gate', 'v_fugle_daytrade_unattended_gate_status']);
function guardError(code, retryAt) {
  return Object.assign(new Error(code), {code, retry_at: retryAt || null, status:503});
}
function transient(error) {
  const status = Number(error?.status || 0);
  return status === 408 || status === 429 || status >= 500 ||
    ['TimeoutError', 'AbortError'].includes(error?.name) ||
    /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|statement timeout/i.test(String(error?.message || ''));
}
// Failures, never positive gate decisions, survive short-lived scanner processes.
// A host-local lock prevents two processes from executing the same gate at once.
function fileStore(root) {
  function load(id) {
    try {
      const state = JSON.parse(fs.readFileSync(path.join(root, id + '.json'), 'utf8'));
      if (state.contract !== 'daytrade_gate_backoff_v1' || !Number.isInteger(state.failures) || state.failures < 0 || state.failures > 32 || !Number.isFinite(state.until) || state.until < 0) throw Error('invalid');
      return state;
    } catch (e) { if (e.code === 'ENOENT') return null; throw guardError('GATE_BACKOFF_STATE_INVALID'); }
  }
  return {
    load,
    save(id, state) {
      fs.mkdirSync(root, {recursive:true});
      const file = path.join(root, id + '.json');
      const temp = file + '.' + randomUUID() + '.tmp';
      try { fs.writeFileSync(temp, JSON.stringify({contract:'daytrade_gate_backoff_v1', ...state}), {flag:'wx'}); fs.renameSync(temp,file); }
      finally { try {fs.unlinkSync(temp);} catch(e) {if(e.code!=='ENOENT') throw e;} }
    },
    acquire(id) {
      fs.mkdirSync(root, {recursive:true});
      const file = path.join(root,id+'.lock');
      const token = randomUUID();
      // No expiry-based stealing: a slow, still-live process must retain its lock.
      try {
        const fd=fs.openSync(file,'wx');
        try { fs.writeFileSync(fd,JSON.stringify({pid:process.pid,host:os.hostname(),token})); }
        finally { fs.closeSync(fd); }
      } catch(e) {
        if(e.code!=='EEXIST') throw guardError('GATE_BACKOFF_STORAGE_UNAVAILABLE');
        // Do not unlink another process's lock without an atomic ownership check.
        // A dead owner's lock needs operator recovery, never a parallel retry.
        let deadOwner=false;
        try {
          const raw=fs.readFileSync(file,'utf8'); const owner=JSON.parse(raw);
          if(owner.host===os.hostname() && Number.isInteger(owner.pid) && owner.pid>0) {
            try {process.kill(owner.pid,0);} catch(dead) {
              if(dead.code==='ESRCH') deadOwner=true;
            }
          }
        } catch(_) {}
        throw guardError(deadOwner?'GATE_READ_ABANDONED_LOCK':'GATE_READ_IN_PROGRESS');
      }
      return () => {
        const owner=JSON.parse(fs.readFileSync(file,'utf8'));
        if(owner.token!==token) throw guardError('GATE_READ_LOCK_CHANGED');
        fs.unlinkSync(file);
      };
    }
  };
}
function createGateReadGuard({now=Date.now, store}={}) {
  const inflight=new Map(), memory=new Map();
  store ||= {load:id=>memory.get(id),save:(id,state)=>memory.set(id,state),acquire:()=>()=>{}};
  return function run({target,url,credential}, operation) {
    if(!TARGETS.has(target)) return operation();
    // Credentials are hashed, never persisted or included in diagnostic messages.
    const id=createHash('sha256').update(JSON.stringify([url,credential])).digest('hex');
    if(inflight.has(id)) return inflight.get(id).then(rows=>structuredClone(rows));
    const promise=Promise.resolve().then(async()=>{
      const release=store.acquire(id);
      try {
        const previous=store.load(id), at=now();
        if(previous?.until>at) throw guardError('GATE_READ_BACKOFF',previous.until);
        try {
          const rows=await operation();
          store.save(id,{failures:0,until:0});
          return rows;
        } catch(error) {
          if(transient(error)) {
            const count=previous && now()-previous.until<3600000 ? Math.min(previous.failures+1,32) : 1;
            const until=now()+Math.min(300000,60000*2**Math.min(count-1,3));
            store.save(id,{failures:count,until});
            error.retry_at=until;
          }
          throw error;
        }
      } finally {release();}
    });
    inflight.set(id,promise);
    promise.then(()=>inflight.delete(id),()=>inflight.delete(id));
    return promise.then(rows=>structuredClone(rows));
  };
}
let shared;
function guardedGateRead(request,operation) {
  if(!shared) {
    const root=process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || (process.platform==='win32'?'C:/fuman-runtime':null);
    shared=createGateReadGuard({store:root?fileStore(path.join(root,'state','daytrade-gate-backoff')):undefined});
  }
  return shared(request,operation);
}
module.exports={TARGETS,transient,fileStore,createGateReadGuard,guardedGateRead};
