(function () {
  "use strict";

  const VERSION = "public-terminal-fast-20260623-09";
  const CHIP_ROUTES = ["chip-trade", "cb-detect", "warrant-flow"];
  let installed = false;

  function install(context = {}) {
    if (installed) return window.FUMAN_CHIP_SNAPSHOT_INSTANCE;
    installed = true;
    const instance = {
      version: VERSION,
      mode: "snapshot-chip-shell",
      prime,
      refresh,
      routes: CHIP_ROUTES.slice(),
    };
    window.FUMAN_CHIP_SNAPSHOT_INSTANCE = instance;
    document.documentElement.dataset.fumanChipModule = instance.mode;
    installEvents();
    prime(false);
    return instance;
  }

  function prime(force = false) {
    return window.FUMAN_DESKTOP_FAST_BUNDLE_PRIME?.(Boolean(force)) || Promise.resolve(0);
  }

  function refresh(route = "") {
    const key = String(route || document.body?.dataset?.fumanInstantView || "");
    document.documentElement.dataset.fumanChipSnapshotRefresh = `${key}:${Date.now()}`;
    return prime(true);
  }

  function installEvents() {
    document.addEventListener("click", (event) => {
      const target = event.target.closest?.("[data-chip-filter], [data-warrant-refresh], #chip-sort");
      if (!target) return;
      if (window.FUMAN_TERMINAL_APP_READY) return;
      window.clearTimeout(window.__fumanChipSnapshotRefreshTimer);
      window.__fumanChipSnapshotRefreshTimer = window.setTimeout(() => refresh("chip"), 80);
    }, true);
  }

  window.FUMAN_CHIP_SNAPSHOT_MODULE = { version: VERSION, install };
  window.FUMAN_TERMINAL_MODULES?.markLoaded?.("chip");
})();
