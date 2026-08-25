(() => {
  "use strict";

  // This file only retrieves the verified 08:30 payload. The desktop shell owns
  // the market AI surface so the morning report cannot replace index cards.
  const ENDPOINTS = [
    "/api/market-ai-live?briefingOnly=1",
    "/api/market-ai-live?canvas=1&compact=1&shell=1&limit=40",
  ];
  const MAX_RETRY_ATTEMPTS = 3;

  function deliver(report) {
    if (!report || report.ok !== true) return false;
    window.__fumanOpeningReport0830 = report;
    const render = window.FUMAN_RENDER_OPENING_REPORT_0830;
    if (typeof render !== "function") return false;
    return Boolean(render({ openingMorningReport: report }));
  }

  async function refresh(attempt = 0) {
    let report = null;
    for (const endpoint of ENDPOINTS) {
      try {
        const response = await fetch(endpoint, { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) continue;
        const payload = await response.json();
        if (payload?.openingMorningReport?.ok === true) {
          report = payload.openingMorningReport;
          break;
        }
      } catch (_) {}
    }
    const mounted = deliver(report);
    if (mounted) {
      document.documentElement.dataset.fumanOpeningReport0830 = "mounted";
      return report;
    }
    const hasMoreAttempts = attempt < MAX_RETRY_ATTEMPTS;
    document.documentElement.dataset.fumanOpeningReport0830 = hasMoreAttempts ? "retrying" : report ? "pending_shell" : "missing";
    if (hasMoreAttempts) window.setTimeout(() => refresh(attempt + 1), 800 * (attempt + 1));
    return report;
  }

  window.__fumanOpeningReport0830Standalone = { refresh, deliver };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refresh, { once: true });
  else refresh();
})();
