'use strict';
const fs = require('node:fs');
const path = require('node:path');
// Local state only. Call under the writer's exclusive lock. No network or timers.
function load(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw Error('WRITER_BACKOFF_STATE_INVALID'); }
}
function validate(s) {
  if (s && (s.contract !== 'writer_database_backoff_v1' || !Number.isInteger(s.failures) || s.failures < 0 || s.failures > 32 || !Number.isFinite(s.until))) throw Error('WRITER_BACKOFF_STATE_INVALID');
  return s;
}
function transient(message) {
  return /HTTP[ _:]*(?:429|500|502|503|504|521|522|523|524)\b|fetch failed|AbortError|TimeoutError|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|operation was aborted|statement timeout|pool.*(?:timeout|timed out)/i.test(String(message));
}
function write(file, state) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const temp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(state));
  fs.renameSync(temp, file);
}
function check(file, now = Date.now()) {
  const state = validate(load(file));
  return {blocked:!!state && state.until > now, retry_at:state?.until || null, failures:state?.failures || 0};
}
function failure(file, message, now = Date.now()) {
  if (!transient(message)) return {recorded:false};
  const previous = validate(load(file));
  // An old failure must not penalize a new trading day indefinitely.
  const failures = previous && now - previous.until < 3600000 ? Math.min(previous.failures + 1, 32) : 1;
  const delay = Math.min(300000, 60000 * 2 ** Math.min(failures - 1, 3));
  const state = {contract:'writer_database_backoff_v1', failures, until:now + delay, updated_at:new Date(now).toISOString(), reason:'TRANSIENT_DATABASE_FAILURE'};
  // Never persist raw server responses or credentials.
  write(file, state);
  return {recorded:true, ...state};
}
function success(file, now = Date.now()) {
  write(file, {contract:'writer_database_backoff_v1', failures:0, until:0, updated_at:new Date(now).toISOString(), reason:'WRITER_ROUND_SUCCEEDED'});
}
module.exports = {check, failure, success, transient};
if (require.main === module) {
  try {
    const [action, file] = process.argv.slice(2);
    if (!file || !['check','failure','success'].includes(action)) throw Error('WRITER_BACKOFF_ARGUMENTS_INVALID');
    const result = action === 'failure' ? failure(file, fs.readFileSync(0,'utf8')) : module.exports[action](file);
    console.log(JSON.stringify(result || {ok:true}));
    if (result?.blocked) process.exitCode = 75;
  } catch (error) { console.error(JSON.stringify({ok:false,reason:error.message})); process.exitCode=1; }
}
