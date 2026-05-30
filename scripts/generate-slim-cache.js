const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const runtimeRoot = process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime";

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function slimSignal(signal) {
  return {
    id: String(signal?.id || ""),
    title: String(signal?.title || ""),
    short: String(signal?.short || ""),
    icon: String(signal?.icon || ""),
    reason: String(signal?.reason || ""),
  };
}

function slimStrategy4(payload) {
  const matches = Array.isArray(payload?.matches) ? payload.matches : [];
  return {
    ok: Boolean(payload?.ok ?? true),
    source: payload?.source || "strategy4-slim",
    updatedAt: payload?.updatedAt || "",
    scanStamp: payload?.scanStamp || "",
    total: cleanNumber(payload?.total),
    count: cleanNumber(payload?.count || matches.length),
    complete: Boolean(payload?.complete),
    scannedCount: Array.isArray(payload?.scannedCodes) ? payload.scannedCodes.length : cleanNumber(payload?.scannedCount),
    matches: matches.map((item) => ({
      code: String(item.code || ""),
      name: String(item.name || item.code || ""),
      close: cleanNumber(item.close),
      percent: cleanNumber(item.percent),
      tradeVolume: cleanNumber(item.tradeVolume),
      value: cleanNumber(item.value),
      swingScore: cleanNumber(item.swingScore || item.score),
      score: cleanNumber(item.swingScore || item.score),
      swingZone: item.swingZone || "A",
      swingStage: item.swingStage || item.stage || null,
      swingSignals: Array.isArray(item.swingSignals || item.signals)
        ? (item.swingSignals || item.signals).map(slimSignal)
        : [],
    })),
  };
}

function slimInstitution(payload) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
  const slim = {};
  for (const [code, row] of Object.entries(data)) {
    slim[code] = {
      code,
      name: row?.name || code,
      close: cleanNumber(row?.close),
      percent: cleanNumber(row?.percent),
      value: cleanNumber(row?.value),
      foreign: cleanNumber(row?.foreign),
      trust: cleanNumber(row?.trust),
      dealer: cleanNumber(row?.dealer),
      total: cleanNumber(row?.total),
      foreignStreak: cleanNumber(row?.foreignStreak),
      trustStreak: cleanNumber(row?.trustStreak),
      jointStreak: cleanNumber(row?.jointStreak),
    };
  }
  return {
    ok: Boolean(payload?.ok ?? true),
    source: payload?.source || "institution-slim",
    updatedAt: payload?.updatedAt || "",
    usedDate: payload?.usedDate || "",
    quoteUpdatedAt: payload?.quoteUpdatedAt || "",
    count: cleanNumber(payload?.count || Object.keys(slim).length),
    data: slim,
  };
}

function slimWarrant(payload) {
  const matches = Array.isArray(payload?.matches) ? payload.matches : [];
  return {
    ok: Boolean(payload?.ok ?? true),
    source: payload?.source || "warrant-flow-slim",
    updatedAt: payload?.updatedAt || "",
    count: cleanNumber(payload?.count || matches.length),
    matches: matches.map((item) => ({
      code: String(item.underlyingCode || item.code || ""),
      name: String(item.underlyingName || item.name || item.underlyingCode || item.code || ""),
      underlyingCode: String(item.underlyingCode || item.code || ""),
      underlyingName: String(item.underlyingName || item.name || ""),
      underlyingClose: cleanNumber(item.underlyingClose ?? item.close ?? item.stockClose),
      underlyingPercent: cleanNumber(item.underlyingPercent ?? item.percent ?? item.stockPercent),
      callValue: cleanNumber(item.callValue),
      putValue: cleanNumber(item.putValue),
      callCount: cleanNumber(item.callCount),
      putCount: cleanNumber(item.putCount),
      callPutRatio: cleanNumber(item.callPutRatio),
      score: cleanNumber(item.score),
      tradeDate: item.tradeDate || "",
      reason: item.reason || "",
    })),
  };
}

const jobs = [
  ["strategy4", "data/strategy4-latest.json", "data/strategy4-slim.json", slimStrategy4],
  ["institution", "data/institution-latest.json", "data/institution-slim.json", slimInstitution],
  ["warrant", "data/warrant-flow-latest.json", "data/warrant-flow-slim.json", slimWarrant],
];

let wrote = 0;
for (const [name, input, output, build] of jobs) {
  const candidates = [
    path.join(runtimeRoot, input),
    path.join(repoRoot, input),
  ];
  const source = candidates.find((file) => fs.existsSync(file));
  if (!source) {
    console.log(`[slim] skip ${name}: source not found`);
    continue;
  }
  const payload = build(readJson(source));
  for (const root of [repoRoot, runtimeRoot]) {
    writeJson(path.join(root, output), payload);
  }
  wrote += 1;
  console.log(`[slim] wrote ${output} count=${payload.count || Object.keys(payload.data || {}).length}`);
}

if (!wrote) process.exitCode = 1;
