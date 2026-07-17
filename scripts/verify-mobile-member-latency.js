const AUTH_URL = "https://jxnqyqnigsppqsxinlrq.supabase.co";
const AUTH_KEY = "sb_publishable_kCocRYzO4oCBnFRQO_pfvg_JZUl0oxm";
const BASE_URL = (process.env.FUMAN_PRODUCTION_URL || process.env.FUMAN_TERMINAL_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");

const email = String(process.env.FUMAN_TEST_MEMBER_EMAIL || "").trim();
const password = String(process.env.FUMAN_TEST_MEMBER_PASSWORD || "");
const MAX_BOOT_MS = Number(process.env.FUMAN_MOBILE_MEMBER_BOOT_MAX_MS || 4500);
const MAX_FRAGMENT_MS = Number(process.env.FUMAN_MOBILE_MEMBER_FRAGMENT_MAX_MS || 4500);
const MAX_TOTAL_MS = Number(process.env.FUMAN_MOBILE_MEMBER_TOTAL_MAX_MS || 8000);
const TABS = ["strategy2", "strategy3", "strategy4", "strategy5", "chip", "cb", "warrant"];

function requiredEnv() {
  if (!email || !password) {
    throw new Error("missing FUMAN_TEST_MEMBER_EMAIL / FUMAN_TEST_MEMBER_PASSWORD");
  }
}

async function fetchWithTiming(url, options = {}) {
  const started = Date.now();
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: {
      "cache-control": "no-cache",
      accept: options.accept || "*/*",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  return {
    url,
    status: response.status,
    ok: response.ok,
    elapsedMs: Date.now() - started,
    cacheControl: response.headers.get("cache-control") || "",
    text,
  };
}

async function login() {
  const result = await fetchWithTiming(`${AUTH_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: AUTH_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  let json = null;
  try {
    json = JSON.parse(result.text || "{}");
  } catch {}
  if (result.status !== 200 || !json?.access_token) {
    throw new Error(`member login failed status=${result.status} body=${result.text.slice(0, 180)}`);
  }
  return { token: json.access_token, userId: json.user?.id || "", elapsedMs: result.elapsedMs };
}

function jsonFrom(text) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return null;
  }
}

function htmlAttr(text, name) {
  const match = String(text || "").match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match ? match[1] : "";
}

function isMembershipLocked(result) {
  const json = jsonFrom(result.text);
  return result.status === 401
    || json?.membershipRequired === true
    || json?.protected === true
    || /membership_required|data-membership-required|mobile-terminal-locked/i.test(result.text || "");
}

function cacheFresh(path) {
  const joiner = path.includes("?") ? "&" : "?";
  return `${BASE_URL}${path}${joiner}member_latency_probe=${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function verifyBoot(token, issues) {
  const result = await fetchWithTiming(cacheFresh("/api/mobile-boot"), {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  const json = jsonFrom(result.text);
  if (result.status !== 200 || json?.membershipRequired === true || json?.protected === true) {
    issues.push(`/api/mobile-boot must open for member; status=${result.status} membershipRequired=${json?.membershipRequired}`);
  }
  if (!/no-store/i.test(result.cacheControl)) {
    issues.push(`/api/mobile-boot must be no-store; cache=${result.cacheControl || "<missing>"}`);
  }
  if (result.elapsedMs > MAX_BOOT_MS) {
    issues.push(`/api/mobile-boot too slow ${result.elapsedMs}ms > ${MAX_BOOT_MS}ms`);
  }
  const fragments = json?.fragments && typeof json.fragments === "object" ? json.fragments : {};
  for (const tab of TABS) {
    const fragment = fragments[tab];
    if (!String(fragment?.url || "").startsWith(`/api/mobile-fragment?tab=${tab}`)) {
      issues.push(`/api/mobile-boot missing fragment url for ${tab}`);
    }
    if (!fragment?.runId) issues.push(`/api/mobile-boot missing runId for ${tab}`);
  }
  return {
    path: "/api/mobile-boot",
    status: result.status,
    elapsedMs: result.elapsedMs,
    bootHash: json?.bootHash || "",
    fragmentCount: Object.keys(fragments).length,
  };
}

async function verifyFragment(token, tab, issues) {
  const path = `/api/mobile-fragment?tab=${encodeURIComponent(tab)}`;
  const result = await fetchWithTiming(cacheFresh(path), {
    headers: { authorization: `Bearer ${token}`, accept: "text/html" },
  });
  const locked = isMembershipLocked(result);
  const key = htmlAttr(result.text, "data-mobile-fragment-key");
  const runId = htmlAttr(result.text, "data-run-id");
  const rows = (result.text.match(/mobile-terminal-row/g) || []).length;
  if (result.status !== 200) issues.push(`${path} must return 200 for member; status=${result.status}`);
  if (locked) issues.push(`${path} must not return membership lock for active member`);
  if (key !== tab) issues.push(`${path} stale/mismatched fragment key actual=${key || "<missing>"} expected=${tab}`);
  if (!runId) issues.push(`${path} missing data-run-id`);
  if (!/no-store/i.test(result.cacheControl)) issues.push(`${path} must be no-store; cache=${result.cacheControl || "<missing>"}`);
  if (result.elapsedMs > MAX_FRAGMENT_MS) issues.push(`${path} too slow ${result.elapsedMs}ms > ${MAX_FRAGMENT_MS}ms`);
  if (tab !== "strategy2" && rows <= 0) issues.push(`${path} rendered no mobile rows`);
  return { tab, status: result.status, elapsedMs: result.elapsedMs, key, runId, rows, bytes: result.text.length };
}

async function main() {
  requiredEnv();
  const started = Date.now();
  const issues = [];
  const session = await login();
  const boot = await verifyBoot(session.token, issues);
  const fragments = await Promise.all(TABS.map((tab) => verifyFragment(session.token, tab, issues)));
  const totalMs = Date.now() - started;
  if (totalMs > MAX_TOTAL_MS) issues.push(`mobile member latency total too slow ${totalMs}ms > ${MAX_TOTAL_MS}ms`);
  const slowest = fragments.reduce((max, item) => Math.max(max, item.elapsedMs), 0);
  const summary = {
    ok: issues.length === 0,
    contract: "mobile-member-latency-v1",
    baseUrl: BASE_URL,
    email,
    userId: session.userId,
    thresholds: {
      bootMs: MAX_BOOT_MS,
      fragmentMs: MAX_FRAGMENT_MS,
      totalMs: MAX_TOTAL_MS,
    },
    loginMs: session.elapsedMs,
    totalMs,
    slowestFragmentMs: slowest,
    boot,
    fragments,
    issues,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, contract: "mobile-member-latency-v1", error: error?.message || String(error) }, null, 2));
  process.exit(1);
});
