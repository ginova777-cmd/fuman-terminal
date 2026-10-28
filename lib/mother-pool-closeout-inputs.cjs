'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { evaluate } = require('./daytrade-module-recovery-policy.cjs');
const MAX_BYTES = 16 * 1024 * 1024;
function permission(policy, registry, identity) {
  if (!/^[a-f0-9]{40}$/.test(identity.release_sha || '')) return { allowed: false, reason: 'MODULE_RELEASE_UNVERIFIED' };
  const result = evaluate(policy, registry, identity);
  const authorized=result.enabled.includes('B18')||result.probe==='B18';
  const parent=[...result.enabled,...(result.supply_only||[])].includes('B01');
  return {allowed:authorized&&parent,reason:authorized&&!parent?'B18_B01_SUPPLY_NOT_AUTHORIZED':result.reason};
}
function readBounded(file) {
  if (fs.statSync(file).size > MAX_BYTES) throw Error('CLOSEOUT_RECEIPT_SIZE_LIMIT');
  return require('./daytrade-shared-evidence.cjs').read(file,process.env.FUMAN_RUNTIME||process.env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime');
}
function rounds(dir, date, canonical) {
  const prefix = `b01-${date.replaceAll('-', '')}-`;
  return fs.readdirSync(dir).filter(name => name.startsWith(prefix) && name.endsWith('.json')).map(name => {
    const file = path.join(dir, name);
    return { file, value: readBounded(file) };
  }).filter(({ value: v }) => v.module_id === 'B01' && v.trade_date === date && v.canonical_run_id === canonical && v.db_readback && !v.rounds_verified)
    .sort((a, b) => Date.parse(b.value.observed_at) - Date.parse(a.value.observed_at));
}
module.exports = { permission, readBounded, rounds, MAX_BYTES };
