const { upsertSnapshot } = require("../lib/supabase-snapshots");

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
  const email = required(process.env.FUMAN_TEST_MEMBER_EMAIL, "FUMAN_TEST_MEMBER_EMAIL");
  const password = required(process.env.FUMAN_TEST_MEMBER_PASSWORD, "FUMAN_TEST_MEMBER_PASSWORD");
  const response = await fetch(`${AUTH_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: AUTH_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const text = await response.text();
  const json = JSON.parse(text || "{}");
  if (!response.ok || !json.access_token) throw new Error(`member login failed status=${response.status} ${text.slice(0, 160)}`);
  return json.access_token;
}

function attr(text, name) {
  const match = String(text || "").match(new RegExp(`${name}=["']([^"']+)`, "i"));
  return match?.[1] || "";
}

function snapshotKey(tab) {
  return `mobile_fragment_${tab}`;
}

async function fetchFragment(tab, token) {
  const url = `${BASE_URL}/api/mobile-fragment?tab=${encodeURIComponent(tab)}&publish_mobile_snapshot=${Date.now()}`;
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
  return { tab, html, runId, elapsedMs: Date.now() - startedAt };
}

async function publishOne(tab, token) {
  const fragment = await fetchFragment(tab, token);
  const updatedAt = new Date().toISOString();
  const write = await upsertSnapshot(snapshotKey(tab), {
    ok: true,
    tab,
    html: fragment.html,
    runId: fragment.runId,
    updatedAt,
    generatedAt: updatedAt,
    source: "scripts/publish-mobile-fragment-snapshots",
    elapsedMs: fragment.elapsedMs,
  }, {
    snapshotId: fragment.runId,
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
  for (const tab of TABS) {
    const result = await publishOne(tab, token);
    results.push(result);
    console.log(`[mobile-fragment-snapshot] ${tab} runId=${result.runId} bytes=${result.bytes} fetchMs=${result.elapsedMs}`);
  }
  console.log(JSON.stringify({ ok: true, baseUrl: BASE_URL, count: results.length, results }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exit(1);
});
