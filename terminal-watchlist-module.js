(function () {
  "use strict";

  const VERSION = "watchlist-old-page-deleted-bridge-20260627-02";
  let shellPromise = null;

  function loadShellScript() {
    if (window.FUMAN_WATCHLIST_SHELL_MODULE || window.FUMAN_WATCHLIST_SHELL_INSTANCE) {
      return Promise.resolve(window.FUMAN_WATCHLIST_SHELL_MODULE || window.FUMAN_WATCHLIST_SHELL_INSTANCE);
    }
    if (shellPromise) return shellPromise;
    shellPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-fuman-watchlist-shell]");
      if (existing) {
        if (window.FUMAN_WATCHLIST_SHELL_MODULE || window.FUMAN_WATCHLIST_SHELL_INSTANCE) { existing.dataset.fumanLoaded = "1"; resolve(window.FUMAN_WATCHLIST_SHELL_MODULE || window.FUMAN_WATCHLIST_SHELL_INSTANCE); return; }
        existing.addEventListener("load", () => { existing.dataset.fumanLoaded = "1"; resolve(window.FUMAN_WATCHLIST_SHELL_MODULE || window.FUMAN_WATCHLIST_SHELL_INSTANCE); }, { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      const script = document.createElement("script");
      const bootVersion = window.FUMAN_TERMINAL_BOOT?.version || window.FUMAN_TERMINAL_VERSION || "public-terminal-fast";
      script.src = `terminal-watchlist-shell.js?v=${encodeURIComponent(`${bootVersion}-${VERSION}`)}`;
      script.async = true;
      script.dataset.fumanWatchlistShell = "1";
      script.addEventListener("load", () => { script.dataset.fumanLoaded = "1"; resolve(window.FUMAN_WATCHLIST_SHELL_MODULE || window.FUMAN_WATCHLIST_SHELL_INSTANCE); }, { once: true });
      script.addEventListener("error", reject, { once: true });
      document.head.appendChild(script);
    }).catch((error) => {
      shellPromise = null;
      throw error;
    });
    return shellPromise;
  }

  async function ensureShell() {
    await loadShellScript();
    return window.FUMAN_WATCHLIST_SHELL_MODULE?.install?.({}) || window.FUMAN_WATCHLIST_SHELL_INSTANCE || null;
  }

  async function callShell(method, ...args) {
    const shell = await ensureShell().catch(() => null);
    if (shell && typeof shell[method] === "function") return shell[method](...args);
    return false;
  }

  function install() {
    const api = {
      version: VERSION,
      mode: "old-watchlist-page-deleted-rich-shell-only",
      renderWatchlist: () => callShell("render"),
      refreshSelectedWatchlistQuote: () => callShell("refreshSelected"),
      addToWatchlist: () => callShell("addFromInput"),
      removeFromWatchlist: (code) => callShell("removeCode", code),
      runSelfCheck: async () => {
        const shell = await ensureShell().catch(() => null);
        shell?.render?.();
        return {
          ok: Boolean(shell),
          version: VERSION,
          shellVersion: window.FUMAN_WATCHLIST_SHELL_MODULE?.version || window.FUMAN_WATCHLIST_SHELL_INSTANCE?.version || "",
          mode: "old-page-deleted",
          at: new Date().toISOString(),
        };
      },
    };
    window.FUMAN_WATCHLIST_FORCE_ADD = api.addToWatchlist;
    window.FUMAN_WATCHLIST_MODULE_FORCE_ADD = api.addToWatchlist;
    window.removeFromWatchlist = api.removeFromWatchlist;
    ensureShell().then((shell) => shell?.render?.()).catch(() => undefined);
    return api;
  }

  window.FUMAN_WATCHLIST_MODULE = { version: VERSION, install };
  window.FUMAN_WATCHLIST_MODULE_FORCE_ADD = () => callShell("addFromInput");
  window.FUMAN_WATCHLIST_FORCE_ADD = window.FUMAN_WATCHLIST_MODULE_FORCE_ADD;
  window.removeFromWatchlist = (code) => callShell("removeCode", code);
  window.FUMAN_TERMINAL_MODULES?.markLoaded?.("watchlist");
})();
