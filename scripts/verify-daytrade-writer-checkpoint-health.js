const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const FORMAL_ROOT = 'C:\\fuman-release-owner\\fuman-terminal';
const RUNTIME_ROOT = 'C:\\fuman-runtime';
const TASK_NAME = 'Fuman Daytrade Source Writer 0600-1330';
const PWSH = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const MAX_SOURCE_AGE_SECONDS = 180;
const MAX_SUCCESS_AGE_SECONDS = 360;

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; }
}

function ageSeconds(value) {
  const stamp = Date.parse(String(value || ''));
  return Number.isFinite(stamp) ? Math.max(0, Math.floor((Date.now() - stamp) / 1000)) : 999999;
}

function taipeiParts() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(new Date()).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return { ...parts, tradeDate: `${parts.year}-${parts.month}-${parts.day}`, minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute) };
}

function queryTask() {
  const escaped = TASK_NAME.replace(/'/g, "''");
  const command = `$t=Get-ScheduledTask -TaskName '${escaped}' -ErrorAction Stop; $i=Get-ScheduledTaskInfo -TaskName '${escaped}' -ErrorAction Stop; $a=$t.Actions|Select-Object -First 1; [ordered]@{state=[string]$t.State;execute=[string]$a.Execute;arguments=[string]$a.Arguments;workingDirectory=[string]$a.WorkingDirectory;lastRunTime=$i.LastRunTime.ToString('o');lastResult=[int64]$i.LastTaskResult;nextRunTime=$i.NextRunTime.ToString('o')}|ConvertTo-Json -Compress`;
  const result = spawnSync(PWSH, ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (result.status !== 0) return { error: String(result.stderr || result.stdout || 'task_query_failed').trim() };
  try { return JSON.parse(String(result.stdout || '').trim()); } catch { return { error: 'task_query_invalid_json' }; }
}

function parseCompletionLog(file) {
  if (!fs.existsSync(file)) return { latest: null, latestSuccess: null, eventCount: 0 };
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const events = [];
  for (const line of lines) {
    const match = line.match(/^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\] (DONE ok\b.*|FAIL\b.*)$/);
    if (!match) continue;
    const at = `${match[1]}T${match[2]}+08:00`;
    events.push({ at, type: match[3].startsWith('DONE ok') ? 'success' : 'failure', detail: match[3] });
  }
  return { latest: events.at(-1) || null, latestSuccess: events.filter((e) => e.type === 'success').at(-1) || null, eventCount: events.length };
}

const now = taipeiParts();
const requestedDate = (process.argv.find((arg) => arg.startsWith('--trade-date=')) || '').split('=')[1] || now.tradeDate;
const weekday = !['Sat', 'Sun'].includes(now.weekday);
const due = weekday && now.minuteOfDay >= 365 && now.minuteOfDay <= 815;
const task = queryTask();
const v2File = path.join(RUNTIME_ROOT, 'state', 'fugle-daytrade-websocket-status-v2.json');
const motherFile = path.join(RUNTIME_ROOT, 'state', 'daytrade-mother-pool-delta.json');
const wrapperLog = path.join(RUNTIME_ROOT, 'logs', `daytrade-source-writer-${requestedDate.replaceAll('-', '')}.wrapper.log`);
const v2 = readJson(v2File, {});
const mother = readJson(motherFile, {});
const round = mother.round_summary || {};
const completion = parseCompletionLog(wrapperLog);
const issues = [];

if (due) {
  const actionText = `${task.execute || ''} ${task.arguments || ''} ${task.workingDirectory || ''}`.toLowerCase();
  if (task.error) issues.push(task.error);
  if (!actionText.includes(FORMAL_ROOT.toLowerCase())) issues.push('writer_task_formal_root_mismatch');
  if (!actionText.includes('run-daytradesourcewriter.ps1')) issues.push('writer_task_runner_mismatch');
  if (v2.ok !== true || v2.websocketConnected !== true || v2.websocketAuthenticated !== true) issues.push('v2_transport_not_ready');
  if (String(v2.primarySource || '').toLowerCase() !== 'fugle-websocket' || v2.restDisabled !== true) issues.push('v2_source_contract_mismatch');
  if (ageSeconds(v2.updatedAt) > MAX_SOURCE_AGE_SECONDS) issues.push('v2_status_stale');
  if (now.minuteOfDay >= 420) {
    if (String(round.trade_date || '') !== requestedDate) issues.push('mother_pool_trade_date_mismatch');
    const rows = Number(round.mother_pool_rows || 0);
    if (!(rows > 0 && rows <= 600)) issues.push('mother_pool_dynamic_range_invalid');
    if (ageSeconds(round.checked_at) > MAX_SUCCESS_AGE_SECONDS) issues.push('mother_pool_receipt_stale');
    if (!completion.latestSuccess || ageSeconds(completion.latestSuccess.at) > MAX_SUCCESS_AGE_SECONDS) issues.push('writer_success_stale');
    if (completion.latest?.type === 'failure') issues.push('writer_latest_completion_failed');
  }
}

const ok = !due || issues.length === 0;
const result = {
  contract: 'daytrade-writer-checkpoint-health-v1',
  checkedAt: new Date().toISOString(),
  tradeDate: requestedDate,
  due,
  ok,
  status: ok ? 'PASS' : 'FAIL_CLOSED',
  readOnly: true,
  supabaseQueried: false,
  strategyStarted: false,
  task,
  v2: {
    ok: v2.ok === true,
    updatedAt: v2.updatedAt || '',
    ageSeconds: ageSeconds(v2.updatedAt),
    websocketConnected: v2.websocketConnected === true,
    websocketAuthenticated: v2.websocketAuthenticated === true,
    primarySource: v2.primarySource || '',
    restDisabled: v2.restDisabled === true,
  },
  motherPool: {
    tradeDate: round.trade_date || '',
    checkedAt: round.checked_at || '',
    ageSeconds: ageSeconds(round.checked_at),
    rows: Number(round.mother_pool_rows || 0),
    hotRows: Number(round.hot_pool_rows || 0),
    dataGapCount: Number(round.data_gap_count || 0),
  },
  completion,
  issues,
  firstBlocker: issues[0] || null,
};

const receiptDir = path.join(RUNTIME_ROOT, 'data', 'scan-receipts');
fs.mkdirSync(receiptDir, { recursive: true });
const dated = path.join(receiptDir, `daytrade-writer-checkpoint-health-${requestedDate.replaceAll('-', '')}.json`);
const latest = path.join(receiptDir, 'daytrade-writer-checkpoint-health-latest.json');
fs.writeFileSync(dated, JSON.stringify(result, null, 2) + '\n');
fs.writeFileSync(latest, JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
process.exitCode = ok ? 0 : 1;
