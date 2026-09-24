'use strict';
const assert = require('node:assert/strict');
const { accepted } = require('../lib/mother-pool-total-acceptance');
const ids = Object.keys(require('../data/contracts/mother-pool-a01-b24-module-registry-v1.json').modules);
const results = ids.map(module_id => ({ module_id, status: 'complete', complete: true, exit_code: 0 }));
const receipt = { status: 'complete', complete: true, exit_code: 0, first_blocker: null, failed_checks: [] };
let checks = 0;
const test = (name, run) => { run(); checks++; console.log('PASS ' + name); };
test('complete receipt accepted', () => assert(accepted(results, { status: 0 }, receipt, ids)));
for (const patch of [{ status: 'pending' }, { complete: false }, { exit_code: 2 }, { exit_code: undefined }, { failed_checks: ['FAILED'] }, { first_blocker: 'MISSING' }]) {
  test('process zero cannot override ' + JSON.stringify(patch), () => assert(!accepted(results, { status: 0 }, { ...receipt, ...patch }, ids)));
}
test('missing module rejected', () => assert(!accepted(results.slice(1), { status: 0 }, receipt, ids)));
test('duplicate module rejected', () => assert(!accepted([results[1], ...results.slice(1)], { status: 0 }, receipt, ids)));
test('pending module rejected', () => assert(!accepted([{ ...results[0], status: 'pending' }, ...results.slice(1)], { status: 0 }, receipt, ids)));
test('failed process rejected', () => assert(!accepted(results, { status: 1 }, receipt, ids)));
test('spawn error rejected', () => assert(!accepted(results, { status: 0, error: 'spawn failure' }, receipt, ids)));
console.log(JSON.stringify({ checks, scope: 'isolated', production_complete: false }));
