(function () {
  const version = "strategy5-data-resync-20260616";
  window.FUMAN_TERMINAL_VERSION = version;
  window.FUMAN_TERMINAL_BOOT = {
    version,
    startedAt: Date.now(),
  };

  const enforceFreshVersion = () => {
    try {
      const key = "fuman-terminal-active-version";
      const previous = localStorage.getItem(key);
      if (!previous || previous === version) {
        localStorage.setItem(key, version);
        return;
      }
      localStorage.setItem(key, version);
      const reloadKey = "fuman-terminal-version-reload:" + version;
      if (sessionStorage.getItem(reloadKey) === "1") return;
      sessionStorage.setItem(reloadKey, "1");
      const clearCaches = "caches" in window
        ? caches.keys().then(keys => Promise.all(keys.filter(name => name.includes("fuman-terminal")).map(name => caches.delete(name))))
        : Promise.resolve();
      clearCaches.finally(() => window.location.replace((location.pathname || "/") + (location.search || "")));
    } catch (error) {}
  };

  const reloadToFreshVersion = (targetVersion) => {
    try {
      if (!targetVersion || targetVersion === version) return;
      const reloadKey = "fuman-terminal-remote-version-reload:" + targetVersion;
      if (sessionStorage.getItem(reloadKey) === "1") return;
      sessionStorage.setItem(reloadKey, "1");
      localStorage.setItem("fuman-terminal-active-version", targetVersion);
      const clearCaches = "caches" in window
        ? caches.keys().then(keys => Promise.all(keys.filter(name => name.includes("fuman-terminal")).map(name => caches.delete(name))))
        : Promise.resolve();
      clearCaches.finally(() => window.location.replace(`/?v=${encodeURIComponent(targetVersion)}&fresh=${Date.now()}`));
    } catch (error) {}
  };

  const checkRemoteVersion = () => {
    try {
      const fresh = Date.now();
      fetch(`/version.json?fresh=${fresh}`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() : fetch(`/api/version?fresh=${fresh}`, { cache: "no-store" }).then((apiResponse) => apiResponse.ok ? apiResponse.json() : null))
        .then((payload) => reloadToFreshVersion(String(payload?.version || "").trim()))
        .catch(() => undefined);
    } catch (error) {}
  };

  const warmAuthShell = () => {
    try {
      const key = window.FUMAN_RUNTIME_CONFIG?.authCacheKey || "fuman-terminal-auth-cache-v1";
      const ttl = window.FUMAN_RUNTIME_CONFIG?.authCacheTtlMs || (5 * 60 * 1000);
      const cached = JSON.parse(localStorage.getItem(key) || "null");
      const status = String(cached?.status || "").toLowerCase();
      if (!cached?.at || Date.now() - Number(cached.at) > ttl) return;
      if (!["approved", "active", "trial", "admin"].includes(status)) return;
      document.body.classList.add("auth-ready", "auth-cache-warm");
      document.body.classList.remove("auth-pending", "auth-locked", "auth-login-open");
      document.querySelector("#auth-gate")?.setAttribute("aria-hidden", "true");
    } catch (error) {}
  };

  const mark = (name) => {
    if (!("performance" in window) || !performance.mark) return;
    try { performance.mark(`fuman:${name}`); } catch (error) {}
  };

  const registerServiceWorker = () => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      const key = `fuman-sw-reloaded:${version}`;
      if (sessionStorage.getItem(key) === "1") return;
      sessionStorage.setItem(key, "1");
      window.FUMAN_TERMINAL_BOOT.serviceWorkerReloaded = true;
      window.location.reload();
    });
    navigator.serviceWorker.register(`/fuman-sw.js?v=${version}`)
      .then((registration) => {
        window.FUMAN_TERMINAL_BOOT.serviceWorker = registration.active ? "active" : "registered"; if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" }); if (registration.update) registration.update().catch(() => undefined);
        const worker = registration.active || navigator.serviceWorker.controller;
        if (worker) worker.postMessage({ type: "PREFETCH_DATA" });
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
  enforceFreshVersion();
  checkRemoteVersion();
  warmAuthShell();
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










