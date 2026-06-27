(function () {
  "use strict";

  const VERSION = "watchlist-rich-shell-20260627-01";
  const WATCHLIST_KEY = "fuman_watchlist";
  let installed = false;
  let selectedCode = "";
  let quoteCache = new Map();

  function install() {
    if (installed) return window.FUMAN_WATCHLIST_SHELL_INSTANCE;
    installed = true;
    const instance = {
      version: VERSION,
      mode: "rich-watchlist-shell",
      render,
      addFromInput,
      selectCode,
      refreshSelected,
    };
    window.FUMAN_WATCHLIST_SHELL_INSTANCE = instance;
    document.documentElement.dataset.fumanWatchlistModule = instance.mode;
    installStyle();
    installEvents();
    render();
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

  function number(value) {
    const n = Number(String(value ?? "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function formatPrice(value) {
    const n = number(value);
    if (!n) return "--";
    return n.toLocaleString("zh-TW", { minimumFractionDigits: n >= 100 ? 2 : 2, maximumFractionDigits: 2 });
  }

  function formatPct(value) {
    const n = number(value);
    return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  }

  function formatLots(value) {
    const n = Math.round(number(value));
    if (!n) return "--";
    return n.toLocaleString("zh-TW");
  }

  function readInputCode() {
    const input = document.querySelector("#watchlist-search-input");
    return String(input?.value || "").trim().match(/\d{4}/)?.[0] || "";
  }

  function addFromInput() {
    const code = readInputCode();
    if (!code) return false;
    const input = document.querySelector("#watchlist-search-input");
    const rows = readList();
    if (!rows.some((item) => item.code === code)) {
      rows.unshift({ code, name: code, addedAt: Date.now() });
      writeList(rows);
    }
    if (input) input.value = "";
    selectedCode = code;
    render();
    hydrateQuote(code);
    return true;
  }

  function removeCode(code) {
    writeList(readList().filter((item) => item.code !== code));
    if (selectedCode === code) selectedCode = "";
    render();
  }

  function listWithCache() {
    return readList().map((item) => ({ ...item, ...(quoteCache.get(item.code) || {}) }));
  }

  function render() {
    installStyle();
    const rows = listWithCache();
    const count = document.querySelector("#watchlist-count");
    if (count) count.textContent = String(rows.length);
    const refresh = document.querySelector("#watchlist-refresh");
    if (refresh) {
      const now = new Date();
      refresh.textContent = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} 最新收盤 ｜ 更新 ${now.toLocaleTimeString("zh-TW", { hour12: false })}`;
    }
    const box = document.querySelector("#watchlist-stocks");
    if (!box) return;
    if (!rows.length) {
      box.innerHTML = '<div class="watch-mobile-empty">尚未新增自選股，請輸入股票代號後點新增</div>';
      renderEmptyAnalysis();
      return;
    }
    if (!selectedCode || !rows.some((row) => row.code === selectedCode)) selectedCode = rows[0].code;
    box.innerHTML = rows.map((item) => cardHtml(item)).join("");
    renderAnalysis(rows.find((item) => item.code === selectedCode) || rows[0]);
    rows.slice(0, 8).forEach((item) => hydrateQuote(item.code));
  }

  function cardHtml(item) {
    const pct = number(item.percent);
    const up = pct >= 0;
    return `
      <article class="watchlist-card ${item.code === selectedCode ? "selected" : ""}" data-code="${escapeText(item.code)}" data-name="${escapeText(item.name || item.code)}">
        <div class="watch-card-main">
          <div class="watch-card-title">
            <span class="watch-code">${escapeText(item.code)}</span>
            <span class="watch-name">${escapeText(item.name || item.code)}</span>
            <span class="watch-market-badge">上市</span>
          </div>
          <div class="watch-card-flow">
            <span>外 ${item.foreignText || "--"}</span>
            <span>投 ${item.trustText || "--"}</span>
          </div>
        </div>
        <div class="watch-card-price">
          <strong>${formatPrice(item.close)}</strong>
          <small class="${up ? "watch-up" : "watch-down"}">${formatPct(pct)}</small>
        </div>
        <button class="watch-alert" type="button" aria-label="提醒 ${escapeText(item.code)}">♧</button>
        <button class="watch-remove" type="button" data-watch-remove="${escapeText(item.code)}" aria-label="移除 ${escapeText(item.code)}">×</button>
      </article>
    `;
  }

  function renderEmptyAnalysis() {
    const panel = document.querySelector("#watchlist-analysis");
    if (!panel) return;
    panel.innerHTML = '<div class="watch-mobile-empty">點選股票查看 AI 個股判讀</div>';
  }

  function renderAnalysis(item = {}) {
    const panel = document.querySelector("#watchlist-analysis");
    if (!panel) return;
    const code = item.code || "--";
    const name = item.name || code;
    const pct = number(item.percent);
    const close = number(item.close);
    const prev = close && pct !== -100 ? close / (1 + pct / 100) : number(item.prevClose);
    const change = close && prev ? close - prev : number(item.change);
    const support = close ? close * 0.997 : 0;
    const pressure1 = close ? close * 1.012 : 0;
    const pressure2 = close ? close * 1.026 : 0;
    const pressure3 = close ? close * 1.04 : 0;
    const weak = pct < 0;
    const trend = pct >= 3 ? "強勢整理" : pct >= 0 ? "偏多整理" : "弱勢整理";
    const action = pct >= 3 ? "等待拉回" : "等待轉強";
    const score = Math.max(0, Math.min(100, Math.round(50 + pct * 8)));
    panel.innerHTML = `
      <div class="watch-analysis-panel ta-dashboard blackbean-stock-detail">
        <section class="watch-action-row">
          <label>股票代碼
            <input type="text" value="${escapeText(code)}" readonly>
          </label>
          <button class="primary" type="button" data-watch-load>⌁ 載入資料</button>
          <button type="button" data-watch-analyze>☊ 分析 <b>${Math.max(1, Math.round(score / 10))}/10</b></button>
        </section>

        <section class="watch-summary-grid">
          <article class="watch-metric"><span>標的</span><strong>${escapeText(code)} ${escapeText(name)}</strong></article>
          <article class="watch-metric"><span>趨勢判讀</span><strong>${trend}</strong></article>
          <article class="watch-metric ${weak ? "good" : "warn"}"><span>漲跌幅</span><strong class="${weak ? "watch-down" : "watch-up"}">${formatPct(pct)}</strong><em>前收 ${formatPrice(prev)} → 現價 ${formatPrice(close)}</em></article>
          <article class="watch-metric"><span>符合策略</span><strong>${score >= 70 ? "2" : score >= 58 ? "1" : "0"}</strong><em>待策略確認</em></article>
        </section>

        <section class="watch-detail-sections">
          <article class="watch-detail-section-card trend ${weak ? "good" : "warn"}"><span>趨勢</span><strong>${trend}</strong><b>${formatPct(pct)}</b><em>收盤位於日內區間參考。</em></article>
          <article class="watch-detail-section-card price"><span>價位</span><strong>現價 ${formatPrice(close)}</strong><b>${formatPrice(support)} / ${formatPrice(pressure1)}</b><em>支撐觀察：${formatPrice(support)}；壓力觀察：${formatPrice(pressure1)}、${formatPrice(pressure2)}、${formatPrice(pressure3)}。</em></article>
          <article class="watch-detail-section-card chip"><span>籌碼</span><strong>籌碼待確認</strong><b>籌碼 ${Math.max(0, score - 37)} / 主力 ${Math.max(0, score - 41)}</b><em>法人 10 日淨買賣需搭配盤後資料確認。</em></article>
          <article class="watch-detail-section-card risk"><span>風險</span><strong>風險可控</strong><b>0 則</b><em>目前沒有明顯短線風險旗標，仍需搭配大盤與成交量確認。</em></article>
          <article class="watch-detail-section-card action"><span>操作提醒</span><strong>${action}</strong><b>支撐 ${formatPrice(support)}</b><em>先等待量價或籌碼轉強，再把它放進主觀察清單。</em></article>
        </section>

        <section class="watch-note-row">
          <article><b>1</b><small>${escapeText(code)} ${escapeText(name)}：${trend}，漲跌幅 ${formatPct(pct)}。</small></article>
          <article><b>2</b><small>支撐觀察：${formatPrice(support)}；壓力觀察：${formatPrice(pressure1)}、${formatPrice(pressure2)}、${formatPrice(pressure3)}。</small></article>
          <article><b>3</b><small>目前沒有明顯短線風險旗標，但仍需搭配大盤與成交量確認。</small></article>
        </section>

        <section class="ta-period-panel">
          <nav class="ta-timeframes" aria-label="技術分析週期">
            <button class="ta-timeframe ta-dashboard-tab active" type="button">等待策略入選</button>
          </nav>
        </section>
      </div>
    `;
  }

  async function hydrateQuote(code) {
    if (!code || quoteCache.has(code) && Date.now() - number(quoteCache.get(code).quoteAt) < 30000) return quoteCache.get(code);
    try {
      const response = await fetch(`/api/proxy?code=${encodeURIComponent(code)}&t=${Date.now()}`, { cache: "no-store" });
      const data = await response.json();
      const item = data?.msgArray?.[0] || {};
      const close = parsePrice(item.z, item.pz, item.a, item.b, item.o);
      const prev = parsePrice(item.y, item.o, item.z);
      const change = close && prev ? close - prev : 0;
      const percent = prev ? (change / prev) * 100 : 0;
      const quote = {
        code,
        name: item.n || code,
        close,
        prevClose: prev,
        change,
        percent,
        volume: parsePrice(item.v, item.tv),
        quoteAt: Date.now(),
      };
      quoteCache.set(code, quote);
      const rows = readList().map((row) => row.code === code ? { ...row, name: quote.name || row.name } : row);
      writeList(rows);
      const activeBefore = selectedCode;
      render();
      selectedCode = activeBefore || selectedCode;
      return quote;
    } catch {
      return null;
    }
  }

  function parsePrice(...values) {
    for (const value of values) {
      const text = String(value ?? "").split("_").find(Boolean) || "";
      const parsed = number(text);
      if (parsed > 0) return parsed;
    }
    return 0;
  }

  function selectCode(code) {
    if (!code) return;
    selectedCode = code;
    render();
    hydrateQuote(code);
  }

  function refreshSelected() {
    if (selectedCode) hydrateQuote(selectedCode);
    else render();
  }

  function installEvents() {
    document.addEventListener("click", (event) => {
      const add = event.target.closest?.("#watchlist-add-btn");
      if (add) {
        event.preventDefault();
        event.stopPropagation();
        addFromInput();
        return;
      }
      const remove = event.target.closest?.("[data-watch-remove]");
      if (remove) {
        event.preventDefault();
        event.stopPropagation();
        removeCode(remove.dataset.watchRemove || "");
        return;
      }
      const refresh = event.target.closest?.("[data-watchlist-refresh]");
      if (refresh) {
        event.preventDefault();
        refreshSelected();
        return;
      }
      const card = event.target.closest?.(".watchlist-card[data-code]");
      if (card) {
        event.preventDefault();
        selectCode(card.dataset.code || "");
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

  function installStyle() {
    if (document.querySelector("#fuman-watchlist-rich-shell-style")) return;
    const style = document.createElement("style");
    style.id = "fuman-watchlist-rich-shell-style";
    style.textContent = `
      #watchlist-view.watchlist-view-rich { padding: 20px; }
      #watchlist-view .watchlist-rich-header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:22px; }
      #watchlist-view .watchlist-rich-header h1 { margin:0; color:#f7f7f8; font-size:24px; font-weight:950; }
      #watchlist-view .watchlist-refresh-button { width:42px; height:42px; border-radius:12px; border:1px solid rgba(226,178,87,.32); background:rgba(8,16,27,.9); color:#9fb2cf; font-size:20px; cursor:pointer; }
      #watchlist-view .watchlist-rich-shell { border:1px solid rgba(226,178,87,.28); border-radius:8px; background:linear-gradient(115deg,rgba(32,17,17,.92),rgba(8,22,39,.96)); overflow:hidden; }
      #watchlist-view .watchlist-rich-shell-head { padding:18px 20px; border-bottom:1px solid rgba(226,178,87,.18); }
      #watchlist-view .watchlist-rich-shell-head h2 { margin:0 0 8px; color:#f7f7f8; font-size:18px; }
      #watchlist-view .watchlist-rich-shell-head p, #watchlist-view .watchlist-list-card p { margin:0; color:#91a0bb; font-size:13px; }
      #watchlist-view .watchlist-layout { display:grid; grid-template-columns:396px minmax(0,1fr); gap:16px; padding:16px 18px 18px; min-height:620px; background:rgba(6,13,22,.55); }
      #watchlist-view .watchlist-list-pane { min-width:0; }
      #watchlist-view .watchlist-list-card { border:1px solid rgba(226,178,87,.35); border-radius:8px; padding:14px; background:rgba(10,20,30,.78); }
      #watchlist-view .watchlist-list-title { display:flex; align-items:center; justify-content:space-between; margin-bottom:4px; }
      #watchlist-view .watchlist-list-title h3 { margin:0; color:#f7f7f8; font-size:16px; }
      #watchlist-view #watchlist-count { display:inline-flex; align-items:center; justify-content:center; min-width:28px; height:18px; border-radius:999px; background:rgba(239,83,41,.18); color:#f6b56a; font-size:12px; font-weight:900; }
      #watchlist-view .watchlist-entry-form { display:grid; grid-template-columns:minmax(0,1fr)48px; gap:10px; margin:14px 0; }
      #watchlist-view .watchlist-entry-input { height:48px; border:1px solid rgba(119,146,184,.36); border-radius:8px; background:rgba(8,19,31,.92); color:#eef6ff; padding:0 14px; font-size:15px; font-weight:900; }
      #watchlist-view .watchlist-entry-add { width:48px; height:48px; border:0; border-radius:9px; background:linear-gradient(135deg,#f1b544,#f39a2f); color:#6d4212; font-size:26px; font-weight:950; cursor:pointer; }
      #watchlist-view .watchlist-stock-list { display:grid; gap:8px; max-height:560px; overflow:auto; padding-right:4px; }
      #watchlist-view .watchlist-card { position:relative; display:grid; grid-template-columns:minmax(0,1fr)96px 22px 18px; align-items:center; gap:8px; border:1px solid rgba(226,178,87,.28); border-radius:8px; background:rgba(15,26,36,.92); color:#eaf1ff; padding:12px; cursor:pointer; }
      #watchlist-view .watchlist-card.selected { border-color:#ef6a23; box-shadow:inset 0 0 0 1px rgba(239,106,35,.4); }
      #watchlist-view .watch-card-title { display:flex; align-items:center; gap:7px; margin-bottom:8px; }
      #watchlist-view .watch-code { font-weight:950; color:#fff; }
      #watchlist-view .watch-name { color:#96a6c0; font-size:12px; }
      #watchlist-view .watch-market-badge { border:1px solid rgba(239,106,35,.35); border-radius:4px; color:#ff8f4c; background:rgba(239,106,35,.12); padding:1px 5px; font-size:11px; font-weight:900; }
      #watchlist-view .watch-card-flow { display:flex; gap:10px; color:#7ce9b4; font-size:12px; font-weight:900; }
      #watchlist-view .watch-card-price { text-align:right; }
      #watchlist-view .watch-card-price strong { display:block; color:#1ee887; font-size:17px; }
      #watchlist-view .watch-card-price small, #watchlist-view .watch-down { color:#21e390; }
      #watchlist-view .watch-up { color:#ff4f5f; }
      #watchlist-view .watch-alert, #watchlist-view .watch-remove { border:0; background:transparent; color:#b7a27d; cursor:pointer; font-size:18px; }
      #watchlist-view .watchlist-analysis-pane { min-width:0; }
      #watchlist-view .watch-action-row { display:grid; grid-template-columns:200px minmax(180px,1fr) minmax(180px,1fr); gap:12px; align-items:end; margin-bottom:18px; }
      #watchlist-view .watch-action-row label { display:grid; gap:6px; color:#9aa8bd; font-size:12px; }
      #watchlist-view .watch-action-row input, #watchlist-view .watch-action-row button { height:42px; border-radius:8px; border:1px solid rgba(226,178,87,.3); background:rgba(9,18,29,.92); color:#eef6ff; padding:0 14px; font-weight:900; }
      #watchlist-view .watch-action-row .primary { background:linear-gradient(90deg,#f0c760,#bb8428); color:#16130c; }
      #watchlist-view .watch-summary-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:18px; margin-bottom:18px; }
      #watchlist-view .watch-metric, #watchlist-view .watch-detail-section-card, #watchlist-view .watch-note-row article { border:1px solid rgba(226,178,87,.28); border-radius:8px; background:rgba(11,22,34,.92); padding:18px; }
      #watchlist-view .watch-metric span, #watchlist-view .watch-detail-section-card span { display:block; color:#9aa8bd; font-size:12px; margin-bottom:10px; }
      #watchlist-view .watch-metric strong { display:block; color:#f7f7f8; font-size:25px; line-height:1.1; }
      #watchlist-view .watch-metric em, #watchlist-view .watch-detail-section-card em { display:block; margin-top:8px; color:#91a0bb; font-size:12px; line-height:1.6; font-style:normal; }
      #watchlist-view .watch-detail-sections { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:14px; margin-bottom:18px; }
      #watchlist-view .watch-detail-section-card { min-height:160px; border-top:4px solid #f24b62; }
      #watchlist-view .watch-detail-section-card.price { border-top-color:#727888; }
      #watchlist-view .watch-detail-section-card.chip { border-top-color:#d6a537; }
      #watchlist-view .watch-detail-section-card strong { display:block; color:#f7f7f8; font-size:25px; line-height:1.15; }
      #watchlist-view .watch-detail-section-card b { display:block; margin-top:12px; color:#ffc64a; font-size:14px; }
      #watchlist-view .watch-note-row { display:grid; gap:10px; margin-bottom:16px; }
      #watchlist-view .watch-note-row article { display:flex; align-items:center; gap:14px; padding:12px 14px; }
      #watchlist-view .watch-note-row b { display:inline-grid; place-items:center; width:28px; height:28px; border-radius:9px; background:rgba(239,106,35,.16); color:#f5a64d; }
      #watchlist-view .watch-note-row small { color:#b6c3d7; font-size:13px; }
      #watchlist-view .ta-timeframes { display:flex; gap:8px; }
      #watchlist-view .ta-timeframe { border:1px solid rgba(226,178,87,.35); border-radius:999px; background:rgba(9,18,29,.92); color:#ffd456; padding:8px 14px; font-weight:900; }
      #watchlist-view .watch-mobile-empty { display:grid; place-items:center; min-height:220px; color:#91a0bb; font-weight:900; }
      @media (max-width: 980px) {
        #watchlist-view .watchlist-layout { grid-template-columns:1fr; }
        #watchlist-view .watch-summary-grid, #watchlist-view .watch-detail-sections, #watchlist-view .watch-action-row { grid-template-columns:1fr; }
      }
    `;
    document.head.appendChild(style);
  }

  window.FUMAN_WATCHLIST_SHELL_MODULE = { version: VERSION, install };
  window.FUMAN_WATCHLIST_SHELL_FORCE_ADD = addFromInput;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => install(), { once: true });
  } else {
    install();
  }
  window.FUMAN_TERMINAL_MODULES?.markLoaded?.("watchlist");
})();
