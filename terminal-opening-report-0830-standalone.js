(() => {
  "use strict";

  // This file only retrieves the verified 08:30 payload. The desktop shell owns
  // the market AI surface so the morning report cannot replace index cards.
  const ENDPOINTS = [
    "/api/market-ai-live?briefingOnly=1",
    "/api/market-ai-live?canvas=1&compact=1&shell=1&limit=40",
  ];

  function deliver(report) {
    if (!report || report.ok !== true) return false;
    window.__fumanOpeningReport0830 = report;
    const render = window.FUMAN_RENDER_OPENING_REPORT_0830;
    if (typeof render !== "function") return false;
    return Boolean(render({ openingMorningReport: report }));
  }

  async function refresh() {
    let report = null;
    for (const endpoint of ENDPOINTS) {
      try {
        const payload = await fetch(endpoint, { cache: "no-store", credentials: "same-origin" }).then((response) => response.json());
        if (payload?.openingMorningReport?.ok === true) {
          report = payload.openingMorningReport;
          break;
        }
      } catch (_) {}
    }
    const mounted = deliver(report);
    document.documentElement.dataset.fumanOpeningReport0830 = mounted ? "mounted" : report ? "pending_shell" : "missing";
    return report;
  }

  window.__fumanOpeningReport0830Standalone = { refresh, deliver };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refresh, { once: true });
  else refresh();
})();
