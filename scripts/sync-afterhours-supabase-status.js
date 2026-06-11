const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const DATA_DIR = process.env.FUMAN_DATA_DIR || path.join(RUNTIME_DIR, "data");
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.join(RUNTIME_DIR, "state");
const SECRET_DIRS = [
  path.join(ROOT, "secrets"),
  path.join(RUNTIME_DIR, "secrets"),
];

const SOURCES = {
  institution: { file: "institution-latest.json", label: "買賣超" },
  warrant: { file: "warrant-flow-latest.json", label: "權證走向" },
  cb: { file: "cb-detect-latest.json", label: "CB" },
};

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function readSecret(name) {
  for (const dir of SECRET_DIRS) {
    try {
      const value = fs.readFileSync(path.join(dir, name), "utf8").trim();
      if (value) return value;
    } catch {}
  }
  return "";
}

const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.FUMAN_SUPABASE_URL ||
  readSecret("supabase-url.txt") ||
  "https://cpmpfhbzutkiecccekfr.supabase.co"
).replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  readSecret("supabase-service-role-key.txt") ||
  process.env.FUMAN_SUPABASE_SERVICE_KEY
);
const SUPABASE_READ_KEY = (
  process.env.SUPABASE_ANON_KEY ||
  process.env.FUMAN_SUPABASE_ANON_KEY ||
  readSecret("supabase-anon-key.txt") ||
  SUPABASE_SERVICE_ROLE_KEY
);

const sourceName = argValue("source", process.env.FUMAN_AFTERHOURS_SOURCE_NAME || "fuman_afterhours_flow");
const requiredNames = argValue("require", process.env.FUMAN_AFTERHOURS_REQUIRED || "institution,warrant")
  .split(",").map((item) => item.trim()).filter(Boolean);
const optionalNames = argValue("optional", process.env.FUMAN_AFTERHOURS_OPTIONAL || "cb")
  .split(",").map((item) => item.trim()).filter(Boolean);

function normalizeDate(value) {
  const text = String(value || "").replace(/\D/g, "").slice(0, 8);
  if (/^\d{8}$/.test(text)) return text;
  const ms = Date.parse(value || "");
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms)).replace(/\D/g, "");
}

function readJson(file) {
  const bytes = fs.readFileSync(file);
  return {
    hash: crypto.createHash("sha256").update(bytes).digest("hex"),
    json: JSON.parse(bytes.toString("utf8")),
  };
}

function arrayLength(payload) {
  for (const key of ["matches", "rows", "data", "items", "results"]) {
    if (Array.isArray(payload?.[key])) return payload[key].length;
  }
  return 0;
}

function countOf(payload) {
  const direct = Number(payload?.count ?? payload?.matchCount ?? payload?.totalMatches ?? payload?.priorityCount);
  if (Number.isFinite(direct) && direct > 0) return direct;
  return arrayLength(payload);
}

function dateOf(payload) {
  return normalizeDate(
    payload?.usedDate ||
    payload?.tradeDate ||
    payload?.quoteDate ||
    payload?.dataDate ||
    payload?.date ||
    payload?.updatedAt
  );
}

function summarizeSource(name, required) {
  const spec = SOURCES[name];
  if (!spec) return { ok: false, required, name, error: `unknown source ${name}` };
  const file = path.join(DATA_DIR, spec.file);
  if (!fs.existsSync(file)) return { ok: false, required, name, label: spec.label, file: spec.file, error: "missing file" };
  try {
    const { hash, json } = readJson(file);
    const count = countOf(json);
    const tradeDate = dateOf(json);
    const updatedAt = json.updatedAt || json.generatedAt || json.scannedAt || "";
    const ok = count > 0 && !!tradeDate;
    return {
      ok,
      required,
      name,
      label: spec.label,
      file: spec.file,
      count,
      tradeDate,
      updatedAt,
      hash,
      error: ok ? "" : `invalid count/date count=${count} date=${tradeDate || "missing"}`,
    };
  } catch (error) {
    return { ok: false, required, name, label: spec.label, file: spec.file, error: error.message || String(error) };
  }
}

function writeStatus(payload) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(path.join(STATE_DIR, "afterhours-supabase-status.json"), text);
  fs.writeFileSync(path.join(DATA_DIR, "afterhours-supabase-status.json"), text);
}

function supabaseHeaders(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function upsertStatus(row) {
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("missing Supabase service_role key");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/source_status?on_conflict=source_name`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(SUPABASE_SERVICE_ROLE_KEY),
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(row),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`source_status upsert HTTP ${response.status} ${text.slice(0, 240)}`.trim());
  }
}

async function readbackStatus() {
  if (!SUPABASE_READ_KEY) throw new Error("missing Supabase readback key");
  const encoded = encodeURIComponent(sourceName);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/source_status?source_name=eq.${encoded}&select=source_name,status,trade_date,updated_at,payload,message&limit=1`, {
    headers: supabaseHeaders(SUPABASE_READ_KEY),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`source_status readback HTTP ${response.status} ${text.slice(0, 240)}`.trim());
  }
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows[0]) throw new Error("source_status readback missing row");
  return rows[0];
}

function verifyReadback(row, expectedPayload) {
  const payload = row.payload || {};
  for (const name of requiredNames) {
    const expected = expectedPayload.sources?.[name];
    const actual = payload.sources?.[name];
    if (!expected?.ok) throw new Error(`expected ${name} is not ok`);
    if (!actual) throw new Error(`readback missing ${name}`);
    for (const key of ["hash", "count", "tradeDate"]) {
      if (String(actual[key] ?? "") !== String(expected[key] ?? "")) {
        throw new Error(`readback mismatch ${name}.${key} actual=${actual[key]} expected=${expected[key]}`);
      }
    }
  }
}

async function main() {
  const names = [...new Set([...requiredNames, ...optionalNames])];
  const sources = Object.fromEntries(names.map((name) => [
    name,
    summarizeSource(name, requiredNames.includes(name)),
  ]));
  const requiredOk = requiredNames.every((name) => sources[name]?.ok);
  const tradeDate = requiredNames.map((name) => sources[name]?.tradeDate).find(Boolean) || "";
  const payload = {
    ok: requiredOk,
    sourceName,
    checkedAt: new Date().toISOString(),
    required: requiredNames,
    optional: optionalNames,
    sources,
  };
  const message = requiredOk
    ? `afterhours Supabase verified: ${requiredNames.map((name) => `${name}=${sources[name].count}`).join(", ")}`
    : `afterhours Supabase blocked: ${requiredNames.filter((name) => !sources[name]?.ok).join(", ")}`;
  const row = {
    source_name: sourceName,
    trade_date: tradeDate ? `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}` : null,
    updated_at: new Date().toISOString(),
    status: requiredOk ? "ok" : "error",
    message,
    stale_seconds: 0,
    payload,
  };
  if (requiredOk) row.last_success_at = row.updated_at;
  else row.last_error_at = row.updated_at;

  if (!requiredOk) {
    writeStatus({ ...payload, supabase: { ok: false, skipped: true, reason: message } });
    throw new Error(message);
  }

  await upsertStatus(row);
  const readback = await readbackStatus();
  verifyReadback(readback, payload);
  writeStatus({ ...payload, supabase: { ok: true, table: "source_status", readbackUpdatedAt: readback.updated_at } });
  console.log(`[afterhours-supabase] ok source=${sourceName} ${requiredNames.map((name) => `${name}=${sources[name].count}`).join(" ")}`);
}

main().catch((error) => {
  const payload = {
    ok: false,
    sourceName,
    checkedAt: new Date().toISOString(),
    error: error.message || String(error),
  };
  writeStatus(payload);
  console.error(`[afterhours-supabase] failed: ${payload.error}`);
  process.exit(1);
});
