const baseUrl = (
  process.env.FUMAN_VERIFY_BASE_URL ||
  process.env.FUMAN_PRODUCTION_URL ||
  "https://fuman-terminal.vercel.app"
).replace(/\/+$/, "");

function cacheBusted(pathname) {
  return `${baseUrl}${pathname}${pathname.includes("?") ? "&" : "?"}t=${Date.now()}`;
}

async function fetchText(pathname) {
  const response = await fetch(cacheBusted(pathname), {
    cache: "no-store",
    headers: { "cache-control": "no-cache" },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${pathname} HTTP ${response.status}: ${body.slice(0, 240)}`);
  }
  return body;
}

async function fetchJson(pathname) {
  const response = await fetch(cacheBusted(pathname), {
    cache: "no-store",
    headers: { "cache-control": "no-cache" },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch (error) {
    throw new Error(`${pathname} returned non-JSON HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  if (!response.ok) {
    throw new Error(`${pathname} HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  return { status: response.status, body };
}

function summarizeApi(result) {
  const rows = Array.isArray(result.body.rows) ? result.body.rows.length : 0;
  const coverage = result.body.quote_coverage_at_run || result.body.sourceCoverage || {};
  return {
    status: result.status,
    rows,
    totalCount: result.body.totalCount,
    cacheSource: result.body.cacheSource,
    staleQuoteCount: result.body.staleQuoteCount,
    failedBatchCount: result.body.failedBatchCount,
    freshQuoteCoverage120s: Number(result.body.fresh_quote_coverage_120s ?? coverage.fresh_quote_coverage_120s ?? coverage.freshQuoteCoverage120s ?? 0),
    quoteAgeSeconds: Number(result.body.quote_age_seconds ?? coverage.quote_age_seconds ?? coverage.quoteAgeSeconds ?? 999999),
    evidenceStatus: result.body.evidenceStatus || "",
    unattendedStatus: result.body.unattendedStatus || result.body.unattended?.status || "",
    sessionStatus: result.body.sessionStatus || result.body.freshness?.sessionStatus || "",
    sessionCompletenessStatus: result.body.sessionCompleteness?.status || result.body.freshness?.sessionCompleteness?.status || "",
  };
}

(async () => {
  const [home, fastShell, css, fullApi, shellApi] = await Promise.all([
    fetchText("/"),
    fetchText("/terminal-desktop-fast-shell.js"),
    fetchText("/terminal-realtime-radar.css"),
    fetchJson("/api/realtime-radar-latest?full=1&limit=1200"),
    fetchJson("/api/realtime-radar-latest?compact=1&shell=1&limit=1200"),
  ]);

  const apiFull = summarizeApi(fullApi);
  const apiShell1200 = summarizeApi(shellApi);
  const result = {
    baseUrl,
    pageLoadsFastShell: /terminal-desktop-fast-shell\.js\?/.test(home),
    pageHasRealtimeRoute:
      /data-view=["']realtime-radar["']/.test(home) &&
      /id=["']realtime-radar-view["']/.test(home),
    fullSessionApi:
      fastShell.includes("/api/realtime-radar-latest?full=1") &&
      fastShell.includes('marketJsonCacheKey("/api/realtime-radar-latest?full=1", 1200)'),
    noSnapshotOnRealtimeError:
      fastShell.includes("if (isRealtimeRadarRoute(route))") &&
      fastShell.includes("return [];"),
    healthBanner:
      fastShell.includes("radarDomHealthBanner") &&
      css.includes(".radar-health-banner"),
    stateGuard:
      fastShell.includes("realtimeRadarDomSideUserSelected") &&
      fastShell.includes("realtimeRadarDomHealth"),
    longShortLedger:
      fastShell.includes('realtimeRadarDomSide = "long"') &&
      fastShell.includes('data-radar-dom-side="long"') &&
      fastShell.includes('data-radar-dom-side="short"') &&
      !fastShell.includes('data-radar-dom-side="all"') &&
      fastShell.includes("09:00-13:30 流水帳逐筆記錄"),
    fullLedgerNoPagination:
      fastShell.includes("activeRows.map(radarDomSignalCard)") &&
      !fastShell.includes("REALTIME_RADAR_DOM_PAGE_SIZE") &&
      !fastShell.includes("data-radar-dom-page") &&
      !fastShell.includes("pageRows.map(radarDomSignalCard)"),
    apiFull,
    apiShell1200,
  };

  result.ok = [
    result.pageLoadsFastShell,
    result.pageHasRealtimeRoute,
    result.fullSessionApi,
    result.noSnapshotOnRealtimeError,
    result.healthBanner,
    result.stateGuard,
    result.longShortLedger,
    result.fullLedgerNoPagination,
    apiFull.rows === 1200,
    apiFull.totalCount === 1200,
    apiShell1200.rows === 1200,
    apiShell1200.totalCount === 1200,
    apiFull.cacheSource === "supabase-radar-cache",
    apiShell1200.cacheSource === "supabase-radar-cache",
    Number(apiFull.freshQuoteCoverage120s || 0) >= 0.95,
    Number(apiFull.quoteAgeSeconds || 999999) <= 120,
    Number(apiFull.failedBatchCount || 0) === 0,
    apiFull.evidenceStatus === "complete",
    apiFull.unattendedStatus === "YES",
    apiFull.sessionStatus === "complete",
    apiFull.sessionCompletenessStatus === "complete",
  ].every(Boolean);

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
