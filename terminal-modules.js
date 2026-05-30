(function () {
  const VERSION = "lazy-modules-20260530";
  const modules = {
    strategy4: { loaded: false, src: "terminal-worker.js" },
    chipFlow: { loaded: false, src: "terminal-worker.js" },
    warrantFlow: { loaded: false, src: "terminal-worker.js" },
    realtimeRadar: { loaded: false, src: "terminal-worker.js" },
  };

  window.FUMAN_TERMINAL_MODULES = {
    version: VERSION,
    modules,
    markLoaded(name) {
      if (modules[name]) modules[name].loaded = true;
    },
    preload(name) {
      const item = modules[name];
      if (!item || item.preloaded) return;
      item.preloaded = true;
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.href = `${item.src}?v=${VERSION}`;
      document.head.appendChild(link);
    },
    preloadForView(viewName) {
      if (viewName === "strategy") this.preload("strategy4");
      if (viewName === "chip-trade") this.preload("chipFlow");
      if (viewName === "warrant-flow") this.preload("warrantFlow");
      if (viewName === "realtime-radar") this.preload("realtimeRadar");
    },
  };
})();
