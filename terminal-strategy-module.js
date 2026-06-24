(function () {
  "use strict";

  const VERSION = "public-terminal-fast-20260623-09";

  function install(context = {}) {
    const root = context.document?.documentElement || document.documentElement;
    root.dataset.fumanStrategyModule = "snapshot-first";
    return {
      version: VERSION,
      mode: "snapshot-first",
      primeSnapshot(force = false) {
        return window.FUMAN_DESKTOP_FAST_BUNDLE_PRIME?.(Boolean(force)) || Promise.resolve(0);
      },
      loadLegacy(reason = "strategy-module") {
        return window.FUMAN_TERMINAL_LOAD_APP?.(reason);
      },
    };
  }

  window.FUMAN_STRATEGY_MODULE = { version: VERSION, install };
  window.FUMAN_TERMINAL_MODULES?.markLoaded?.("strategy");
})();
