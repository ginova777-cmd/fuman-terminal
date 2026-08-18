"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { readSnapshot } = require("../lib/supabase-snapshots");
const terminalFastBundle = require("../api/terminal-fast-bundle");
const mobileFragment = require("../api/mobile-fragment");

const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const RECEIPT = path.join(RUNTIME, "data", "scan-receipts", "strategy2-v3-replay.json");
const CONTRACT = "strategy2-live-v3-fugle-deep-scan-1m";
const REPLAY_SNAPSHOT_KEY = "strategy2_live_v3_diagnostic_replay";

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function check(checks, name, ok, detail = "") { checks.push({ name, ok: Boolean(ok), detail }); }

function decodeSnapshotRows(payload = {}) {
  if (Array.isArray(payload.records)) return payload.records;
  if (payload.recordsEncoding !== "gzip-base64-json-v1" || !payload.recordsGzip) return [];
  try {
    const decoded = zlib.gunzipSync(Buffer.from(String(payload.recordsGzip), "base64")).toString("utf8");
    return JSON.parse(decoded);
  } catch {
    return [];
  }
}

function captureResponse() {
  let resolve;
  const result = new Promise((done) => { resolve = done; });
  return {
    result,
    response: {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ statusCode: this.statusCode, payload, headers: this.headers }); return this; },
      send(payload) { resolve({ statusCode: this.statusCode, payload, headers: this.headers }); return this; },
      end(payload = "") { resolve({ statusCode: this.statusCode, payload, headers: this.headers }); return this; },
    },
  };
}

async function invoke(handler, request) {
  const capture = captureResponse();
  await handler(request, capture.response);
  return capture.result;
}

async function main() {
  const expectedDate = process.argv.find((value) => value.startsWith("--trade-date="))?.split("=")[1] || taipeiDate();
  const receipt = JSON.parse(fs.readFileSync(RECEIPT, "utf8"));
  const snapshot = await readSnapshot(REPLAY_SNAPSHOT_KEY, { tradeDate: expectedDate.replace(/\D/g, ""), allowLatestFallback: false, timeoutMs: 10000 });
  const payload = snapshot?.payload || {};
  const snapshotRows = decodeSnapshotRows(payload);
  const [desktop, mobile] = await Promise.all([
    invoke(terminalFastBundle, {
      method: "GET",
      url: "/api/terminal-fast-bundle?route=strategy2&today=1&live=1",
      query: { route: "strategy2", today: "1", live: "1" },
      headers: { host: "localhost" },
      fumanInternalVerify: true,
    }),
    invoke(mobileFragment, {
      method: "GET",
      url: "/api/mobile-fragment?tab=strategy2&live=1",
      query: { tab: "strategy2", live: "1" },
      headers: { host: "localhost" },
      fumanInternalVerify: true,
    }),
  ]);
  const desktopEndpoints = Object.entries(desktop?.payload?.endpoints || {});
  const desktopStrategy2 = desktopEndpoints.find(([endpoint]) => endpoint.includes("/api/strategy2-latest"))?.[1] || {};
  const mobileHtml = String(mobile?.payload || "");
  const mobileRunMarker = 'data-run-id="' + String(receipt.runId || "") + '"';
  const mobileVisibleRows = Math.min(60, Number(payload.snapshotRecordCount || snapshotRows.length || 0));
  const mobileCountMarker = 'data-result-count="' + String(mobileVisibleRows) + '"';
  const checks = [];
  check(checks, "replay_receipt_is_today_v3", receipt.dataDate === expectedDate && receipt.strategyContract === CONTRACT, [receipt.dataDate, receipt.strategyContract].join("/"));
  check(checks, "replay_receipt_is_nonformal", receipt.status === "diagnostic_replay" && receipt.diagnosticReplay === true && receipt.publishAllowed === false && receipt.formalDisplayAllowed === false, receipt.status);
  check(checks, "replay_snapshot_written", Boolean(snapshot) && payload.status === "diagnostic_replay", snapshot?.reason || "");
  check(checks, "replay_snapshot_is_compact_terminal_contract", payload.snapshotContract === "strategy2-v3-terminal-compact-snapshot-v2" && payload.recordsEncoding === "gzip-base64-json-v1" && !Object.prototype.hasOwnProperty.call(payload, "observations") && !Object.prototype.hasOwnProperty.call(payload, "records") && JSON.stringify(payload).length < 50000, JSON.stringify({ contract: payload.snapshotContract || "", bytes: JSON.stringify(payload).length, encoding: payload.recordsEncoding || "" }));
  check(checks, "replay_snapshot_is_nonformal", payload.diagnosticReplay === true && payload.replayDisplayAllowed === true && payload.publishAllowed === false && payload.formalDisplayAllowed === false && payload.preservePreviousGood === false, JSON.stringify({ publishAllowed: payload.publishAllowed, formalDisplayAllowed: payload.formalDisplayAllowed }));
  check(checks, "replay_has_same_day_rows", Array.isArray(snapshotRows) && snapshotRows.length > 0 && snapshotRows.every((row) => (row.scanMode || row.sm) === "strategy2_v3_diagnostic_replay" && (row.entryTradeDate || row.a) === expectedDate), String(snapshotRows.length || 0));
  check(checks, "desktop_reads_same_replay_run", desktop?.statusCode === 200 && desktopStrategy2.runId === receipt.runId && Number(desktopStrategy2.count) === Number(payload.snapshotRecordCount || snapshotRows.length || 0), JSON.stringify({ status: desktop?.statusCode, runId: desktopStrategy2.runId || "", count: desktopStrategy2.count || 0 }));
  check(checks, "desktop_strategy_tab_isolated", desktopEndpoints.length === 1 && desktopEndpoints[0]?.[0]?.includes("/api/strategy2-latest"), desktopEndpoints.map(([endpoint]) => endpoint).join(","));
  check(checks, "mobile_reads_same_replay_run", mobile?.statusCode === 200 && mobileHtml.includes(mobileRunMarker) && mobileHtml.includes(mobileCountMarker), JSON.stringify({ status: mobile?.statusCode, runId: receipt.runId || "", visibleRows: mobileVisibleRows }));
  check(checks, "mobile_discloses_nonformal_replay", mobileHtml.includes("V3 回測驗證 / 不發布、不寫入 /88") && mobileHtml.includes('data-formal-display-allowed="0"'), "nonformal disclosure");
  const failed = checks.filter((item) => !item.ok);
  console.log(JSON.stringify({ ok: failed.length === 0, status: failed.length === 0 ? "YES" : "NO", tradeDate: expectedDate, runId: receipt.runId || "", rowCount: snapshotRows.length || 0, first_blocker: failed[0]?.name || null, checks }, null, 2));
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
