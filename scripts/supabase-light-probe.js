const fs = require("fs");
const path = require("path");
const https = require("https");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "scan-receipts");
const TIMEOUT_MS = Number(process.env.FUMAN_SUPABASE_LIGHT_PROBE_TIMEOUT_MS || 8000);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function stamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function writeReceipt(payload) {
  ensureDir(RECEIPT_DIR);
  const file = path.join(RECEIPT_DIR, `supabase-light-probe-${stamp()}.json`);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return file;
}

function request(url, key) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: TIMEOUT_MS,
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        accept: "application/json",
        "cache-control": "no-cache",
      },
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body,
      }));
    });
    req.on("timeout", () => req.destroy(new Error(`timeout after ${TIMEOUT_MS}ms`)));
    req.on("error", reject);
  });
}

async function main() {
  const base = terminalSupabaseUrl({ root: ROOT, runtimeDir: RUNTIME_DIR });
  const key = terminalSupabaseKey({ root: ROOT, runtimeDir: RUNTIME_DIR });
  if (!base || !key) throw new Error("missing Supabase URL/key");

  const table = process.env.FUMAN_SUPABASE_LIGHT_PROBE_TABLE || "stock_tickers";
  const url = `${base}/rest/v1/${table}?select=symbol&limit=1`;
  const startedAt = new Date().toISOString();
  let payload;
  try {
    const response = await request(url, key);
    const ok = response.status >= 200 && response.status < 300;
    payload = {
      ok,
      status: ok ? "ready" : "failed",
      kind: "supabase-light-probe",
      table,
      httpStatus: response.status,
      retryAfter: response.headers?.["retry-after"] || null,
      ownerActionRequired: /owner_action_required/i.test(response.body || ""),
      startedAt,
      finishedAt: new Date().toISOString(),
      bodyPreview: String(response.body || "").slice(0, 240),
    };
  } catch (error) {
    payload = {
      ok: false,
      status: "failed",
      kind: "supabase-light-probe",
      table,
      error: String(error?.message || error),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  const file = writeReceipt(payload);
  console.log(JSON.stringify({ ...payload, receipt: file }, null, 2));
  if (!payload.ok) process.exitCode = 2;
}

main().catch((error) => {
  const payload = {
    ok: false,
    status: "failed",
    kind: "supabase-light-probe",
    error: String(error?.message || error),
    finishedAt: new Date().toISOString(),
  };
  const file = writeReceipt(payload);
  console.error(JSON.stringify({ ...payload, receipt: file }, null, 2));
  process.exitCode = 1;
});
