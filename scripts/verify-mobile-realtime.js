const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const SUPABASE_URL = "https://cpmpfhbzutkiecccekfr.supabase.co";
const WS_URL = "wss://cpmpfhbzutkiecccekfr.supabase.co/realtime/v1/websocket";
const TABLE = "mobile_update_events";

function readSecret(name) {
  for (const dir of [path.join(ROOT, "secrets"), path.join(RUNTIME_DIR, "secrets")]) {
    try {
      const value = fs.readFileSync(path.join(dir, name), "utf8").trim();
      if (value) return value;
    } catch {}
  }
  return "";
}

function requestJson(method, endpoint, key, payload = null) {
  const body = payload ? JSON.stringify(payload) : "";
  const url = new URL(`${SUPABASE_URL}${endpoint}`);
  return new Promise((resolve, reject) => {
    const req = https.request({
      method,
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      family: 4,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(body ? { "Content-Length": Buffer.byteLength(body), Prefer: "return=representation" } : {}),
      },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        text: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertNoSecretLeak(serviceKey) {
  if (!serviceKey) return;
  const files = [
    "mobile.html",
    "data/mobile-runtime-config.json",
    "data/mobile-boot.json",
    "terminal-runtime-config.js",
    "vercel.json",
  ];
  for (const rel of files) {
    const file = path.join(ROOT, rel);
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(serviceKey)) {
      throw new Error(`service_role key leaked into public file: ${rel}`);
    }
  }
}

async function verifyRealtime(anonKey, serviceKey) {
  let ref = 0;
  const send = (ws, topic, event, payload) => {
    ws.send(JSON.stringify({ topic, event, payload: payload || {}, ref: String(++ref) }));
  };
  const version = `verify-mobile-realtime-${new Date().toISOString()}`;
  let ready = false;
  let received = false;
  const ws = new WebSocket(`${WS_URL}?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`);
  ws.addEventListener("open", () => {
    send(ws, `realtime:public:${TABLE}`, "phx_join", {
      config: { postgres_changes: [{ event: "INSERT", schema: "public", table: TABLE }] },
      access_token: anonKey,
    });
  });
  ws.addEventListener("message", (event) => {
    let message = null;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.event === "system" && message.payload?.status === "ok") ready = true;
    if (message.event === "postgres_changes") {
      const record = message.payload?.data?.record || message.payload?.record || {};
      if (record.version === version) {
        received = true;
        try { ws.close(); } catch {}
      }
    }
  });
  const readyStarted = Date.now();
  while (!ready && Date.now() - readyStarted < 10000) await wait(100);
  if (!ready) throw new Error("Realtime subscription did not become ready");
  const insert = await requestJson("POST", `/rest/v1/${TABLE}`, serviceKey, {
    version,
    boot_hash: "verify",
    changed_keys: ["verify"],
    source: "verify-mobile-realtime",
  });
  if (!insert.ok) throw new Error(`service insert failed status=${insert.status} body=${insert.text.slice(0, 300)}`);
  const eventStarted = Date.now();
  while (!received && Date.now() - eventStarted < 10000) await wait(100);
  try { ws.close(); } catch {}
  if (!received) throw new Error("Realtime insert was not received over WebSocket");
}

async function main() {
  const anonKey = process.env.SUPABASE_ANON_KEY ||
    process.env.FUMAN_SUPABASE_ANON_KEY ||
    readSecret("supabase-anon-key.txt");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY ||
    readSecret("supabase-service-role-key.txt");
  if (!anonKey) throw new Error("missing anon key");
  if (!serviceKey) throw new Error("missing service_role key");
  assertNoSecretLeak(serviceKey);
  const read = await requestJson("GET", `/rest/v1/${TABLE}?select=id,version,source,created_at&order=id.desc&limit=1`, anonKey);
  if (!read.ok) throw new Error(`anon select failed status=${read.status} body=${read.text.slice(0, 300)}`);
  await verifyRealtime(anonKey, serviceKey);
  console.log("[mobile-realtime] ok anonRead=true serviceInsert=true websocket=true secretLeak=false");
}

main().catch((error) => {
  console.error("[mobile-realtime] failed");
  console.error(error?.stack || error);
  process.exitCode = 1;
});
