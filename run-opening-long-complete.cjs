'use strict';

// 開盤多獨立入口。
// 讀取正式 strategy4_daily_ohlcv_view 水源，輸出不會覆蓋開盤空。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const arg = (name, fallback) => process.argv.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const root = __dirname;
const date = arg('date', new Date().toISOString().slice(0, 10));
const outputRoot = arg('output-root', 'C:/fuman-runtime/outputs/opening-long-market');
const sourceScript = path.join(root, 'opening-long-v1.cjs');
const runId = `opening-long-${date.replaceAll('-', '')}-${crypto.randomUUID()}`;
const report = path.join(outputRoot, `opening-long-market-${date.replaceAll('-', '')}.json`);
const receipt = path.join(outputRoot, `${runId}-receipt.json`);

fs.mkdirSync(outputRoot, { recursive: true });

function run() {
  if (!fs.existsSync(sourceScript)) throw new Error(`MISSING_SOURCE_SCRIPT:${sourceScript}`);
  const result = require('child_process').spawnSync(process.execPath, [sourceScript, `--date=${date}`, `--output=${report}`], { encoding: 'utf8', windowsHide: true });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) throw new Error(result.stderr || `OPENING_LONG_FAILED_${result.status}`);
  const body = JSON.parse(fs.readFileSync(report, 'utf8'));
  body.run_id = runId;
  body.contract = 'opening-long-premarket-v1';
  body.formal_receipt_status = 'COMPLETE';
  body.auto_order = false;
  fs.writeFileSync(report, JSON.stringify(body, null, 2));
  fs.writeFileSync(receipt, JSON.stringify({
    contract: 'opening-long-premarket-v1',
    run_id: runId,
    requested_date: date,
    trade_date: body.trade_date,
    status: 'complete',
    complete: true,
    exitCode: 0,
    report,
    counts: body.counts,
    source: 'strategy4_daily_ohlcv_view',
  }, null, 2));
  console.log(JSON.stringify({ status: 'COMPLETE', report, receipt, counts: body.counts }));
}

try { run(); } catch (error) { console.error(error.message); process.exitCode = 1; }
