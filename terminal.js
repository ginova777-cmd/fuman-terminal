(function () {
  const boot = window.FUMAN_TERMINAL_BOOT || (window.FUMAN_TERMINAL_BOOT = {});
  const version = boot.version || "speed-modules-20260530-8";
  const appSrc = `/terminal-app.js?v=${version}`;
  let appPromise = null;

  function mark(name) {
    if (!("performance" in window) || !performance.mark) return;
    try { performance.mark(`fuman:${name}`); } catch (error) {}
  }

  function loadApp(reason = "idle") {
    if (window.FUMAN_TERMINAL_APP_READY) return Promise.resolve(window.FUMAN_TERMINAL_APP_READY);
    if (appPromise) return appPromise;
    mark(`app-request:${reason}`);
    appPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-fuman-terminal-app]");
      if (existing) {
        existing.addEventListener("load", () => resolve(true), { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = appSrc;
      script.async = true;
      script.dataset.fumanTerminalApp = "1";
      script.addEventListener("load", () => {
        window.FUMAN_TERMINAL_APP_READY = true;
        mark("app-loaded");
        resolve(true);
      }, { once: true });
      script.addEventListener("error", reject, { once: true });
      document.body.appendChild(script);
    });
    return appPromise;
  }

  function prefetchApp() {
    if (document.querySelector(`link[rel="prefetch"][href="${appSrc}"]`)) return;
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = appSrc;
    document.head.appendChild(link);
  }

  function shouldLoadImmediately() {
    const hash = (location.hash || "").toLowerCase();
    if (hash && !hash.includes("market")) return true;
    return document.body?.dataset?.fumanEager === "1";
  }

  window.FUMAN_TERMINAL_LOAD_APP = loadApp;
  window.FUMAN_TERMINAL_PREFETCH_APP = prefetchApp;

  ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
    window.addEventListener(eventName, () => loadApp(eventName), { once: true, passive: true });
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-view], .strategy-card, .brand-refresh, button, input, select")) {
      loadApp("interaction");
    }
  }, true);

  if (shouldLoadImmediately()) {
    loadApp("route");
  } else {
    if ("requestIdleCallback" in window) {
      requestIdleCallback(() => loadApp("idle"), { timeout: 1800 });
    } else {
      setTimeout(() => loadApp("idle"), 900);
    }
  }
})();
