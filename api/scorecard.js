const fs = require("fs");
const { buildMarketCalendarContract, attachMarketCalendar } = require("../lib/market-calendar-contract");
const path = require("path");
const { readSnapshot } = require("../lib/supabase-snapshots");
const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");

const SNAPSHOT_KEY = process.env.FUMAN_SCORECARD_SNAPSHOT_KEY || "scorecard_latest";
const SNAPSHOT_FILE = path.join(process.cwd(), "data", "scorecard-latest.json");
const SCORECARD_CONTRACT = "scorecard-resource-chain-v1";
const FORMAL_STRATEGY_ENDPOINTS = {
  "策略1開盤入成績單": "/api/open-buy-latest?live=1",
  "策略2成績單": "/api/strategy2-latest?live=1",
  "策略3隔日沖成績單": "/api/strategy3-latest?live=1",
  "策略4成績單": "/api/strategy4-latest?live=1",
  "策略5成績單": "/api/strategy5-latest?live=1",
  "買賣超成績單": "/api/institution-latest?live=1",
  "權證成績單": "/api/warrant-flow-latest?live=1",
  "CB成績單": "/api/cb-detect-latest?live=1",
};
const AUDIT_SURFACES = [
  ["strategy1", "Strategy1 open-buy", "/api/open-buy-latest?live=1"],
  ["strategy2", "Strategy2 daytrade", "/api/strategy2-latest?live=1"],
  ["strategy3", "Strategy3", "/api/strategy3-latest?live=1"],
  ["strategy4", "Strategy4", "/api/strategy4-latest?live=1"],
  ["strategy5", "Strategy5", "/api/strategy5-latest?live=1"],
  ["institution", "Institution / 買賣超", "/api/institution-latest?live=1"],
  ["cb", "CB", "/api/cb-detect-latest?live=1"],
  ["warrant", "Warrant / 權證", "/api/warrant-flow-latest?live=1"],
  ["market-ai", "Market AI", "/api/market-ai-live"],
  ["mobile-terminal", "Mobile terminal / 手機終端", "/mobile.html"],
  ["desktop-terminal", "Desktop terminal / 電腦終端", "/"],
  ["shared-source", "Shared source / Supabase source gate", "supabase:scorecard_latest"],
  ["schedule-registry", "Schedule registry", "Windows Task:Fuman Scorecard Daily Automation 1400"],
  ["deploy-hygiene", "Deploy hygiene", "/api/release-manifest"],
];
function isRetiredScorecardSurfaceName(value) {
  return /即時雷達|熱力圖|realtime-radar|heatmap/i.test(cleanText(value));
}

function sanitizeScorecardSourceQuery(sourceQuery = {}) {
  if (!sourceQuery || typeof sourceQuery !== "object") return sourceQuery;
  const latestDateCandidates = Array.isArray(sourceQuery.latestDateCandidates)
    ? sourceQuery.latestDateCandidates.map((candidate) => {
      const byStrategy = Object.fromEntries(Object.entries(candidate.byStrategy || {})
        .filter(([strategy]) => !isRetiredScorecardSurfaceName(strategy)));
      const missingStrategies = Array.isArray(candidate.missingStrategies)
        ? candidate.missingStrategies.filter((strategy) => !isRetiredScorecardSurfaceName(strategy))
        : candidate.missingStrategies;
      return {
        ...candidate,
        byStrategy,
        missingStrategies,
        strategies: Object.keys(byStrategy).length || candidate.strategies || 0,
      };
    })
    : sourceQuery.latestDateCandidates;
  return { ...sourceQuery, latestDateCandidates };
}
const SCORECARD_REQUIRED_FIELDS = [
  "record_date",
  "strategy",
  "ticker",
  "name",
  "entry_time",
  "entry_price",
  "high_price",
  "pnl",
  "reason",
];

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function reportStatusFromBool(ok) {
  return ok ? "complete" : "insufficient";
}

async function fetchSupabaseRows(table, query, timeoutMs = 8000) {
  const url = serverSupabaseUrl();
  const key = serverSupabaseKey();
  if (!url || !key) throw new Error("missing_supabase_credentials");
  const response = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table}_read_failed:${response.status}:${text.slice(0, 180)}`);
  return text ? JSON.parse(text) : [];
}

function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  const text = String(value).trim();
  return !text || text === "--" || /^n\/a$/i.test(text) || /^null$/i.test(text) || /^undefined$/i.test(text);
}

function isoDate(value) {
  const text = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function compactDate(value) {
  return cleanText(value).replace(/\D/g, "").slice(0, 8);
}

function compactTimestamp(value) {
  return cleanText(value).replace(/\D/g, "").slice(0, 14);
}

function createCaptureResponse(resolve) {
  let settled = false;
  const done = (statusCode, payload) => {
    if (settled) return;
    settled = true;
    resolve({ statusCode, payload });
  };
  return {
    statusCode: 200,
    setHeader() {},
    status(code) {
      this.statusCode = Number(code) || 200;
      return this;
    },
    json(payload) {
      done(this.statusCode || 200, payload);
      return this;
    },
    send(payload) {
      done(this.statusCode || 200, payload);
      return this;
    },
    end(payload = "") {
      done(this.statusCode || 204, payload);
      return this;
    },
  };
}

function callStrategy3Latest(timeoutMs = 12000) {
  return new Promise((resolve) => {
    let timer = null;
    try {
      const handler = require("./strategy3-latest");
      const query = {
        canvas: "1",
        compact: "1",
        shell: "1",
        live: "1",
        limit: "60",
      };
      timer = setTimeout(() => resolve({
        statusCode: 504,
        payload: { ok: false, error: "strategy3_source_report_timeout" },
      }), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      Promise.resolve(handler({
        method: "GET",
        url: "/api/strategy3-latest?canvas=1&compact=1&shell=1&live=1&limit=60",
        headers: { host: "localhost", "x-scorecard-source": "1" },
        query,
        fumanInternalVerify: true,
      }, createCaptureResponse(finish))).catch((error) => {
        finish({
          statusCode: 500,
          payload: { ok: false, error: "strategy3_source_report_failed", reason: error?.message || String(error) },
        });
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "strategy3_source_report_failed", reason: error?.message || String(error) },
      });
    }
  });
}

function callStrategy1Latest(timeoutMs = 12000) {
  return new Promise((resolve) => {
    let timer = null;
    try {
      const handler = require("./open-buy-latest");
      const query = {
        canvas: "1",
        compact: "1",
        shell: "1",
        live: "1",
        limit: "70",
      };
      timer = setTimeout(() => resolve({
        statusCode: 504,
        payload: { ok: false, error: "strategy1_source_report_timeout" },
      }), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      Promise.resolve(handler({
        method: "GET",
        url: "/api/open-buy-latest?canvas=1&compact=1&shell=1&live=1&limit=70",
        headers: { host: "localhost", "x-scorecard-source": "1" },
        query,
        fumanInternalVerify: true,
      }, createCaptureResponse(finish))).catch((error) => {
        finish({
          statusCode: 500,
          payload: { ok: false, error: "strategy1_source_report_failed", reason: error?.message || String(error) },
        });
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "strategy1_source_report_failed", reason: error?.message || String(error) },
      });
    }
  });
}

function callStrategy2Latest(timeoutMs = 12000) {
  return new Promise((resolve) => {
    let timer = null;
    try {
      const handler = require("./strategy2-latest");
      const query = {
        canvas: "1",
        compact: "1",
        shell: "1",
        live: "1",
        today: "1",
        verify: "1",
        top: "1",
      };
      timer = setTimeout(() => resolve({
        statusCode: 504,
        payload: { ok: false, error: "strategy2_source_report_timeout" },
      }), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      Promise.resolve(handler({
        method: "GET",
        url: "/api/strategy2-latest?canvas=1&compact=1&shell=1&live=1&today=1&verify=1&top=1",
        headers: { host: "localhost", "x-scorecard-source": "1" },
        query,
        fumanInternalVerify: true,
      }, createCaptureResponse(finish))).catch((error) => {
        finish({
          statusCode: 500,
          payload: { ok: false, error: "strategy2_source_report_failed", reason: error?.message || String(error) },
        });
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "strategy2_source_report_failed", reason: error?.message || String(error) },
      });
    }
  });
}

function callStrategy4Latest(timeoutMs = 12000) {
  return new Promise((resolve) => {
    let timer = null;
    try {
      const handler = require("./strategy4-latest");
      const query = {
        canvas: "1",
        compact: "1",
        shell: "1",
        live: "1",
        limit: "70",
      };
      timer = setTimeout(() => resolve({
        statusCode: 504,
        payload: { ok: false, error: "strategy4_source_report_timeout" },
      }), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      Promise.resolve(handler({
        method: "GET",
        url: "/api/strategy4-latest?canvas=1&compact=1&shell=1&live=1&limit=70",
        headers: { host: "localhost", "x-scorecard-source": "1" },
        query,
        fumanInternalVerify: true,
      }, createCaptureResponse(finish))).catch((error) => {
        finish({
          statusCode: 500,
          payload: { ok: false, error: "strategy4_source_report_failed", reason: error?.message || String(error) },
        });
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "strategy4_source_report_failed", reason: error?.message || String(error) },
      });
    }
  });
}

function callCbDetectLatest(timeoutMs = 12000) {
  return new Promise((resolve) => {
    let timer = null;
    try {
      const handler = require("./cb-detect-latest");
      const query = {
        canvas: "1",
        compact: "1",
        shell: "1",
        live: "1",
        limit: "60",
      };
      timer = setTimeout(() => resolve({
        statusCode: 504,
        payload: { ok: false, error: "cb_source_report_timeout" },
      }), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      Promise.resolve(handler({
        method: "GET",
        url: "/api/cb-detect-latest?canvas=1&compact=1&shell=1&live=1&limit=60",
        headers: { host: "localhost", "x-scorecard-source": "1" },
        query,
        fumanInternalVerify: true,
      }, createCaptureResponse(finish))).catch((error) => {
        finish({
          statusCode: 500,
          payload: { ok: false, error: "cb_source_report_failed", reason: error?.message || String(error) },
        });
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "cb_source_report_failed", reason: error?.message || String(error) },
      });
    }
  });
}

function callWarrantLatest(timeoutMs = 12000) {
  return new Promise((resolve) => {
    let timer = null;
    try {
      const handler = require("./warrant-flow-latest");
      const query = {
        canvas: "1",
        compact: "1",
        shell: "1",
        live: "1",
        limit: "500",
      };
      timer = setTimeout(() => resolve({
        statusCode: 504,
        payload: { ok: false, error: "warrant_source_report_timeout" },
      }), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      Promise.resolve(handler({
        method: "GET",
        url: "/api/warrant-flow-latest?canvas=1&compact=1&shell=1&live=1&limit=500",
        headers: { host: "localhost", "x-scorecard-source": "1" },
        query,
        fumanInternalVerify: true,
      }, createCaptureResponse(finish))).catch((error) => {
        finish({
          statusCode: 500,
          payload: { ok: false, error: "warrant_source_report_failed", reason: error?.message || String(error) },
        });
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "warrant_source_report_failed", reason: error?.message || String(error) },
      });
    }
  });
}
function callStrategy5Latest(timeoutMs = 12000) {
  return new Promise((resolve) => {
    let timer = null;
    try {
      const handler = require("./strategy5-latest");
      const query = {
        canvas: "1",
        compact: "1",
        shell: "1",
        live: "1",
        limit: "70",
      };
      timer = setTimeout(() => resolve({
        statusCode: 504,
        payload: { ok: false, error: "strategy5_source_report_timeout" },
      }), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      Promise.resolve(handler({
        method: "GET",
        url: "/api/strategy5-latest?canvas=1&compact=1&shell=1&live=1&limit=70",
        headers: { host: "localhost", "x-scorecard-source": "1" },
        query,
        fumanInternalVerify: true,
      }, createCaptureResponse(finish))).catch((error) => {
        finish({
          statusCode: 500,
          payload: { ok: false, error: "strategy5_source_report_failed", reason: error?.message || String(error) },
        });
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "strategy5_source_report_failed", reason: error?.message || String(error) },
      });
    }
  });
}

function callInstitutionLatest(timeoutMs = 12000) {
  return new Promise((resolve) => {
    let timer = null;
    try {
      const handler = require("./institution-latest");
      const query = {
        canvas: "1",
        compact: "1",
        shell: "1",
        live: "1",
        limit: "1200",
      };
      timer = setTimeout(() => resolve({
        statusCode: 504,
        payload: { ok: false, error: "institution_source_report_timeout" },
      }), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      Promise.resolve(handler({
        method: "GET",
        url: "/api/institution-latest?canvas=1&compact=1&shell=1&live=1&limit=1200",
        headers: { host: "localhost", "x-scorecard-source": "1" },
        query,
        fumanInternalVerify: true,
      }, createCaptureResponse(finish))).catch((error) => {
        finish({
          statusCode: 500,
          payload: { ok: false, error: "institution_source_report_failed", reason: error?.message || String(error) },
        });
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "institution_source_report_failed", reason: error?.message || String(error) },
      });
    }
  });
}

function callSevenStrategyDailyHistory(timeoutMs = 12000) {
  return new Promise((resolve) => {
    let timer = null;
    try {
      const handler = require("./seven-strategy-daily-history");
      timer = setTimeout(() => resolve({
        statusCode: 504,
        payload: { ok: false, error: "seven_strategy_daily_history_timeout" },
      }), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      Promise.resolve(handler({
        method: "GET",
        url: "/api/seven-strategy-daily-history?limit=100",
        headers: { host: "localhost", "x-scorecard-source": "1" },
        query: { limit: "100" },
      }, createCaptureResponse(finish))).catch((error) => {
        finish({
          statusCode: 500,
          payload: { ok: false, error: "seven_strategy_daily_history_failed", reason: error?.message || String(error) },
        });
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "seven_strategy_daily_history_failed", reason: error?.message || String(error) },
      });
    }
  });
}

function callDaytradeEntryHistory(timeoutMs = 12000) {
  return new Promise((resolve) => {
    let timer = null;
    try {
      const handler = require("./daytrade-entry-history");
      timer = setTimeout(() => resolve({
        statusCode: 504,
        payload: { ok: false, error: "daytrade_entry_history_timeout" },
      }), timeoutMs);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      Promise.resolve(handler({
        method: "GET",
        url: "/api/daytrade-entry-history?limit=300",
        headers: { host: "localhost", "x-scorecard-source": "1" },
        query: { limit: "300" },
      }, createCaptureResponse(finish))).catch((error) => {
        finish({
          statusCode: 500,
          payload: { ok: false, error: "daytrade_entry_history_failed", reason: error?.message || String(error) },
        });
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      resolve({
        statusCode: 500,
        payload: { ok: false, error: "daytrade_entry_history_failed", reason: error?.message || String(error) },
      });
    }
  });
}

function buildStrategy5SourceReport(result) {
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const quality = payload.run_quality_at_publish && typeof payload.run_quality_at_publish === "object"
    ? payload.run_quality_at_publish
    : {};
  return {
    key: "strategy5",
    strategy: "策略5成績單",
    endpoint: "/api/strategy5-latest",
    statusCode: Number(result?.statusCode || 0) || 0,
    ok: payload.ok !== false && Number(result?.statusCode || 0) < 400,
    runId: cleanText(payload.runId || payload.transport?.runId),
    count: cleanNumber(payload.count ?? payload.resultCount ?? payload.total),
    emittedRows: Array.isArray(payload.rows) ? payload.rows.length : Array.isArray(payload.matches) ? payload.matches.length : 0,
    resultCount: cleanNumber(payload.resultCount ?? quality.resultCount),
    readbackCount: cleanNumber(payload.readbackCount ?? quality.readbackCount),
    expectedTotal: cleanNumber(payload.expectedTotal ?? quality.expectedTotal),
    scannedCount: cleanNumber(payload.scannedCount ?? quality.scannedCount),
    date: cleanText(payload.usedDate || payload.tradeDate || payload.sourceDate || payload.date),
    sourceSnapshotCapturedAt: cleanText(payload.source_snapshot_captured_at),
    evidenceStatus: cleanText(payload.evidenceStatus || payload.unattended?.evidenceStatus || quality.evidenceStatus),
    unattendedStatus: cleanText(payload.unattendedStatus || payload.unattended?.status || quality.unattendedStatus),
    publishAllowed: payload.publishAllowed === true || quality.publishAllowed === true,
    latestOverwriteAllowed: payload.latestOverwriteAllowed === true || quality.latestOverwriteAllowed === true,
    preservePreviousGood: payload.preservePreviousGood === true || quality.preservePreviousGood === true,
    fallbackUsed: payload.fallbackUsed === true || quality.fallbackUsed === true,
    blockedReason: cleanText(payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
    reason: cleanText(payload.reason || payload.detail || payload.error || payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
  };
}

function buildStrategy1SourceReport(result) {
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const quality = payload.run_quality_at_publish && typeof payload.run_quality_at_publish === "object"
    ? payload.run_quality_at_publish
    : {};
  return {
    key: "strategy1",
    strategy: "策略1開盤入成績單",
    endpoint: "/api/open-buy-latest",
    statusCode: Number(result?.statusCode || 0) || 0,
    ok: payload.ok !== false && Number(result?.statusCode || 0) < 400,
    runId: cleanText(payload.runId || payload.transport?.runId),
    count: cleanNumber(payload.count ?? payload.resultCount ?? payload.total),
    emittedRows: Array.isArray(payload.rows) ? payload.rows.length : Array.isArray(payload.matches) ? payload.matches.length : 0,
    resultCount: cleanNumber(payload.resultCount ?? quality.resultCount),
    readbackCount: cleanNumber(payload.readbackCount ?? quality.readbackCount),
    expectedTotal: cleanNumber(payload.expectedTotal ?? quality.expectedTotal),
    scannedCount: cleanNumber(payload.scannedCount ?? quality.scannedCount),
    date: cleanText(payload.usedDate || payload.tradeDate || payload.sourceDate || payload.date),
    sourceSnapshotCapturedAt: cleanText(payload.source_snapshot_captured_at),
    evidenceStatus: cleanText(payload.evidenceStatus || payload.unattended?.evidenceStatus || quality.evidenceStatus),
    unattendedStatus: cleanText(payload.unattendedStatus || payload.unattended?.status || quality.unattendedStatus),
    publishAllowed: payload.publishAllowed === true || quality.publishAllowed === true,
    latestOverwriteAllowed: payload.latestOverwriteAllowed === true || quality.latestOverwriteAllowed === true,
    preservePreviousGood: payload.preservePreviousGood === true || quality.preservePreviousGood === true,
    fallbackUsed: payload.fallbackUsed === true || quality.fallbackUsed === true,
    blockedReason: cleanText(payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
    reason: cleanText(payload.reason || payload.detail || payload.error || payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
  };
}

function buildStrategy4SourceReport(result) {
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const quality = payload.run_quality_at_publish && typeof payload.run_quality_at_publish === "object"
    ? payload.run_quality_at_publish
    : {};
  return {
    key: "strategy4",
    strategy: "策略4成績單",
    endpoint: "/api/strategy4-latest",
    statusCode: Number(result?.statusCode || 0) || 0,
    ok: payload.ok !== false && Number(result?.statusCode || 0) < 400,
    runId: cleanText(payload.runId || payload.transport?.runId),
    count: cleanNumber(payload.count ?? payload.resultCount ?? payload.total),
    emittedRows: Array.isArray(payload.rows) ? payload.rows.length : Array.isArray(payload.matches) ? payload.matches.length : 0,
    resultCount: cleanNumber(payload.resultCount ?? quality.resultCount),
    readbackCount: cleanNumber(payload.readbackCount ?? quality.readbackCount),
    expectedTotal: cleanNumber(payload.expectedTotal ?? quality.expectedTotal),
    scannedCount: cleanNumber(payload.scannedCount ?? quality.scannedCount),
    date: cleanText(payload.usedDate || payload.tradeDate || payload.sourceDate || payload.date),
    sourceSnapshotCapturedAt: cleanText(payload.source_snapshot_captured_at),
    evidenceStatus: cleanText(payload.evidenceStatus || payload.unattended?.evidenceStatus || quality.evidenceStatus),
    unattendedStatus: cleanText(payload.unattendedStatus || payload.unattended?.status || quality.unattendedStatus),
    publishAllowed: payload.publishAllowed === true || quality.publishAllowed === true,
    latestOverwriteAllowed: payload.latestOverwriteAllowed === true || quality.latestOverwriteAllowed === true,
    preservePreviousGood: payload.preservePreviousGood === true || quality.preservePreviousGood === true,
    fallbackUsed: payload.fallbackUsed === true || quality.fallbackUsed === true,
    blockedReason: cleanText(payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
    reason: cleanText(payload.reason || payload.detail || payload.error || payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
  };
}

function buildInstitutionSourceReport(result) {
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const quality = payload.run_quality_at_publish && typeof payload.run_quality_at_publish === "object"
    ? payload.run_quality_at_publish
    : {};
  return {
    key: "institution",
    strategy: "買賣超成績單",
    endpoint: "/api/institution-latest",
    statusCode: Number(result?.statusCode || 0) || 0,
    ok: payload.ok !== false && Number(result?.statusCode || 0) < 400,
    runId: cleanText(payload.runId || payload.transport?.runId),
    count: cleanNumber(payload.count ?? payload.resultCount ?? payload.total),
    emittedRows: Array.isArray(payload.rows) ? payload.rows.length : Array.isArray(payload.matches) ? payload.matches.length : 0,
    resultCount: cleanNumber(payload.resultCount ?? quality.resultCount),
    readbackCount: cleanNumber(payload.readbackCount ?? quality.readbackCount),
    expectedTotal: cleanNumber(payload.expectedTotal ?? quality.expectedTotal),
    scannedCount: cleanNumber(payload.scannedCount ?? quality.scannedCount),
    date: cleanText(payload.usedDate || payload.tradeDate || payload.sourceDate || payload.date),
    sourceSnapshotCapturedAt: cleanText(payload.source_snapshot_captured_at),
    evidenceStatus: cleanText(payload.evidenceStatus || payload.unattended?.evidenceStatus || quality.evidenceStatus),
    unattendedStatus: cleanText(payload.unattendedStatus || payload.unattended?.status || quality.unattendedStatus),
    publishAllowed: payload.publishAllowed === true || quality.publishAllowed === true,
    latestOverwriteAllowed: payload.latestOverwriteAllowed === true || quality.latestOverwriteAllowed === true,
    preservePreviousGood: payload.preservePreviousGood === true || quality.preservePreviousGood === true,
    fallbackUsed: payload.fallbackUsed === true || quality.fallbackUsed === true,
    blockedReason: cleanText(payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
    reason: cleanText(payload.reason || payload.detail || payload.error || payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
  };
}

function buildStrategy2SourceReport(result) {
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const quality = payload.run_quality_at_publish && typeof payload.run_quality_at_publish === "object"
    ? payload.run_quality_at_publish
    : {};
  return {
    key: "strategy2",
    strategy: "策略2當沖成績單",
    endpoint: "/api/strategy2-latest",
    statusCode: Number(result?.statusCode || 0) || 0,
    ok: payload.ok !== false && Number(result?.statusCode || 0) < 400,
    runId: cleanText(payload.runId || payload.transport?.runId),
    count: cleanNumber(payload.count ?? payload.resultCount ?? payload.total),
    emittedRows: Array.isArray(payload.rows) ? payload.rows.length : Array.isArray(payload.matches) ? payload.matches.length : 0,
    date: cleanText(payload.usedDate || payload.tradeDate || payload.sourceDate || payload.date),
    evidenceStatus: cleanText(payload.evidenceStatus || payload.unattended?.evidenceStatus || quality.evidenceStatus),
    unattendedStatus: cleanText(payload.unattendedStatus || payload.unattended?.status || quality.unattendedStatus),
    publishAllowed: payload.publishAllowed === true || quality.publishAllowed === true,
    latestOverwriteAllowed: payload.latestOverwriteAllowed === true || quality.latestOverwriteAllowed === true,
    preservePreviousGood: payload.preservePreviousGood === true || quality.preservePreviousGood === true,
    fallbackUsed: payload.fallbackUsed === true || quality.fallbackUsed === true,
    blockedReason: cleanText(payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
    reason: cleanText(payload.reason || payload.detail || payload.error || payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
  };
}

function buildStrategy3SourceReport(result) {
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const quality = payload.run_quality_at_publish && typeof payload.run_quality_at_publish === "object"
    ? payload.run_quality_at_publish
    : {};
  return {
    key: "strategy3",
    strategy: "策略3隔日沖成績單",
    endpoint: "/api/strategy3-latest",
    statusCode: Number(result?.statusCode || 0) || 0,
    ok: payload.ok !== false && Number(result?.statusCode || 0) < 400,
    runId: cleanText(payload.runId || payload.transport?.runId),
    count: cleanNumber(payload.count ?? payload.resultCount ?? payload.total),
    emittedRows: Array.isArray(payload.rows) ? payload.rows.length : Array.isArray(payload.matches) ? payload.matches.length : 0,
    date: cleanText(payload.usedDate || payload.tradeDate || payload.sourceDate || payload.date),
    evidenceStatus: cleanText(payload.evidenceStatus || quality.evidenceStatus),
    unattendedStatus: cleanText(payload.unattendedStatus || quality.unattendedStatus),
    publishAllowed: payload.publishAllowed === true || quality.publishAllowed === true,
    latestOverwriteAllowed: payload.latestOverwriteAllowed === true || quality.latestOverwriteAllowed === true,
    preservePreviousGood: payload.preservePreviousGood === true || quality.preservePreviousGood === true,
    blockedReason: cleanText(payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
    reason: cleanText(payload.reason || payload.detail || payload.error || payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
  };
}

function buildCbSourceReport(result) {
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const quality = payload.run_quality_at_publish && typeof payload.run_quality_at_publish === "object"
    ? payload.run_quality_at_publish
    : {};
  return {
    key: "cb",
    strategy: "CB成績單",
    endpoint: "/api/cb-detect-latest",
    statusCode: Number(result?.statusCode || 0) || 0,
    ok: payload.ok !== false && Number(result?.statusCode || 0) < 400,
    runId: cleanText(payload.runId || payload.transport?.runId),
    count: cleanNumber(payload.count ?? payload.resultCount ?? payload.total),
    emittedRows: Array.isArray(payload.rows) ? payload.rows.length : Array.isArray(payload.matches) ? payload.matches.length : 0,
    date: cleanText(payload.usedDate || payload.tradeDate || payload.sourceDate || payload.date),
    evidenceStatus: cleanText(payload.evidenceStatus || quality.evidenceStatus),
    unattendedStatus: cleanText(payload.unattendedStatus || quality.unattendedStatus),
    publishAllowed: payload.publishAllowed === true || quality.publishAllowed === true,
    latestOverwriteAllowed: payload.latestOverwriteAllowed === true || quality.latestOverwriteAllowed === true,
    preservePreviousGood: payload.preservePreviousGood === true || quality.preservePreviousGood === true,
    fallbackUsed: payload.fallbackUsed === true || quality.fallbackUsed === true,
    blockedReason: cleanText(payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
    reason: cleanText(payload.reason || payload.detail || payload.error || payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
  };
}

function buildWarrantSourceReport(result) {
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const quality = payload.run_quality_at_publish && typeof payload.run_quality_at_publish === "object"
    ? payload.run_quality_at_publish
    : {};
  return {
    key: "warrant",
    strategy: "權證成績單",
    endpoint: "/api/warrant-flow-latest",
    statusCode: Number(result?.statusCode || 0) || 0,
    ok: payload.ok !== false && Number(result?.statusCode || 0) < 400,
    runId: cleanText(payload.runId || payload.transport?.runId),
    count: cleanNumber(payload.count ?? payload.resultCount ?? quality.resultCount ?? payload.total),
    emittedRows: Array.isArray(payload.rows) ? payload.rows.length : Array.isArray(payload.matches) ? payload.matches.length : 0,
    resultCount: cleanNumber(payload.resultCount ?? quality.resultCount),
    readbackCount: cleanNumber(payload.readbackCount ?? quality.readbackCount),
    date: cleanText(payload.usedDate || payload.tradeDate || payload.sourceDate || payload.date),
    evidenceStatus: cleanText(payload.evidenceStatus || quality.evidenceStatus),
    unattendedStatus: cleanText(payload.unattendedStatus || quality.unattendedStatus),
    publishAllowed: payload.publishAllowed === true || quality.publishAllowed === true,
    latestOverwriteAllowed: payload.latestOverwriteAllowed === true || quality.latestOverwriteAllowed === true,
    preservePreviousGood: payload.preservePreviousGood === true || quality.preservePreviousGood === true,
    fallbackUsed: payload.fallbackUsed === true || quality.fallbackUsed === true,
    blockedReason: cleanText(payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
    reason: cleanText(payload.reason || payload.detail || payload.error || payload.blockedReason || payload.scanner_block_reason || quality.blockedReason),
  };
}
function buildSevenStrategyDailyHistorySourceReport(result) {
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  return {
    key: "seven_strategy_daily_history",
    strategy: "七策略每日紀錄",
    endpoint: "/api/seven-strategy-daily-history",
    statusCode: Number(result?.statusCode || 0) || 0,
    ok: payload.ok !== false && Number(result?.statusCode || 0) < 400,
    runId: cleanText(payload.runId || `seven-strategy-daily-history-${payload.tradeDate || "unknown"}`),
    count: cleanNumber(payload.count ?? payload.totalKept ?? 0),
    emittedRows: Array.isArray(payload.rows) ? payload.rows.length : 0,
    date: cleanText(payload.tradeDate),
    sourceName: cleanText(payload.sourceName || "seven_strategy_daily_history"),
    source: cleanText(payload.source || "supabase:public.seven_strategy_daily_history"),
    table: cleanText(payload.table || "public.seven_strategy_daily_history"),
    timeWindow: payload.timeWindow || { from: "09:00:00", to: "13:30:00", timezone: "Asia/Taipei" },
    formalCount: cleanNumber(payload.formalCount),
    detectedCount: cleanNumber(payload.detectedCount),
    strategyDistribution: payload.strategyDistribution || {},
    evidenceStatus: payload.ok === false ? "insufficient" : "complete",
    unattendedStatus: payload.ok === false ? "NO" : "YES",
    publishAllowed: payload.ok !== false,
    latestOverwriteAllowed: payload.ok !== false,
    preservePreviousGood: payload.ok === false,
    fallbackUsed: false,
    blockedReason: payload.ok === false ? cleanText(payload.reason || payload.error || "seven_strategy_daily_history_unavailable") : "",
    reason: cleanText(payload.reason || payload.error || ""),
  };
}

function buildDaytradeEntryHistorySourceReport(result) {
  const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const firstRunId = cleanText(rows.find((row) => cleanText(row?.run_id))?.run_id);
  const runDate = cleanText(payload.tradeDate || payload.requestedDate || "unknown");
  return {
    key: "daytrade_entry_history",
    strategy: "當沖 PS1 今日進場紀錄",
    endpoint: "/api/daytrade-entry-history",
    statusCode: Number(result?.statusCode || 0) || 0,
    ok: payload.ok !== false && Number(result?.statusCode || 0) < 400,
    runId: firstRunId || cleanText(payload.runId || `daytrade-entry-history-${runDate}`),
    count: cleanNumber(payload.count ?? rows.length),
    emittedRows: rows.length,
    resultCount: cleanNumber(payload.count ?? rows.length),
    readbackCount: cleanNumber(payload.count ?? rows.length),
    date: cleanText(payload.tradeDate),
    requestedDate: cleanText(payload.requestedDate),
    displayTradeDate: cleanText(payload.displayTradeDate),
    sourceName: "daytrade_entry_history",
    source: cleanText(payload.source || "supabase:public.fugle_daytrade_entry_history"),
    table: cleanText(payload.table || "public.fugle_daytrade_entry_history"),
    timeWindow: payload.timeWindow || { from: "09:00:00", to: "13:30:00", timezone: "Asia/Taipei" },
    formalCount: cleanNumber(payload.count ?? rows.length),
    detectedCount: 0,
    marketOpen: payload.marketOpen,
    marketStatus: cleanText(payload.marketStatus),
    closedReason: cleanText(payload.closedReason),
    marketClosedPreviousGood: payload.marketClosedPreviousGood === true,
    evidenceStatus: payload.ok === false ? "insufficient" : "complete",
    unattendedStatus: payload.ok === false ? "NO" : "YES",
    publishAllowed: payload.ok !== false,
    latestOverwriteAllowed: payload.ok !== false,
    preservePreviousGood: payload.marketClosedPreviousGood === true || payload.ok === false,
    fallbackUsed: false,
    blockedReason: payload.ok === false ? cleanText(payload.reason || payload.error || "daytrade_entry_history_unavailable") : "",
    reason: cleanText(payload.reason || payload.error || ""),
  };
}

async function buildDaytradeSourceReport() {
  try {
    const rows = await fetchSupabaseRows(
      "source_status",
      [
        "select=source_name,status,message,updated_at,payload",
        "source_name=eq.fugle_daytrade_source",
        "limit=1",
      ].join("&"),
      8000,
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    const offSession = payload.off_session === true || cleanText(payload.phase) === "after_daytrade_window";
    const gate = cleanText(payload.daytrade_gate_grade || payload.priority_gate_grade || "D").toUpperCase();
    const formalAllowed = payload.formal_entry_allowed === true;
    const motherPoolSymbols = cleanNumber(payload.mother_pool_symbols);
    const priorityPoolSymbols = cleanNumber(payload.priority_pool_symbols);
    const groupRows = cleanNumber(payload.stock_group_contract_rows);
    const futureRows = cleanNumber(payload.stock_future_initial_0846_rows);
    const ruleHits = payload.mother_pool_rule_hit_counts && typeof payload.mother_pool_rule_hit_counts === "object"
      ? payload.mother_pool_rule_hit_counts
      : {};
    const sourceOk = Boolean(row)
      && motherPoolSymbols >= 180
      && priorityPoolSymbols >= 40
      && groupRows >= 1600
      && futureRows > 0;
    const displayOk = sourceOk && (offSession || formalAllowed || gate === "A");
    const reason = cleanText(row?.message)
      || (sourceOk ? "daytrade mother pool source ready for display" : "daytrade mother pool source incomplete");
    return {
      key: "daytrade_source",
      strategy: "當沖母池水源",
      endpoint: "source_status:fugle_daytrade_source",
      statusCode: row ? 200 : 404,
      ok: displayOk,
      runId: `daytrade-source-${compactDate(row?.updated_at || new Date().toISOString())}-${compactTimestamp(row?.updated_at || new Date().toISOString()).slice(8) || "latest"}`,
      count: motherPoolSymbols,
      emittedRows: motherPoolSymbols,
      resultCount: motherPoolSymbols,
      readbackCount: motherPoolSymbols,
      date: cleanText(row?.trade_date || payload.trade_date || payload.date || ""),
      sourceName: "fugle_daytrade_source",
      source: "supabase:source_status",
      table: "source_status",
      gateGrade: gate,
      phase: cleanText(payload.phase),
      offSession,
      formalEntryAllowed: formalAllowed,
      formalScope: cleanText(payload.formal_scope || "priority_top40"),
      motherPoolSymbols,
      priorityPoolSymbols,
      stockGroupContractSource: cleanText(payload.stock_group_contract_source),
      stockGroupContractRows: groupRows,
      stockFutureInitial0846Rows: futureRows,
      stockFutureInitial0846ReadyRows: cleanNumber(payload.stock_future_initial_0846_ready_rows),
      ruleHits: {
        strong_group_limit_up_leader: cleanNumber(ruleHits.strong_group_limit_up_leader),
        stock_future_initial_0846_observe: cleanNumber(ruleHits.stock_future_initial_0846_observe),
        margin_down_3_5d_price_strong: cleanNumber(ruleHits.margin_down_3_5d_price_strong),
        margin_short_both_up_3_5d_price_strong: cleanNumber(ruleHits.margin_short_both_up_3_5d_price_strong),
        daytrade_crowded_3_5d_watch: cleanNumber(ruleHits.daytrade_crowded_3_5d_watch),
      },
      evidenceStatus: reportStatusFromBool(displayOk),
      unattendedStatus: displayOk ? "YES" : "NO",
      publishAllowed: displayOk,
      latestOverwriteAllowed: displayOk,
      preservePreviousGood: !displayOk,
      fallbackUsed: false,
      blockedReason: displayOk ? "" : reason,
      reason,
    };
  } catch (error) {
    return {
      key: "daytrade_source",
      strategy: "當沖母池水源",
      endpoint: "source_status:fugle_daytrade_source",
      statusCode: 500,
      ok: false,
      runId: `daytrade-source-error-${compactTimestamp(new Date().toISOString())}`,
      count: 0,
      emittedRows: 0,
      evidenceStatus: "insufficient",
      unattendedStatus: "NO",
      publishAllowed: false,
      latestOverwriteAllowed: false,
      preservePreviousGood: true,
      fallbackUsed: false,
      blockedReason: error?.message || String(error),
      reason: error?.message || String(error),
    };
  }
}

function mergeSourceReport(payload, report) {
  const reports = Array.isArray(payload?.sourceReports) ? [...payload.sourceReports] : [];
  const index = reports.findIndex((item) => cleanText(item?.key).toLowerCase() === cleanText(report?.key).toLowerCase());
  if (index >= 0) reports[index] = { ...reports[index], ...report };
  else reports.push(report);
  return { ...payload, sourceReports: reports };
}

async function withLiveStrategy3SourceReport(payload) {
  const result = await callStrategy3Latest();
  return mergeSourceReport(payload, buildStrategy3SourceReport(result));
}

async function withLiveSourceReports(payload) {
  const [strategy1, strategy2, strategy3, strategy4, strategy5, institution, cb, warrant, sevenStrategyDailyHistory, daytradeEntryHistory, daytradeSource] = await Promise.all([
    callStrategy1Latest(),
    callStrategy2Latest(),
    callStrategy3Latest(),
    callStrategy4Latest(),
    callStrategy5Latest(),
    callInstitutionLatest(),
    callCbDetectLatest(),
    callWarrantLatest(),
    callSevenStrategyDailyHistory(),
    callDaytradeEntryHistory(),
    buildDaytradeSourceReport(),
  ]);
  return [
    buildStrategy1SourceReport(strategy1),
    buildStrategy2SourceReport(strategy2),
    buildStrategy3SourceReport(strategy3),
    buildStrategy4SourceReport(strategy4),
    buildStrategy5SourceReport(strategy5),
    buildInstitutionSourceReport(institution),
    buildCbSourceReport(cb),
    buildWarrantSourceReport(warrant),
    buildSevenStrategyDailyHistorySourceReport(sevenStrategyDailyHistory),
    buildDaytradeEntryHistorySourceReport(daytradeEntryHistory),
    daytradeSource,
  ].reduce((nextPayload, report) => mergeSourceReport(nextPayload, report), payload);
}

function withScorecardContract(payload, status, reason = "") {
  const latestDate = isoDate(payload?.latestDate || payload?.summary?.latestDate || "");
  const snapshotTradeDate = cleanText(payload?.snapshot?.tradeDate || "");
  const marketDate = latestDate || (snapshotTradeDate.length === 8
    ? `${snapshotTradeDate.slice(0, 4)}-${snapshotTradeDate.slice(4, 6)}-${snapshotTradeDate.slice(6, 8)}`
    : "");
  const runDate = compactDate(marketDate || snapshotTradeDate || payload?.updatedAt || "");
  const runStamp = compactTimestamp(payload?.updatedAt || payload?.snapshot?.updatedAt || "");
  return {
    ...payload,
    contract: cleanText(payload?.contract || SCORECARD_CONTRACT),
    qualityStatus: cleanText(payload?.qualityStatus || status),
    marketDate: cleanText(payload?.marketDate || marketDate || latestDate),
    runId: cleanText(payload?.runId || `scorecard-${runDate || "unknown"}-${runStamp || "snapshot"}`),
    fallbackReason: cleanText(payload?.fallbackReason || reason),
  };
}

function fieldCompleteness(row) {
  const blankCounts = {};
  const sampleMissingRows = [];
  for (const field of SCORECARD_REQUIRED_FIELDS) {
    const blank = isBlank(row?.[field]);
    blankCounts[field] = blank ? 1 : 0;
    if (blank) {
      sampleMissingRows.push({
        field,
        record_id: cleanText(row?.record_id || row?.id || ""),
        strategy: cleanText(row?.strategy || ""),
        ticker: cleanText(row?.ticker || ""),
      });
    }
  }
  return {
    requiredFields: [...SCORECARD_REQUIRED_FIELDS],
    blankCounts,
    sampleMissingRows,
    blankTotal: Object.values(blankCounts).reduce((sum, value) => sum + value, 0),
  };
}

function fallbackContract(payload, reason = "") {
  const fallbackUsed = payload?.cacheSource !== "supabase-snapshot" || Boolean(reason);
  return {
    fallbackUsed,
    fallbackAllowed: false,
    fallbackScope: fallbackUsed ? ["scorecard_snapshot"] : [],
    fallbackDetails: fallbackUsed ? [{
      source: cleanText(payload?.cacheSource || "unknown"),
      reason: cleanText(reason || payload?.fallbackReason || "fallback_used"),
      formalPublishAllowed: false,
    }] : [],
  };
}

function sourceSnapshot(payload, fallback) {
  const capturedAt = cleanText(
    payload?.source_snapshot_captured_at
    || payload?.snapshot?.updatedAt
    || payload?.updatedAt
  );
  return {
    source_snapshot_captured_at: capturedAt,
    source_status_at_run: payload?.source_status_at_run || {
      status: fallback.fallbackUsed ? "blocked" : "complete",
      source: cleanText(payload?.cacheSource || payload?.source || "scorecard"),
    },
    quote_coverage_at_run: payload?.quote_coverage_at_run || { status: "not_required", reason: "scorecard_rows_use_published_entry_high_prices" },
    intraday_1m_readiness_at_run: payload?.intraday_1m_readiness_at_run || { status: "not_required", reason: "scorecard_snapshot_readback" },
    ma_readiness_at_run: payload?.ma_readiness_at_run || { status: "not_required", reason: "scorecard_snapshot_readback" },
    preopen_futopt_daily_readiness_at_run: payload?.preopen_futopt_daily_readiness_at_run || { status: "not_required", reason: "scorecard_snapshot_readback" },
    run_quality_at_publish: payload?.run_quality_at_publish || {
      status: fallback.fallbackUsed ? "blocked" : "complete",
      publishAllowed: fallback.fallbackUsed !== true,
      reason: fallback.fallbackUsed ? "fallback_source_cannot_publish_yes" : "formal_scorecard_snapshot",
    },
    writeBudget: payload?.writeBudget || { status: "not_required", reason: "read_only_scorecard_api" },
    retentionOk: payload?.retentionOk ?? true,
  };
}

function decorateRecords(payload, reason = "") {
  const fallback = fallbackContract(payload, reason);
  const snapshot = sourceSnapshot(payload, fallback);
  const formal = payload?.ok !== false
    && cleanText(payload?.qualityStatus) === "complete"
    && cleanText(payload?.cacheSource) === "supabase-snapshot"
    && !fallback.fallbackUsed
    && !isBlank(snapshot.source_snapshot_captured_at);
  const records = Array.isArray(payload?.records) ? payload.records : [];
  return records.map((row) => {
    const fields = fieldCompleteness(row);
    const blockers = [];
    if (!formal) blockers.push(cleanText(reason || payload?.fallbackReason || "scorecard_source_not_formal"));
    if (fields.blankTotal > 0) blockers.push(`blank_fields_${fields.blankTotal}`);
    if (isBlank(snapshot.source_snapshot_captured_at)) blockers.push("source_snapshot_captured_at_missing");
    const evidenceStatus = blockers.length ? "insufficient" : "complete";
    const publishAllowed = blockers.length === 0;
    const strategyName = cleanText(row.strategy || "未分類");
    return {
      ...row,
      strategyName,
      endpoint: FORMAL_STRATEGY_ENDPOINTS[strategyName] || "/api/scorecard?live=1",
      runId: cleanText(payload.runId),
      tradeDate: cleanText(row.record_date || payload.marketDate || payload.latestDate),
      usedDate: cleanText(row.record_date || payload.latestDate),
      updatedAt: cleanText(payload.updatedAt || snapshot.source_snapshot_captured_at),
      unattendedStatus: publishAllowed ? "YES" : "NO",
      evidenceStatus,
      needsHumanWatch: !publishAllowed,
      blockers,
      warnings: [],
      fallbackUsed: fallback.fallbackUsed,
      fallbackAllowed: fallback.fallbackAllowed,
      fallbackScope: fallback.fallbackScope,
      fallbackDetails: fallback.fallbackDetails,
      publishAllowed,
      source_snapshot_captured_at: snapshot.source_snapshot_captured_at,
      source_status_at_run: snapshot.source_status_at_run,
      quote_coverage_at_run: snapshot.quote_coverage_at_run,
      intraday_1m_readiness_at_run: snapshot.intraday_1m_readiness_at_run,
      ma_readiness_at_run: snapshot.ma_readiness_at_run,
      preopen_futopt_daily_readiness_at_run: snapshot.preopen_futopt_daily_readiness_at_run,
      run_quality_at_publish: snapshot.run_quality_at_publish,
      writeBudget: snapshot.writeBudget,
      retentionOk: snapshot.retentionOk,
      requiredFields: fields.requiredFields,
      blankCounts: fields.blankCounts,
      sampleMissingRows: fields.sampleMissingRows,
    };
  });
}

function buildAuditSurfaces(payload, reason = "") {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const strategies = new Set(records.map((row) => cleanText(row.strategyName || row.strategy)).filter(Boolean));
  const formal = payload?.ok !== false
    && cleanText(payload?.qualityStatus) === "complete"
    && cleanText(payload?.cacheSource) === "supabase-snapshot"
    && records.length > 0;
  return AUDIT_SURFACES.map(([key, name, endpoint]) => {
    const isTradingSurface = Object.values(FORMAL_STRATEGY_ENDPOINTS).includes(endpoint);
    const covered = isTradingSurface
      ? [...strategies].some((strategy) => endpoint === FORMAL_STRATEGY_ENDPOINTS[strategy])
      : formal;
    const blockers = [];
    if (!formal) blockers.push(cleanText(reason || payload?.fallbackReason || "scorecard_source_not_formal"));
    if (!covered) blockers.push("surface_not_covered");
    return {
      key,
      strategyName: name,
      endpoint,
      runId: cleanText(payload?.runId),
      tradeDate: cleanText(payload?.marketDate || payload?.latestDate),
      usedDate: cleanText(payload?.latestDate),
      updatedAt: cleanText(payload?.updatedAt),
      unattendedStatus: blockers.length ? "NO" : "YES",
      evidenceStatus: blockers.length ? "insufficient" : "complete",
      needsHumanWatch: blockers.length > 0,
      blockers,
      warnings: [],
      fallbackUsed: payload?.cacheSource !== "supabase-snapshot",
      publishAllowed: blockers.length === 0,
      source_snapshot_captured_at: cleanText(payload?.source_snapshot_captured_at || payload?.snapshot?.updatedAt || payload?.updatedAt),
      requiredFields: ["surface", "endpoint", "runId", "source_snapshot_captured_at"],
      blankCounts: {
        surface: isBlank(name) ? 1 : 0,
        endpoint: isBlank(endpoint) ? 1 : 0,
        runId: isBlank(payload?.runId) ? 1 : 0,
        source_snapshot_captured_at: isBlank(payload?.source_snapshot_captured_at || payload?.snapshot?.updatedAt || payload?.updatedAt) ? 1 : 0,
      },
      sampleMissingRows: [],
    };
  });
}

function summarizeAudit(payload, reason = "") {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const surfaces = buildAuditSurfaces(payload, reason);
  const blockers = [
    ...records.flatMap((row) => Array.isArray(row.blockers) ? row.blockers.map((issue) => `${row.strategyName || row.strategy}: ${issue}`) : []),
    ...surfaces.flatMap((surface) => Array.isArray(surface.blockers) ? surface.blockers.map((issue) => `${surface.strategyName}: ${issue}`) : []),
  ];
  const warnings = [
    ...records.flatMap((row) => Array.isArray(row.warnings) ? row.warnings.map((warning) => `${row.strategyName || row.strategy}: ${warning}`) : []),
    ...surfaces.flatMap((surface) => Array.isArray(surface.warnings) ? surface.warnings.map((warning) => `${surface.strategyName}: ${warning}`) : []),
  ];
  return {
    ok: blockers.length === 0,
    unattendedStatus: blockers.length ? "NO" : "YES",
    needsHumanWatch: blockers.length > 0,
    blockers,
    warnings,
    strategyCount: new Set(records.map((row) => cleanText(row.strategyName || row.strategy)).filter(Boolean)).size,
    recordCount: records.length,
    surfaces,
  };
}

function blankCountTotal(row) {
  if (!row?.blankCounts || typeof row.blankCounts !== "object") return 0;
  return Object.values(row.blankCounts).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function validateScorecardPayload(payload) {
  const issues = [];
  const rows = Array.isArray(payload?.records) ? payload.records : [];
  if (payload?.ok !== true) issues.push("scorecard_ok_not_true");
  if (cleanText(payload?.qualityStatus) !== "complete") issues.push("quality_status_not_complete");
  if (cleanText(payload?.cacheSource) !== "supabase-snapshot") issues.push("cache_source_not_supabase_snapshot");
  if (!rows.length) issues.push("empty_rows");
  if (!Array.isArray(payload?.sources)) issues.push("top_level_sources_missing");
  if (!Array.isArray(payload?.issues)) issues.push("top_level_issues_missing");
  if (!Array.isArray(payload?.warnings)) issues.push("top_level_warnings_missing");
  rows.forEach((row, index) => {
    const prefix = `row_${index}`;
    const evidenceStatus = cleanText(row.evidenceStatus).toLowerCase();
    const blockers = Array.isArray(row.blockers) ? row.blockers : [];
    if (!evidenceStatus) issues.push(`${prefix}_missing_evidence_status`);
    else if (evidenceStatus !== "complete" && evidenceStatus !== "sufficient") issues.push(`${prefix}_evidence_status_insufficient`);
    if (isBlank(row.source_snapshot_captured_at)) issues.push(`${prefix}_missing_source_snapshot_captured_at`);
    if (row.fallbackUsed === true) issues.push(`${prefix}_fallback_used`);
    if (blankCountTotal(row) > 0) issues.push(`${prefix}_blank_required_field`);
    if (blockers.length > 0 && row.publishAllowed === true) issues.push(`${prefix}_blockers_publish_allowed_conflict`);
    if (blockers.length > 0 && isBlank(blockers[0])) issues.push(`${prefix}_missing_blocked_reason`);
    if (row.needsHumanWatch !== false && row.publishAllowed === true) issues.push(`${prefix}_human_watch_publish_allowed_conflict`);
    if (row.publishAllowed !== true) issues.push(`${prefix}_publish_allowed_false`);
    if (row.unattendedStatus !== "YES") issues.push(`${prefix}_unattended_status_not_yes`);
  });
  return {
    rawOk: issues.length === 0,
    issues,
  };
}

function historyDates(records) {
  return [...new Set((Array.isArray(records) ? records : [])
    .map((row) => cleanText(row.record_date))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))]
    .sort()
    .reverse();
}

function summarize(records, dailyRows, latestDate) {
  const rows = Array.isArray(records) ? records : [];
  const wins = rows.filter((row) => cleanNumber(row.pnl) > 0).length;
  const losses = rows.filter((row) => cleanNumber(row.pnl) < 0).length;
  const flats = rows.length - wins - losses;
  const totalPnl = rows.reduce((sum, row) => sum + cleanNumber(row.pnl), 0);
  const grouped = new Map();
  rows.forEach((row) => {
    const strategy = cleanText(row.strategy || "未分類") || "未分類";
    grouped.set(strategy, [...(grouped.get(strategy) || []), row]);
  });
  const byStrategy = [...grouped.entries()].map(([strategy, items]) => {
    const strategyWins = items.filter((row) => cleanNumber(row.pnl) > 0).length;
    const strategyLosses = items.filter((row) => cleanNumber(row.pnl) < 0).length;
    const strategyPnl = items.reduce((sum, row) => sum + cleanNumber(row.pnl), 0);
    return {
      strategy,
      rows: items.length,
      wins: strategyWins,
      losses: strategyLosses,
      flats: items.length - strategyWins - strategyLosses,
      winRate: items.length ? (strategyWins / items.length) * 100 : 0,
      pnl: strategyPnl,
    };
  }).sort((a, b) => b.pnl - a.pnl || b.rows - a.rows);
  return {
    latestDate,
    rows: rows.length,
    wins,
    losses,
    flats,
    winRate: rows.length ? (wins / rows.length) * 100 : 0,
    totalPnl,
    byStrategy,
    daily: Array.isArray(dailyRows) ? dailyRows : [],
  };
}

function blockedSourceReports(sourceReports) {
  return (Array.isArray(sourceReports) ? sourceReports : []).filter((report) => {
    const evidenceStatus = cleanText(report?.evidenceStatus).toLowerCase();
    return report?.ok === false
      || report?.publishAllowed === false
      || evidenceStatus === "insufficient"
      || evidenceStatus === "source_quality_fail";
  });
}

function selectPayloadDate(payload, requestedDate = "") {
  const allRecords = (Array.isArray(payload?.records) ? payload.records : []).filter((row) => !isRetiredScorecardSurfaceName(row?.strategy));
  const dates = historyDates(allRecords);
  const selectedDate = dates.includes(requestedDate) ? requestedDate : (isoDate(payload?.latestDate) || dates[0] || "");
  const selectedRecords = selectedDate ? allRecords.filter((row) => cleanText(row.record_date) === selectedDate) : allRecords;
  const allDaily = (Array.isArray(payload?.summary?.daily) ? payload.summary.daily : [])
    .filter((row) => !isRetiredScorecardSurfaceName(row?.strategy));
  const daily = selectedDate ? allDaily.filter((row) => cleanText(row.summary_date) === selectedDate) : allDaily;
  const sourceReports = (Array.isArray(payload?.sourceReports) ? payload.sourceReports : [])
    .filter((report) => !isRetiredScorecardSurfaceName(report?.key)
      && !isRetiredScorecardSurfaceName(report?.strategy)
      && !isRetiredScorecardSurfaceName(report?.endpoint)
      && !isRetiredScorecardSurfaceName(report?.runId));
  const blockedReports = blockedSourceReports(sourceReports);
  const blockedStrategies = new Set(blockedReports.map((report) => cleanText(report.strategy)).filter(Boolean));
  const suppressedRows = selectedRecords.filter((row) => blockedStrategies.has(cleanText(row.strategy)));
  const records = blockedStrategies.size
    ? selectedRecords.filter((row) => !blockedStrategies.has(cleanText(row.strategy)))
    : selectedRecords;
  const selected = {
    ...payload,
    latestDate: selectedDate || payload.latestDate || "",
    selectedDate: selectedDate || payload.latestDate || "",
    historyLatestDate: dates[0] || payload.latestDate || "",
    historyDates: dates,
    sourceQuery: sanitizeScorecardSourceQuery(payload.sourceQuery || {}),
    records,
    sourceReports,
    suppressedRows: suppressedRows.map((row) => ({
      record_id: cleanText(row.record_id),
      strategy: cleanText(row.strategy),
      ticker: cleanText(row.ticker),
      entry_time: cleanText(row.entry_time),
    })),
    blockedSourceReports: blockedReports.map((report) => ({
      key: cleanText(report.key),
      strategy: cleanText(report.strategy),
      runId: cleanText(report.runId),
      reason: cleanText(report.reason),
    })),
    summary: {
      ...summarize(records, daily, selectedDate || payload.latestDate || ""),
      suppressedRows: suppressedRows.length,
      blockedStrategies: [...blockedStrategies],
    },
  };
  selected.records = decorateRecords(selected, selected.fallbackReason || "");
  selected.audit = summarizeAudit(selected, selected.fallbackReason || "");
  selected.sources = selected.sources || [{
    name: "scorecard_snapshot",
    cacheSource: cleanText(selected.cacheSource || ""),
    exportSource: cleanText(selected.exportSource || ""),
    snapshotKey: cleanText(selected.snapshot?.key || SNAPSHOT_KEY),
    updatedAt: cleanText(selected.snapshot?.updatedAt || selected.updatedAt || ""),
  }];
  selected.issues = Array.isArray(selected.issues) ? selected.issues : selected.audit.blockers;
  selected.warnings = Array.isArray(selected.warnings) ? selected.warnings : selected.audit.warnings;
  selected.unattendedStatus = selected.audit.unattendedStatus;
  selected.needsHumanWatch = selected.audit.needsHumanWatch;
  return selected;
}

function buildPayloadFromSnapshotPayload(snapshotPayload, options = {}) {
  const snapshot = options.snapshot || {};
  return selectPayloadDate(withScorecardContract({
    ok: snapshotPayload?.ok !== false,
    ...snapshotPayload,
    source: snapshotPayload?.source || "supabase:scorecard_snapshot",
    cacheSource: snapshotPayload?.cacheSource || "supabase-snapshot",
    snapshot: {
      key: snapshot.key || SNAPSHOT_KEY,
      tradeDate: snapshot.tradeDate || "",
      updatedAt: snapshot.updatedAt || snapshotPayload?.updatedAt || "",
      source: snapshot.source || "",
    },
  }, options.status || "complete", options.reason || ""), options.requestedDate || "");
}

function readStaticSnapshot(reason = "scorecard_static_snapshot") {
  const raw = fs.readFileSync(SNAPSHOT_FILE, "utf8");
  const payload = JSON.parse(raw);
  return withScorecardContract({
    ok: payload.ok !== false,
    ...payload,
    cacheSource: "json-snapshot",
    fallbackReason: reason,
  }, "degraded", reason);
}

async function buildPayload(requestedDate = "") {
  const snapshot = await readSnapshot(SNAPSHOT_KEY, { allowLatestFallback: true, timeoutMs: 30000 }).catch(() => null);
  if (snapshot?.payload && typeof snapshot.payload === "object") {
    const payload = await withLiveSourceReports(withScorecardContract({
      ok: snapshot.payload.ok !== false,
      ...snapshot.payload,
      source: snapshot.payload.source || "supabase:scorecard_snapshot",
      cacheSource: "supabase-snapshot",
      snapshot: {
        key: snapshot.key || SNAPSHOT_KEY,
        tradeDate: snapshot.tradeDate || "",
        updatedAt: snapshot.updatedAt || "",
        source: snapshot.source || "",
      },
    }, "complete"));
    return selectPayloadDate(payload, requestedDate);
  }
  return selectPayloadDate(await withLiveSourceReports(readStaticSnapshot("supabase_scorecard_snapshot_missing")), requestedDate);
}

async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }
  try {
    const requestedDate = isoDate(request.query?.date || request.query?.record_date || "");
    const marketCalendar = await buildMarketCalendarContract().catch(() => null);
    const payload = attachMarketCalendar(await buildPayload(requestedDate), marketCalendar);
    if (request.method === "HEAD") response.status(200).end("");
    else response.status(200).json(payload);
  } catch (error) {
    response.status(503).json({ ok: false, error: "scorecard_unavailable", reason: error?.message || String(error), updatedAt: new Date().toISOString() });
  }
}

module.exports = handler;
module.exports.__test = {
  SCORECARD_REQUIRED_FIELDS,
  buildPayloadFromSnapshotPayload,
  validateScorecardPayload,
  decorateRecords,
  summarizeAudit,
  selectPayloadDate,
  withScorecardContract,
};


