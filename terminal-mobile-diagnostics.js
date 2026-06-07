(function () {
  "use strict";

  async function runSelfCheck(context = {}) {
    const steps = [
      { key: "market", label: "首頁" },
      { key: "strategy", label: "策略4", preset: "策略4" },
      { key: "chip-trade", label: "買賣超" },
      { key: "warrant-flow", label: "權證" },
      { key: "watchlist", label: "自選股" },
    ];
    const results = [];
    const viewLinks = Array.from(context.viewLinks || []);
    for (const step of steps) {
      const link = viewLinks.find((item) => item.dataset.view === step.key && (!step.preset || item.textContent.includes(step.preset)));
      const startedAt = performance?.now ? performance.now() : Date.now();
      try {
        if (link) {
          if (step.preset) context.applyStrategyPresetFromLink?.(link);
          context.showView?.(step.key, link);
        } else if (step.key === "strategy") {
          const strategyLink = viewLinks.find((item) => item.dataset.view === "strategy");
          if (strategyLink) {
            context.applyStrategyPresetFromLink?.(strategyLink);
            context.showView?.("strategy", strategyLink);
          }
        }
        await new Promise((resolve) => setTimeout(resolve, context.isMobileViewport?.() ? 900 : 500));
        const ms = Math.round((performance?.now ? performance.now() : Date.now()) - startedAt);
        results.push({ label: step.label, view: step.key, ms, ok: true });
        context.recordFumanPerformance?.(`mobile-self-check:${step.key}`, startedAt, true);
      } catch (error) {
        const ms = Math.round((performance?.now ? performance.now() : Date.now()) - startedAt);
        results.push({ label: step.label, view: step.key, ms, ok: false, error: error?.message || String(error) });
        context.recordFumanPerformance?.(`mobile-self-check:${step.key}`, startedAt, false, error);
      }
    }
    window.FUMAN_TERMINAL_BOOT = window.FUMAN_TERMINAL_BOOT || {};
    window.FUMAN_TERMINAL_BOOT.mobileSelfCheck = {
      at: new Date().toISOString(),
      viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
      results,
      slowest: [...results].sort((a, b) => b.ms - a.ms)[0] || null,
    };
    return window.FUMAN_TERMINAL_BOOT.mobileSelfCheck;
  }

  window.FUMAN_MOBILE_DIAGNOSTICS = { runSelfCheck };
})();
