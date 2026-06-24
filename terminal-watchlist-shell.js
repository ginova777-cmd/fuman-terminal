(function () {
  "use strict";

  const VERSION = "public-terminal-fast-20260623-09";
  const WATCHLIST_KEY = "fuman_watchlist";
  let installed = false;

  function install(context = {}) {
    if (installed) return window.FUMAN_WATCHLIST_SHELL_INSTANCE;
    installed = true;
    const instance = {
      version: VERSION,
      mode: "snapshot-watchlist-shell",
      render,
      addFromInput,
      prime,
    };
    window.FUMAN_WATCHLIST_SHELL_INSTANCE = instance;
    document.documentElement.dataset.fumanWatchlistModule = instance.mode;
    installEvents();
    render();
    prime(false);
    return instance;
  }

  function readList() {
    try {
      const rows = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || "[]");
      return Array.isArray(rows) ? rows.filter((item) => item && item.code) : [];
    } catch {
      return [];
    }
  }

  function writeList(rows) {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(rows.slice(0, 80)));
  }

  function escapeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function render() {
    const box = document.querySelector("#watchlist-stocks");
    if (!box) return;
    const rows = readList();
    if (!rows.length) {
      const existingText = String(box.textContent || "").trim();
      const hasExistingRows = box.children.length > 0 && !/尚未新增自選股|正在|loading/i.test(existingText);
      if (hasExistingRows) return;
      box.innerHTML = '<div class="watch-mobile-empty">尚未新增自選股，請輸入股票代號後點新增</div>';
      return;
    }
    box.dataset.fumanWatchlistShell = "1";
    box.innerHTML = rows.map((item) => `
      <div class="watchlist-card" data-code="${escapeText(item.code)}" data-name="${escapeText(item.name || item.code)}">
        <strong>${escapeText(item.name || item.code)}</strong>
        <span>${escapeText(item.code)}</span>
        <em>snapshot-first</em>
      </div>
    `).join("");
  }

  function addFromInput() {
    const input = document.querySelector("#watchlist-search-input");
    const raw = String(input?.value || "").trim();
    const code = raw.match(/\d{4}/)?.[0] || "";
    if (!code) return false;
    const rows = readList();
    if (!rows.some((item) => item.code === code)) rows.unshift({ code, name: code, addedAt: Date.now() });
    writeList(rows);
    if (input) input.value = "";
    render();
    window.FUMAN_DESKTOP_FAST_BUNDLE_PRIME?.(false);
    return true;
  }

  function prime(force = false) {
    return window.FUMAN_DESKTOP_FAST_BUNDLE_PRIME?.(Boolean(force)) || Promise.resolve(0);
  }

  function installEvents() {
    document.addEventListener("click", (event) => {
      const add = event.target.closest?.("#watchlist-add-btn");
      if (add) {
        event.preventDefault();
        event.stopPropagation();
        addFromInput();
      }
      const card = event.target.closest?.(".watchlist-card[data-code]");
      if (card) {
        document.querySelectorAll(".watchlist-card.selected").forEach((item) => item.classList.remove("selected"));
        card.classList.add("selected");
        const analysis = document.querySelector("#watchlist-analysis");
        if (analysis) {
          const code = card.dataset.code || "";
          const name = card.dataset.name || code;
          analysis.innerHTML = `<div class="watch-mobile-empty">${escapeText(code)} ${escapeText(name)}｜自選股快照模式，完整分析背景載入。</div>`;
        }
      }
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      if (event.target?.id === "watchlist-search-input") {
        event.preventDefault();
        addFromInput();
      }
    }, true);
  }

  window.FUMAN_WATCHLIST_SHELL_MODULE = { version: VERSION, install };
  window.FUMAN_TERMINAL_MODULES?.markLoaded?.("watchlist");
})();
