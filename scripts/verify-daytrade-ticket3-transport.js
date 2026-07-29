"use strict";

const fs = require("fs");

const PROJECT_URL = process.env.SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const MAX_ATTEMPTS = 3;

function readSecret(name) {
  const file = `${RUNTIME_DIR}\\secrets\\${name}`;
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function transient(status, error) {
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return true;
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

async function readEndpoint(key, name, resource, query) {
  const base = PROJECT_URL.endsWith("/") ? PROJECT_URL.slice(0, -1) : PROJECT_URL;
  const attempts = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const started = Date.now();
    try {
      const response = await fetch(`${base}/rest/v1/${resource}?${query}`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
          Prefer: "count=exact",
          Range: "items=0-349",
        },
        signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
      });
      const text = await response.text();
      let rows = [];
      try { rows = text ? JSON.parse(text) : []; } catch { rows = []; }
      attempts.push({ attempt, http: response.status, ms: Date.now() - started });
      if (response.ok) {
        return { name, resource, ok: true, http: response.status, rows: Array.isArray(rows) ? rows.length : 0, attempts };
      }
      if (!transient(response.status) || attempt === MAX_ATTEMPTS) {
        return { name, resource, ok: false, http: response.status, error: text.slice(0, 240), attempts };
      }
    } catch (error) {
      attempts.push({ attempt, error: error.name || String(error), ms: Date.now() - started });
      if (!transient(0, error) || attempt === MAX_ATTEMPTS) {
        return { name, resource, ok: false, http: 0, error: error.message || String(error), attempts };
      }
    }
    await sleep(300 * (2 ** (attempt - 1)));
  }
  return { name, resource, ok: false, http: 0, error: "retry_exhausted", attempts };
}

async function main() {
  const key = process.env.SUPABASE_ANON_KEY || readSecret("supabase-anon-key.txt");
  if (!key) throw new Error("missing Supabase anon key");
  const checks = [
    ["mother_pool", "v_fugle_daytrade_mother_pool", "select=symbol&order=mother_rank.asc"],
    ["priority_top40", "v_fugle_daytrade_priority_top40", "select=symbol,mother_pool_rank&order=mother_pool_rank.asc"],
    ["formal_priority_top40", "v_fugle_daytrade_formal_priority_top40", "select=symbol,mother_rank&order=mother_rank.asc"],
    ["source_status", "source_status", "select=source_name,status,updated_at,payload&source_name=eq.fugle_daytrade_source"],
    ["canonical_gate", "v_fugle_daytrade_canonical_gate", "select=canonical_gate_grade,canonical_gate_status,formal_entry_allowed,scanner_can_run_opening"],
    ["unattended_gate", "v_fugle_daytrade_unattended_gate_status", "select=canonical_gate_grade,canonical_gate_status,formal_entry_allowed,scanner_can_run_opening"],
  ];
  const results = [];
  for (const check of checks) results.push(await readEndpoint(key, ...check));
  const transportFailures = results.filter((item) => !item.ok);
  console.log(JSON.stringify({
    ok: transportFailures.length === 0,
    checkedAt: new Date().toISOString(),
    policy: { maxAttempts: MAX_ATTEMPTS, acceptsHttp206: true, retryStatuses: [408, 425, 429, 500, 502, 503, 504] },
    transportFailures: transportFailures.map((item) => ({ name: item.name, http: item.http, error: item.error, attempts: item.attempts })),
    endpoints: results,
    interpretation: transportFailures.length ? "transport_unavailable_or_retry_exhausted" : "transport_connected; inspect contract/gate fields separately",
  }, null, 2));
  process.exitCode = transportFailures.length ? 1 : 0;
}

main().catch((error) => {
  console.error(`[daytrade-ticket3-transport] ${error.message}`);
  process.exitCode = 2;
});
