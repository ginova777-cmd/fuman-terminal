(function () {
  const version = "brand-yellow-inline-20260601-04";
  window.FUMAN_TERMINAL_BOOT = {
    version,
    startedAt: Date.now(),
  };

  const mark = (name) => {
    if (!("performance" in window) || !performance.mark) return;
    try { performance.mark(`fuman:${name}`); } catch (error) {}
  };

  const registerServiceWorker = () => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(`/fuman-sw.js?v=${version}`)
      .then((registration) => {
        window.FUMAN_TERMINAL_BOOT.serviceWorker = registration.active ? "active" : "registered"; if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" }); if (registration.update) registration.update().catch(() => undefined);
      })
      .catch((error) => {
        window.FUMAN_TERMINAL_BOOT.serviceWorker = "disabled";
        window.FUMAN_TERMINAL_BOOT.serviceWorkerError = error?.message || String(error);
      });
  };

  const preconnect = (href) => {
    if (document.querySelector(`link[rel="preconnect"][href="${href}"]`)) return;
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = href;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  };

  mark("core-start");
  preconnect("https://openapi.twse.com.tw");

  const loadMain = () => {
    if (document.querySelector("script[data-fuman-terminal-main]")) return;
    mark("main-request");
    const script = document.createElement("script");
    script.src = `terminal.js?v=${version}`;
    script.async = true;
    script.dataset.fumanTerminalMain = "1";
    script.addEventListener("load", () => mark("bootstrap-loaded"), { once: true });
    document.body.appendChild(script);
  };

  const loadModuleRegistry = () => {
    if (document.querySelector("script[data-fuman-terminal-modules]")) return;
    const script = document.createElement("script");
    script.src = `terminal-modules.js?v=${version}`;
    script.async = true;
    script.dataset.fumanTerminalModules = "1";
    document.head.appendChild(script);
  };

  registerServiceWorker();
  loadModuleRegistry();

  if ("requestIdleCallback" in window) {
    requestIdleCallback(loadMain, { timeout: 250 });
  } else {
    setTimeout(loadMain, 0);
  }
})();
