const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
function readSecret(name) {
  for (const file of [path.join(RUNTIME_DIR, "secrets", name), path.join(ROOT, "secrets", name)]) {
    try { return fs.readFileSync(file, "utf8").trim(); } catch {}
  }
  return "";
}
const SUPABASE_URL = (process.env.STRATEGY4_SUPABASE_URL || process.env.SUPABASE_URL || readSecret("supabase-url.txt") || "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.STRATEGY4_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || readSecret("supabase-service-role-key.txt") || readSecret("terminal-supabase-key.txt") || readSecret("supabase-anon-key.txt");
const RUNS_TABLE = process.env.STRATEGY4_SUPABASE_RUNS_TABLE || "strategy4_scan_runs";
const RESULTS_TABLE = process.env.STRATEGY4_SUPABASE_RESULTS_TABLE || "strategy4_scan_results";
const MIN_ACCEPTED_COVERAGE_RATIO = Number(process.env.STRATEGY4_MIN_ACCEPTED_COVERAGE_RATIO || 0.90);
function query(params) { const search = new URLSearchParams(); Object.entries(params).forEach(([key, value]) => search.set(key, String(value))); return search.toString(); }
async function supabase(pathname, init = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing Supabase URL/key");
  const response = await fetch(`${SUPABASE_URL}${pathname}`, { ...init, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Accept: "application/json", ...(init.headers || {}) } });
  const text = await response.text();
  if (!response.ok && response.status !== 206) throw new Error(`${pathname} HTTP ${response.status} ${text.slice(0, 240)}`.trim());
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  return { response, text, json };
}
function summarizeCoverage(coverage) {
  if (!coverage || typeof coverage !== "object") return null;
  const remainingMissing = Array.isArray(coverage.remainingMissing)
    ? coverage.remainingMissing.map((item) => ({
      code: String(item?.code || item?.symbol || ""),
      lastDate: String(item?.lastDate || ""),
      rows: Number(item?.rows || 0),
      source: String(item?.source || ""),
    })).filter((item) => /^\d{4}$/.test(item.code)).slice(0, 50)
    : [];
  return {
    ok: coverage.ok === true,
    phase: String(coverage.phase || ""),
    source: String(coverage.source || ""),
    universe: Number(coverage.universe || 0),
    coverageRatio: Number(coverage.coverageRatio || 0),
    remainingMiss: Number(coverage.remainingMiss || 0),
    rawRemainingMiss: Number(coverage.rawRemainingMiss || 0),
    qualityStatus: String(coverage.qualityStatus || ""),
    acceptedReason: String(coverage.acceptedReason || ""),
    supabaseVolumeRows: Number(coverage.supabaseVolumeRows || 0),
    insufficientHistoryCount: Number(coverage.insufficientHistoryCount || 0),
    remainingMissing,
  };
}
function normalizeCode(value) { return String(value || "").replace(/\D/g, "").slice(0, 4); }
function collectDataGapCodes(payload = {}) {
  const codes = new Set();
  for (const value of [
    ...(Array.isArray(payload.noDataCodes) ? payload.noDataCodes : []),
    ...(Array.isArray(payload.staleDataGapCodes) ? payload.staleDataGapCodes : []),
    ...(Array.isArray(payload.volumeCacheMissingCodes) ? payload.volumeCacheMissingCodes : []),
    ...(Array.isArray(payload.insufficientHistory) ? payload.insufficientHistory.map((item) => item?.code || item?.symbol) : []),
  ]) {
    const code = normalizeCode(value);
    if (/^\d{4}$/.test(code)) codes.add(code);
  }
  // Older same-contract runs may expose only the complete source-miss list.
  // Reconstruct the Strategy4-relevant gaps by removing the symbols already
  // rejected by the authoritative avg5-volume gate.
  if (codes.size < Number(payload.dataGapCount || 0)) {
    const volumeFiltered = new Set((Array.isArray(payload.volumeFilter?.filtered) ? payload.volumeFilter.filtered : [])
      .map((item) => normalizeCode(item?.code || item?.symbol || item))
      .filter((code) => /^\d{4}$/.test(code)));
    for (const item of (Array.isArray(payload.supabaseCoverage?.remainingMissing) ? payload.supabaseCoverage.remainingMissing : [])) {
      const code = normalizeCode(item?.code || item?.symbol || item);
      if (/^\d{4}$/.test(code) && !volumeFiltered.has(code)) codes.add(code);
    }
  }
  return [...codes].sort();
}
async function main() {
  const expectedRunId = String(process.env.EXPECTED_STRATEGY4_RUN_ID || "").trim();
  const latestRun = await supabase(`/rest/v1/${RUNS_TABLE}?${query({ select: "*", strategy: "eq.strategy4", ...(expectedRunId ? {run_id: `eq.${expectedRunId}`} : {status: "eq.complete"}), order: "updated_at.desc", limit: 1 })}`);
  const row = Array.isArray(latestRun.json) ? latestRun.json[0] : null;
  if (!row?.run_id) throw new Error("missing latest complete Strategy4 run");
  const countResp = await supabase(`/rest/v1/${RESULTS_TABLE}?${query({ select: "run_id", run_id: `eq.${row.run_id}` })}`, { headers: { Prefer: "count=exact", Range: "0-0" } });
  const range = countResp.response.headers.get("content-range") || "";
  const match = range.match(/\/(\d+)$/);
  const readbackCount = match ? Number(match[1]) || 0 : 0;
  const resultCount = Number(row.result_count || 0);
  const resultRows = [];
  for (let offset = 0; offset < resultCount; offset += 1000) {
    const page = await supabase(`/rest/v1/${RESULTS_TABLE}?${query({select: "code,payload", run_id: `eq.${row.run_id}`, order: "rank.asc", offset, limit: Math.min(1000, resultCount-offset)})}`);
    if (!Array.isArray(page.json) || !page.json.length) break;
    resultRows.push(...page.json);
  }
  const v3Issues = require("../lib/strategy4-v4-evidence").strategy4V4Issues(row.payload || {}, resultRows);
  if (resultRows.length !== resultCount) v3Issues.push("strategy4_full_row_readback_incomplete");
  const volumeWindow=require("../lib/strategy4-volume-window");
  const expectedDates=await volumeWindow.recentTradingDates(String(row.scan_date).slice(0,10),path.join(RUNTIME_DIR,"state"));
  const filter=row.payload?.volumeFilter || {};
  if(JSON.stringify(expectedDates)!==JSON.stringify(filter.expectedDates))v3Issues.push("volume_calendar_window_mismatch");
  const daily=[];
  for(let offset=0;offset<20000;offset+=1000){
    const search=new URLSearchParams({select:"symbol,trade_date,volume_lots,volume_shares",order:"trade_date.asc,symbol.asc",offset:String(offset),limit:"1000"});
    search.append("trade_date","gte."+expectedDates[0]);search.append("trade_date","lte."+expectedDates.at(-1));
    const page=await supabase("/rest/v1/"+(process.env.STRATEGY4_DAILY_VIEW || "stock_daily_volume")+"?"+search);
    if(!Array.isArray(page.json))throw new Error("volume_readback_not_array");daily.push(...page.json);if(page.json.length<1000)break;
    if(offset===19000)throw new Error("volume_readback_page_limit");
  }
  const byCode=new Map();for(const d of daily){if(!byCode.has(d.symbol))byCode.set(d.symbol,[]);byCode.get(d.symbol).push(d);}
  for(const e of filter.evaluations || []){
    const actual=volumeWindow.evaluateVolumeWindow(byCode.get(e.code)||[],expectedDates);
    if(actual.ok!==e.ok || actual.avgVolume5!==e.avgVolume5 || JSON.stringify(actual.rows)!==JSON.stringify(e.rows))v3Issues.push("volume_authoritative_readback_mismatch:"+e.code);
  }

  const bonusModule=require('../lib/strategy4-recent-volume-bonus');
  const bonusTarget=String(row.scan_date).slice(0,10),bonusDates=await bonusModule.tradingDates(bonusTarget);
  for(let i=0;i<resultRows.length;i+=40){const group=resultRows.slice(i,i+40);const q=new URLSearchParams({select:'symbol,trade_date,volume_lots,volume_shares',symbol:'in.('+group.map(r=>r.code).join(',')+')',order:'trade_date.asc,symbol.asc',limit:'1000'});q.append('trade_date','gte.'+bonusDates[0]);q.append('trade_date','lte.'+bonusTarget);const response=await supabase('/rest/v1/stock_daily_volume?'+q);if(!Array.isArray(response.json)||response.json.length>=1000)throw Error('recent_volume_readback_incomplete');for(const r of group){const actual=bonusModule.calculate(response.json.filter(d=>d.symbol===r.code),bonusDates,bonusTarget);if(!require('node:util').isDeepStrictEqual(actual,r.payload?.recentVolumeBonus))v3Issues.push('recent_volume_authoritative_mismatch:'+r.code);}}
  const expectedTotal = Number(row.expected_total || 0);
  const scannedCount = Number(row.scanned_count || 0);
  const qualityStatus = String(row.quality_status || "");
  const noDataCount = Number(row.no_data_count || 0);
  const dataGapCount = Number(row.payload?.dataGapCount ?? noDataCount);
  const dataGapCodes = collectDataGapCodes(row.payload || {});
  let displayedDataGapCodes = [];
  if (dataGapCodes.length) {
    const gapFilter = `in.(${dataGapCodes.join(",")})`;
    const gapRows = await supabase(`/rest/v1/${RESULTS_TABLE}?${query({ select: "code", run_id: `eq.${row.run_id}`, code: gapFilter })}`);
    displayedDataGapCodes = [...new Set((Array.isArray(gapRows.json) ? gapRows.json : []).map((item) => normalizeCode(item?.code)).filter((code) => /^\d{4}$/.test(code)))].sort();
  }
  const errorCount = Number(row.error_count || 0);
  const coverage = summarizeCoverage(row.payload?.supabaseCoverage || row.payload?.selfTest?.sourceHealth?.supabaseCoverage || null);
  const coverageAccepted = coverage && Number(coverage.coverageRatio || 0) >= MIN_ACCEPTED_COVERAGE_RATIO
    && (Number(coverage.remainingMiss || 0) === 0 || Number(coverage.remainingMiss || 0) === dataGapCount);
  const qualityAccepted = qualityStatus === "complete" || (qualityStatus === "degraded" && coverageAccepted);
  const dataGapCodesComplete = dataGapCount === 0 || dataGapCodes.length === dataGapCount;
  const dataGapsExcluded = displayedDataGapCodes.length === 0;
  const ok = v3Issues.length === 0 && row.complete === true && qualityAccepted && expectedTotal > 0 && scannedCount === expectedTotal && resultCount > 0 && readbackCount === resultCount && errorCount === 0 && dataGapCodesComplete && dataGapsExcluded;
  console.log(JSON.stringify({ ok, resultContract: row.payload?.resultContract, v3Issues, runId: row.run_id, updatedAt: row.updated_at || row.finished_at || "", expectedTotal, scannedCount, resultCount, readbackCount, qualityStatus, qualityAccepted, complete: row.complete === true, noDataCount, dataGapCount, dataGapCodes, dataGapCodesComplete, dataGapsExcluded, displayedDataGapCodes, errorCount, sourceSnapshotCapturedAt: row.payload?.source_snapshot_captured_at || row.payload?.generatedAt || row.generated_at || "", supabaseCoverage: coverage }, null, 2));
  if (!ok) process.exitCode = 1;
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message }, null, 2)); process.exit(1); });
