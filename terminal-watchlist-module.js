(function () {
  "use strict";

  const VERSION = "watchlist-legacy-shim-20260627-01";
  const WATCHLIST_KEY = "fuman_watchlist";
  const MOBILE_WATCHLIST_KEY = "fuman_mobile_watchlist_v1";
  let shellPromise = null;
  let lastContext = null;

  function normalizeCode(value) {
    return String(value ?? "").trim().match(/\d{4}/)?.[0] || "";
  }

  function readList() {
    try {
      const rows = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || "[]");
      return Array.isArray(rows)
        ? rows.map((item) => ({ ...item, code: normalizeCode(item?.code || item?.symbol || item?.Code) })).filter((item) => item.code)
        : [];
    } catch {
      return [];
    }
  }

  function writeList(rows) {
    const value = JSON.stringify(rows.slice(0, 80));
    localStorage.setItem(WATCHLIST_KEY, value);
    localStorage.setItem(MOBILE_WATCHLIST_KEY, value);
  }

  function findInput() {
    const doc = lastContext?.document || document;
    const inputs = [
      doc.querySelector("#watchlist-search-input"),
      ...doc.querySelectorAll("#watchlist-view .watchlist-entry-input"),
      ...doc.querySelectorAll("#watchlist-view input[type='text']"),
    ].filter(Boolean);
    return inputs.find((input) => !input.readOnly && !input.disabled && normalizeCode(input.value))
      || inputs.find((input) => !input.readOnly && !input.disabled)
      || null;
  }

  function fallbackAddFromInput() {
    const input = findInput();
    const code = normalizeCode(input?.value);
    if (!code) return false;
    const rows = readList();
    if (!rows.some((item) => item.code === code)) rows.unshift({ code, name: code, addedAt: Date.now() });
    writeList(rows);
    if (input) input.value = "";
    return code;
  }

  function fallbackRemove(code) {
    const target = normalizeCode(code);
    if (!target) return false;
    writeList(readList().filter((item) => item.code !== target));
    return true;
  }

  function loadShellScript() {
    if (window.FUMAN_WATCHLIST_SHELL_MODULE || window.FUMAN_WATCHLIST_SHELL_INSTANCE) {
      return Promise.resolve(window.FUMAN_WATCHLIST_SHELL_MODULE || window.FUMAN_WATCHLIST_SHELL_INSTANCE);
    }
    if (shellPromise) return shellPromise;
    shellPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-fuman-watchlist-shell]");
      if (existing) {
        existing.addEventListener("load", () => resolve(window.FUMAN_WATCHLIST_SHELL_MODULE || window.FUMAN_WATCHLIST_SHELL_INSTANCE), { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      const script = document.createElement("script");
      const bootVersion = window.FUMAN_TERMINAL_BOOT?.version || window.FUMAN_TERMINAL_VERSION || "public-terminal-fast";
      script.src = `terminal-watchlist-shell.js?v=${encodeURIComponent(`${bootVersion}-${VERSION}`)}`;
      script.async = true;
      script.dataset.fumanWatchlistShell = "1";
      script.addEventListener("load", () => resolve(window.FUMAN_WATCHLIST_SHELL_MODULE || window.FUMAN_WATCHLIST_SHELL_INSTANCE), { once: true });
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

  async function renderWatchlist() {
    const shell = await ensureShell().catch(() => null);
    if (shell?.render) {
      shell.render();
      return true;
    }
    return false;
  }

  async function addToWatchlist() {
    const code = fallbackAddFromInput();
    const shell = await ensureShell().catch(() => null);
    if (code && shell?.selectCode) shell.selectCode(code);
    if (code && shell?.enrichStockMeta) shell.enrichStockMeta(code).catch?.(() => undefined);
    else if (shell?.render) shell.render();
    return Boolean(code);
  }

  async function removeFromWatchlist(code) {
    const shell = await ensureShell().catch(() => null);
    if (shell?.removeCode) {
      shell.removeCode(code);
      return true;
    }
    if (shell?.removeFromWatchlist) {
      shell.removeFromWatchlist(code);
      return true;
    }
    const ok = fallbackRemove(code);
    await renderWatchlist().catch(() => undefined);
    return ok;
  }

  async function refreshSelectedWatchlistQuote() {
    const shell = await ensureShell().catch(() => null);
    if (shell?.refreshSelected) {
      shell.refreshSelected();
      return true;
    }
    return renderWatchlist();
  }

  async function runSelfCheck() {
    const input = findInput();
    const previous = input?.value || "";
    if (input) input.value = "2327";
    const added = await addToWatchlist();
    const exists = readList().some((item) => item.code === "2327");
    if (input) input.value = previous;
    return {
      ok: Boolean(added && exists),
      version: VERSION,
      shellVersion: window.FUMAN_WATCHLIST_SHELL_MODULE?.version || window.FUMAN_WATCHLIST_SHELL_INSTANCE?.version || "",
      at: new Date().toISOString(),
    };
  }

  function install(context = {}) {
    lastContext = context || lastContext;
    const api = {
      version: VERSION,
      mode: "legacy-shim-to-rich-shell",
      renderWatchlist,
      refreshSelectedWatchlistQuote,
      addToWatchlist,
      removeFromWatchlist,
      runSelfCheck,
    };
    window.FUMAN_WATCHLIST_FORCE_ADD = addToWatchlist;
    window.FUMAN_WATCHLIST_MODULE_FORCE_ADD = addToWatchlist;
    window.removeFromWatchlist = removeFromWatchlist;
    ensureShell().then((shell) => shell?.render?.()).catch(() => undefined);
    return api;
  }

  window.FUMAN_WATCHLIST_MODULE = { version: VERSION, install };
  window.FUMAN_WATCHLIST_MODULE_FORCE_ADD = addToWatchlist;
  window.FUMAN_WATCHLIST_FORCE_ADD = addToWatchlist;
  window.removeFromWatchlist = removeFromWatchlist;
  window.FUMAN_TERMINAL_MODULES?.markLoaded?.("watchlist");
})();
