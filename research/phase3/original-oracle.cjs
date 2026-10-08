'use strict';
// Offline harness only. Loads unchanged repository source in an isolated CommonJS
// realm. External files, writes, network, child processes and timers are denied.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const Module = require('module');
const ROOT = path.resolve(__dirname, '../..');
const WRITER = path.join(ROOT, 'scripts/run-daytrade-source-writer.js');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function createOracle({ memoize = false } = {}) {
  let time = Date.parse('2026-10-08T04:45:00Z');
  const NativeDate = Date;
  class Clock extends NativeDate { constructor(...a) { super(...(a.length ? a : [time])); } static now() { return time; } }
  const audit = { source_bytes_read: 0, denied_operations: [], isolated_empty_directory_reads:0, metric_calls: 0, metric_hits: 0 };
  const deny = name => (...args) => { audit.denied_operations.push(name); throw Error('OFFLINE_IO_DENIED:' + name); };
  const inside = file => { const p = path.resolve(String(file)); if (!p.startsWith(ROOT + path.sep)) throw Error('OFFLINE_EXTERNAL_READ_DENIED'); return p; };
  const safeFs = new Proxy({}, { get(_, key) {
    if (key === 'readdirSync') return file => { const p=inside(file); if(!p.startsWith(path.join(__dirname,'NONEXISTENT_OFFLINE_RUNTIME')+path.sep))throw Error('UNEXPECTED_DIRECTORY_READ'); audit.isolated_empty_directory_reads++;return []; };
    if (key === 'readFileSync') return (file, ...args) => { const p = inside(file); const value = fs.readFileSync(p, ...args); audit.source_bytes_read += Buffer.byteLength(value); return value; };
    if (key === 'existsSync') return file => { try { return fs.existsSync(inside(file)); } catch { return false; } };
    return deny('fs.' + String(key));
  }});
  const context = vm.createContext({ Date: Clock, Map, Set, Buffer, URL, URLSearchParams,
    console: { log() {}, warn() {}, error() {} },
    process: { env: { FUMAN_RUNTIME_ROOT: path.join(__dirname, 'NONEXISTENT_OFFLINE_RUNTIME') }, argv: ['node','offline'], platform: process.platform, cwd: () => ROOT },
    fetch: deny('fetch'), setTimeout: deny('setTimeout'), setInterval: deny('setInterval'), clearTimeout() {},
  });
  const modules = new Map();
  const source = fs.readFileSync(WRITER, 'utf8');
  function load(file) {
    file = inside(file);
    if (modules.has(file)) return modules.get(file).exports;
    const mod = { exports: {} }; modules.set(file, mod);
    if (file.endsWith('.json')) { mod.exports = JSON.parse(fs.readFileSync(file, 'utf8')); return mod.exports; }
    let code = fs.readFileSync(file, 'utf8');
    audit.source_bytes_read += Buffer.byteLength(code);
    if (file === WRITER) code += `\nconst phase3NativeMetrics = quoteMetrics;
      let phase3Cache = new Map(), phase3Memo = false;
      let phase3Calls = 0, phase3Hits = 0;
      quoteMetrics = function(symbol,...args) {
        if (phase3Memo && phase3Cache.has(symbol)) { phase3Hits++; return structuredClone(phase3Cache.get(symbol)); }
        phase3Calls++; const result = phase3NativeMetrics(symbol,...args);
        if(phase3Memo) phase3Cache.set(symbol,structuredClone(result)); return result;
      };
      module.exports.phase3Invalidate = function(all,symbols,memo) {
        phase3Memo=memo; phase3Calls=0;phase3Hits=0;
        if(all) phase3Cache.clear(); else for(const symbol of symbols) phase3Cache.delete(symbol);
      };
      module.exports.phase3Stats=()=>({metric_calls:phase3Calls,metric_hits:phase3Hits});\n`;
    const req = name => {
      if (name === 'fs' || name === 'node:fs') return safeFs;
      if (/^(node:)?(child_process|http|https|net|tls|worker_threads)$/.test(name)) return new Proxy({}, { get: (_, key) => deny(name+'.'+String(key)) });
      if (Module.builtinModules.includes(name) || name.startsWith('node:')) return require(name);
      const resolved = require.resolve(name, { paths: [path.dirname(file)] });
      return load(resolved);
    };
    req.main = null;
    vm.runInContext('(function(require,module,exports,__filename,__dirname){'+code+'\n})', context, { filename:file })(req,mod,mod.exports,file,path.dirname(file));
    return mod.exports;
  }
  context.structuredClone = structuredClone;
  const original = load(WRITER);
  let previousTime = null;
  return {
    source: { path: WRITER, sha256: hash(source), method:'evaluateMemoryPool -> unchanged buildPriorityPool', harness:'metrics memo hook only; original rules unmodified' }, audit,
    evaluate(input, { asOf, changedSymbols = [], invalidateAll = false } = {}) {
      const next = Date.parse(asOf); if (!Number.isFinite(next)) throw Error('ASOF_INVALID');
      time = next;
      original.phase3Invalidate(invalidateAll || previousTime !== next, changedSymbols, memoize);
      previousTime = next;
      const rows = original.evaluateMemoryPool(input);
      Object.assign(audit, original.phase3Stats());
      // Preserve enumerable array metadata such as allocation and failure counts.
      return { rows: structuredClone([...rows]), metadata: Object.fromEntries(Object.keys(rows).filter(k=>!/^\d+$/.test(k)).map(k=>[k,structuredClone(rows[k])])), metrics: original.phase3Stats() };
    },
    invalidate() { previousTime = null; },
  };
}
module.exports = { createOracle, hash };
