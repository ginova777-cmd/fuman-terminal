const fs = require("fs");
const path = require("path");
const { readSecretText, serverSupabaseKey, serviceRoleKey } = require("./server-supabase-key");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime";
const SNAPSHOT_TABLE = process.env.FUMAN_SNAPSHOT_TABLE || "market_snapshots";
const DEFAULT_TIMEOUT_MS = Number(process.env.FUMAN_SNAPSHOT_TIMEOUT_MS || 2500);
const DEFAULT_WRITE_TIMEOUT_MS = Number(process.env.FUMAN_SNAPSHOT_WRITE_TIMEOUT_MS || 20000);

function supabaseUrl() {
  return String(
    process.env.FUMAN_SNAPSHOT_SUPABASE_URL
    || process.env.DESKTOP_SNAPSHOT_SUPABASE_URL
    || process.env.SUPABASE_URL
    || process.env.FUMAN_SUPABASE_URL
    || readSecretText(path.join(ROOT, "secrets", "supabase-url.txt"))
    || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-url.txt"))
    || "https://cpmpfhbzutkiecccekfr.supabase.co"
  ).replace(/\/+$/, "");
}

function readKey() {
  return process.env.FUMAN_SNAPSHOT_SUPABASE_SERVICE_ROLE_KEY
    || process.env.DESKTOP_SNAPSHOT_SUPABASE_SERVICE_ROLE_KEY
    || serverSupabaseKey({ root: ROOT, runtimeDir: RUNTIME_DIR });
}

function writeKey() {
  return process.env.FUMAN_SNAPSHOT_SUPABASE_SERVICE_ROLE_KEY
    || process.env.DESKTOP_SNAPSHOT_SUPABASE_SERVICE_ROLE_KEY
    || serviceRoleKey({ root: ROOT, runtimeDir: RUNTIME_DIR });
}

function timeoutSignal(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function headers(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function taipeiDateKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now).replace(/\D/g, "");
}

function normalizeSnapshotRow(row) {
  if (!row?.payload || typeof row.payload !== "object") return null;
  if (row.symbol && !row.key) {
    const meta = row.payload.__snapshot || {};
    const payload = { ...row.payload };
    delete payload.__snapshot;
    return {
      key: meta.key || row.symbol || "",
      tradeDate: meta.tradeDate || "",
      snapshotId: meta.snapshotId || "",
      locked: Boolean(meta.locked),
      reason: meta.reason || "",
      source: meta.source || row.name || "supabase:market_snapshots",
      updatedAt: row.updated_at || meta.updatedAt || "",
      finalizedAt: meta.finalizedAt || "",
      payload,
    };
  }
  return {
    key: row.key || row.snapshot_key || "",
    tradeDate: row.trade_date || row.tradeDate || "",
    snapshotId: row.snapshot_id || row.snapshotId || "",
    locked: Boolean(row.locked),
    reason: row.reason || "",
    source: row.source || "supabase-snapshot",
    updatedAt: row.updated_at || row.updatedAt || "",
    finalizedAt: row.finalized_at || row.finalizedAt || "",
    payload: row.payload,
  };
}

async function fetchRows(query, key, timeoutMs) {
  const url = `${supabaseUrl()}/rest/v1/${SNAPSHOT_TABLE}?${query}`;
  const timeout = timeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      headers: headers(key),
      signal: timeout.signal,
    });
    if (!response.ok) throw new Error(`snapshot read HTTP ${response.status}`);
    return await response.json();
  } finally {
    timeout.clear();
  }
}

async function readSnapshot(snapshotKey, options = {}) {
  const key = options.key || readKey();
  if (!supabaseUrl() || !key || !snapshotKey) return null;
  const tradeDate = String(options.tradeDate || taipeiDateKey()).replace(/\D/g, "").slice(0, 8);
  if (SNAPSHOT_TABLE === "market_snapshots") {
    try {
      const query = [
        "select=symbol,name,payload,updated_at",
        `symbol=eq.${encodeURIComponent(`__fuman_${snapshotKey}`)}`,
        "limit=1",
      ].join("&");
      const rows = await fetchRows(query, key, options.timeoutMs || DEFAULT_TIMEOUT_MS);
      return normalizeSnapshotRow(Array.isArray(rows) ? rows[0] : null);
    } catch {
      return null;
    }
  }
  const select = "select=key,trade_date,snapshot_id,locked,reason,payload,updated_at,finalized_at,source";
  const order = "order=updated_at.desc&limit=1";
  const exactQuery = [
    select,
    `key=eq.${encodeURIComponent(snapshotKey)}`,
    tradeDate ? `trade_date=eq.${encodeURIComponent(tradeDate)}` : "",
    order,
  ].filter(Boolean).join("&");
  try {
    const exact = await fetchRows(exactQuery, key, options.timeoutMs || DEFAULT_TIMEOUT_MS);
    const exactRow = normalizeSnapshotRow(Array.isArray(exact) ? exact[0] : null);
    if (exactRow) return exactRow;
  } catch (error) {
    if (!options.allowLatestFallback) return null;
  }
  if (!options.allowLatestFallback) return null;
  try {
    const latestQuery = [
      select,
      `key=eq.${encodeURIComponent(snapshotKey)}`,
      order,
    ].join("&");
    const latest = await fetchRows(latestQuery, key, options.timeoutMs || DEFAULT_TIMEOUT_MS);
    return normalizeSnapshotRow(Array.isArray(latest) ? latest[0] : null);
  } catch {
    return null;
  }
}

async function upsertSnapshot(snapshotKey, payload, options = {}) {
  const key = options.key || writeKey();
  if (!supabaseUrl() || !key || !snapshotKey || !payload || typeof payload !== "object") {
    return {
      ok: false,
      skipped: true,
      reason: !key ? "snapshot_write_key_missing" : "snapshot_write_payload_invalid",
      key: snapshotKey,
    };
  }
  const tradeDate = String(options.tradeDate || payload.resolvedTradeDate || payload.today || taipeiDateKey()).replace(/\D/g, "").slice(0, 8);
  const updatedAt = payload.updatedAt || new Date().toISOString();
  if (SNAPSHOT_TABLE === "market_snapshots") {
    const snapshotId = options.snapshotId || payload.runId || `${snapshotKey}-${tradeDate}-${String(updatedAt).replace(/\D/g, "").slice(8, 14) || Date.now()}`;
    const row = {
      symbol: `__fuman_${snapshotKey}`,
      name: options.source || payload.source || snapshotKey,
      payload: {
        ...payload,
        __snapshot: {
          key: snapshotKey,
          tradeDate,
          snapshotId,
          locked: Boolean(options.locked),
          reason: options.reason || (options.locked ? "after-1330-cache" : "snapshot-cache"),
          source: options.source || payload.source || snapshotKey,
          updatedAt,
          finalizedAt: options.locked ? (options.finalizedAt || updatedAt) : "",
        },
      },
      updated_at: updatedAt,
    };
    const timeout = timeoutSignal(options.timeoutMs || DEFAULT_WRITE_TIMEOUT_MS);
    try {
      const response = await fetch(`${supabaseUrl()}/rest/v1/${SNAPSHOT_TABLE}?on_conflict=symbol`, {
        method: "POST",
        headers: {
          ...headers(key),
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(row),
        signal: timeout.signal,
      });
      if (!response.ok) throw new Error(`snapshot upsert HTTP ${response.status} ${(await response.text()).slice(0, 180)}`);
      return { ok: true, key: snapshotKey, tradeDate };
    } catch (error) {
      return { ok: false, error: error.message || String(error), key: snapshotKey, tradeDate };
    } finally {
      timeout.clear();
    }
  }
  const row = {
    key: snapshotKey,
    trade_date: tradeDate,
    snapshot_id: options.snapshotId || payload.runId || `${snapshotKey}-${tradeDate}-${String(updatedAt).replace(/\D/g, "").slice(8, 14) || Date.now()}`,
    locked: Boolean(options.locked),
    reason: options.reason || (options.locked ? "after-1330-cache" : "snapshot-cache"),
    payload,
    source: options.source || payload.source || snapshotKey,
    updated_at: updatedAt,
    finalized_at: options.locked ? (options.finalizedAt || updatedAt) : null,
  };
  const timeout = timeoutSignal(options.timeoutMs || DEFAULT_WRITE_TIMEOUT_MS);
  try {
    const response = await fetch(`${supabaseUrl()}/rest/v1/${SNAPSHOT_TABLE}?on_conflict=key,trade_date`, {
      method: "POST",
      headers: {
        ...headers(key),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(row),
      signal: timeout.signal,
    });
    if (!response.ok) throw new Error(`snapshot upsert HTTP ${response.status} ${(await response.text()).slice(0, 180)}`);
    return { ok: true, key: snapshotKey, tradeDate };
  } catch (error) {
    return { ok: false, error: error.message || String(error), key: snapshotKey, tradeDate };
  } finally {
    timeout.clear();
  }
}

module.exports = {
  readSnapshot,
  upsertSnapshot,
  taipeiDateKey,
};
