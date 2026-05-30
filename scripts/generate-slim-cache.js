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

function writeToBoth(output, payload) {
  for (const root of [repoRoot, runtimeRoot]) {
    writeJson(path.join(root, output), payload);
  }
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

function strategy4PresetFiles(payload) {
  const slim = slimStrategy4(payload);
  const matches = [...slim.matches];
  const base = {
    ok: slim.ok,
    source: "strategy4-preset",
    updatedAt: slim.updatedAt,
    scanStamp: slim.scanStamp,
    total: slim.total,
    complete: slim.complete,
  };
  const byScore = [...matches].sort((a, b) => cleanNumber(b.swingScore || b.score) - cleanNumber(a.swingScore || a.score));
  return [
    ["data/strategy4-zone-a.json", { ...base, zone: "A", count: matches.filter((item) => (item.swingZone || "A") === "A").length, matches: byScore.filter((item) => (item.swingZone || "A") === "A") }],
    ["data/strategy4-zone-b.json", { ...base, zone: "B", count: matches.filter((item) => item.swingZone === "B").length, matches: byScore.filter((item) => item.swingZone === "B") }],
    ["data/strategy4-zone-c.json", { ...base, zone: "C", count: matches.filter((item) => item.swingZone === "C").length, matches: byScore.filter((item) => item.swingZone === "C") }],
    ["data/strategy4-score-top.json", { ...base, count: Math.min(120, byScore.length), matches: byScore.slice(0, 120) }],
  ];
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

function institutionPresetFiles(payload) {
  const slim = slimInstitution(payload);
  const rows = Object.values(slim.data || {});
  const base = {
    ok: slim.ok,
    source: "institution-preset",
    updatedAt: slim.updatedAt,
    usedDate: slim.usedDate,
    quoteUpdatedAt: slim.quoteUpdatedAt,
  };
  const joint = [...rows].sort((a, b) => b.jointStreak - a.jointStreak || b.total - a.total).slice(0, 160);
  const foreign = [...rows].sort((a, b) => b.foreign - a.foreign).slice(0, 160);
  const trust = [...rows].sort((a, b) => b.trust - a.trust).slice(0, 160);
  return [
    ["data/institution-joint-top.json", { ...base, count: joint.length, rows: joint }],
    ["data/institution-foreign-top.json", { ...base, count: foreign.length, rows: foreign }],
    ["data/institution-trust-top.json", { ...base, count: trust.length, rows: trust }],
  ];
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

function warrantPresetFiles(payload) {
  const slim = slimWarrant(payload);
  const rows = [...slim.matches].sort((a, b) => cleanNumber(b.score) - cleanNumber(a.score) || cleanNumber(b.callValue) - cleanNumber(a.callValue)).slice(0, 160);
  return [
    ["data/warrant-priority-top.json", {
      ok: slim.ok,
      source: "warrant-preset",
      updatedAt: slim.updatedAt,
      count: rows.length,
      matches: rows,
    }],
  ];
}

const jobs = [
  ["strategy4", "data/strategy4-latest.json", "data/strategy4-slim.json", slimStrategy4, strategy4PresetFiles],
  ["institution", "data/institution-latest.json", "data/institution-slim.json", slimInstitution, institutionPresetFiles],
  ["warrant", "data/warrant-flow-latest.json", "data/warrant-flow-slim.json", slimWarrant, warrantPresetFiles],
];

let wrote = 0;
for (const [name, input, output, build, presets] of jobs) {
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
  writeToBoth(output, payload);
  for (const [presetOutput, presetPayload] of presets(readJson(source))) {
    writeToBoth(presetOutput, presetPayload);
    console.log(`[slim] wrote ${presetOutput} count=${presetPayload.count || presetPayload.rows?.length || presetPayload.matches?.length || 0}`);
  }
  wrote += 1;
  console.log(`[slim] wrote ${output} count=${payload.count || Object.keys(payload.data || {}).length}`);
}

if (!wrote) process.exitCode = 1;
