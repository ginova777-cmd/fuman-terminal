'use strict';
const assert = require('node:assert/strict');
const { transportIsStale } = require('../lib/collector-transport-health.cjs');
const nowMs = Date.parse('2026-10-02T00:00:00Z');
const ago = seconds => new Date(nowMs - seconds * 1000).toISOString();
const check = changes => transportIsStale({ nowMs, openedAt: ago(600), heartbeatAt: '', dataReceivedAt: ago(500), timeoutMs: 120000, ...changes });
assert.equal(check({ heartbeatAt: ago(25) }), false, 'quiet premarket with server pong stays connected');
assert.equal(check({ dataReceivedAt: ago(25) }), false, 'fresh received market data keeps transport alive');
assert.equal(check({ heartbeatAt: ago(121) }), true, 'dead transport reconnects');
assert.equal(check({ openedAt: ago(30), dataReceivedAt: '' }), false, 'new connection gets startup grace');
assert.equal(check({ openedAt: ago(121), dataReceivedAt: '' }), true, 'silent startup eventually fails');
assert.equal(check({ heartbeatAt: 'bad' }), true);
assert.equal(check({ heartbeatAt: ago(-3600) }), true, 'future evidence cannot hide dead transport');
assert.equal(check({ heartbeatAt: ago(120) }), false, 'timeout boundary is inclusive');
console.log('PASS: quiet market, live data, dead transport, startup grace, invalid/future times');
// Exercise the production timer body, including its close/recovery guard.
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const collectorPath = require.resolve('./fugle-websocket-collector.js');
const source = fs.readFileSync(collectorPath, 'utf8');
const body = source.slice(source.indexOf('        const transportStale ='), source.indexOf('\n      }, Math.min(STREAMING_STATUS_MS'));
assert(body.includes('ws.close'), 'production stale timer found');
let closes = 0;
const context = { require: createRequire(collectorPath), Date: { now: () => nowMs }, openedAt: ago(600),
  lastWebSocketHeartbeatAt: ago(25), runLastMessageAt: ago(500), staleDataWindow: 120000,
  staleRecoveryTriggered: false, WebSocket: { OPEN: 1 }, ws: { readyState: 1, close: () => closes++ },
  writeStreamingStatus: () => {} };
const run = () => vm.runInNewContext(`{ ${body} }`, context);
run(); assert.equal(closes, 0);
context.lastWebSocketHeartbeatAt = ago(121);
run(); assert.equal(closes, 1); assert.equal(context.staleRecoveryTriggered, true);
run(); assert.equal(closes, 1, 'one recovery per dead connection');
console.log('PASS: production timer keeps healthy stream and closes dead stream once');
