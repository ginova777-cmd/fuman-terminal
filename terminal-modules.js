(function () {
  const VERSION = "speed-modules-20260530-9";
  const modules = {
    app: { loaded: false, src: "terminal-app.js" },
    strategy4: { loaded: false, src: "terminal-app.js" },
    chipFlow: { loaded: false, src: "terminal-app.js" },
    warrantFlow: { loaded: false, src: "terminal-app.js" },
    realtimeRadar: { loaded: false, src: "terminal-app.js" },
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
      if (window.FUMAN_TERMINAL_PREFETCH_APP) window.FUMAN_TERMINAL_PREFETCH_APP();
      if (viewName === "strategy") this.preload("strategy4");
      if (viewName === "chip-trade") this.preload("chipFlow");
      if (viewName === "warrant-flow") this.preload("warrantFlow");
      if (viewName === "realtime-radar") this.preload("realtimeRadar");
    },
  };
})();
