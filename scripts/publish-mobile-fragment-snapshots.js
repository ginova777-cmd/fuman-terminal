const { upsertSnapshot, taipeiDateKey } = require("../lib/supabase-snapshots");
const { resolveProtectedReadbackCredential } = require("../lib/protected-readback-credential");

const AUTH_URL = "https://jxnqyqnigsppqsxinlrq.supabase.co";
const AUTH_KEY = "sb_publishable_kCocRYzO4oCBnFRQO_pfvg_JZUl0oxm";
const BASE_URL = (process.env.FUMAN_PRODUCTION_URL || process.env.FUMAN_TERMINAL_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const TABS = ["strategy2", "strategy3", "strategy4", "strategy5", "chip", "cb", "warrant"];

function required(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`missing ${name}`);
  return text;
}

async function login() {
  const credential = await resolveProtectedReadbackCredential({ timeoutMs: 30000 });
  if (!credential.ok || !credential.token) throw new Error(`protected readback credential failed: ${credential.reason || "unknown"} ${credential.error || ""}`.trim());
  return credential.token;
}

function attr(text, name) {
  const match = String(text || "").match(new RegExp(`${name}=["']([^"']+)`, "i"));
  return match?.[1] || "";
}

function snapshotKey(tab) {
  return `mobile_fragment_${tab}`;
}

function runIdTradeDate(runId) {
  const match = String(runId || "").match(/(?:^|-)20(\d{6})(?:-|$)/);
  return match ? `20${match[1]}` : "";
}

async function fetchFragment(tab, token) {
  const url = `${BASE_URL}/api/mobile-fragment?tab=${encodeURIComponent(tab)}&live=1&verify=1&noSnapshot=1&publish_mobile_snapshot=${Date.now()}`;
  const startedAt = Date.now();
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "text/html",
      "cache-control": "no-cache",
    },
  });
  const html = await response.text();
  if (!response.ok) throw new Error(`${tab} HTTP ${response.status} ${html.slice(0, 160)}`);
  const key = attr(html, "data-mobile-fragment-key");
  const runId = attr(html, "data-run-id");
  if (key !== tab) throw new Error(`${tab} fragment key mismatch actual=${key || "<missing>"}`);
  if (!runId) throw new Error(`${tab} data-run-id missing`);
  const tradeDate = runIdTradeDate(runId);
  const expectedTradeDate = taipeiDateKey();
  if (!tradeDate) throw new Error(`${tab} runId date missing runId=${runId}`);
  if (tradeDate !== expectedTradeDate) throw new Error(`${tab} stale runId=${runId} tradeDate=${tradeDate} expected=${expectedTradeDate}`);
  return { tab, html, runId, tradeDate, elapsedMs: Date.now() - startedAt };
}

async function publishOne(tab, token) {
  const fragment = await fetchFragment(tab, token);
  const updatedAt = new Date().toISOString();
  const write = await upsertSnapshot(snapshotKey(tab), {
    ok: true,
    tab,
    resolvedTradeDate: fragment.tradeDate,
    html: fragment.html,
    runId: fragment.runId,
    updatedAt,
    generatedAt: updatedAt,
    source: "scripts/publish-mobile-fragment-snapshots",
    elapsedMs: fragment.elapsedMs,
  }, {
    snapshotId: fragment.runId,
    tradeDate: fragment.tradeDate,
    source: "mobile-fragment-html",
    reason: "mobile-fragment-fast-readback-publish",
    timeoutMs: 12000,
  });
  if (write?.ok === false) throw new Error(`${tab} snapshot write failed: ${write.error || write.reason || "unknown_error"}`);
  return { tab, runId: fragment.runId, bytes: fragment.html.length, elapsedMs: fragment.elapsedMs, write };
}

async function main() {
  const token = await login();
  const results = [];
  const failures = [];
  for (const tab of TABS) {
    try {
      const result = await publishOne(tab, token);
      results.push(result);
      console.log(`[mobile-fragment-snapshot] ${tab} runId=${result.runId} bytes=${result.bytes} fetchMs=${result.elapsedMs}`);
    } catch (error) {
      const failure = { tab, error: error?.message || String(error) };
      failures.push(failure);
      console.error(`[mobile-fragment-snapshot] ${tab} failed: ${failure.error}`);
    }
  }
  console.log(JSON.stringify({ ok: failures.length === 0, baseUrl: BASE_URL, count: results.length, results, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exit(1);
});


