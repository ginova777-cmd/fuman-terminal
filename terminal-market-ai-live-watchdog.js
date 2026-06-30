(function installMarketAiLiveWatchdog() {
  if (window.__fumanMarketAiLiveWatchdog) return;
  window.__fumanMarketAiLiveWatchdog = "20260630-01";

  const endpoint = "/api/market-ai-live?canvas=1&compact=1&shell=1&limit=40";
  const loadingPattern = /載入今日正式 AI 判讀|載入最新 AI 判讀|等待市場資料載入|不顯示舊 panel cache/;
  let loading = false;
  let lastSignature = "";
  let lastPayload = null;
  let lastFetchedAt = 0;

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
  const arr = (value) => Array.isArray(value) ? value : [];
  const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const text = (el) => String(el?.textContent || "").replace(/\s+/g, " ").trim();
  const dateLabel = (value) => {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.length >= 8 ? `${digits.slice(4, 6)}/${digits.slice(6, 8)}` : "--";
  };
  const visible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden" && el.hidden !== true;
  };

  function isAiMode() {
    const market = document.querySelector("#market-view");
    if (!market || !visible(market)) return false;
    const title = text(market.querySelector(".page-header h1"));
    const activeMode = market.querySelector(".market-mode-tabs [data-market-mode].active")?.dataset?.marketMode || "";
    return activeMode === "ai" || /AI/.test(title) || market.classList.contains("market-ai-mode");
  }

  function findPanel() {
    const market = document.querySelector("#market-view");
    if (!market) return null;
    const direct = market.querySelector("[data-market-api-ai],.market-ai-panel");
    if (direct) return direct;
    const loadingNode = [...market.querySelectorAll("section,article,div")]
      .find((node) => visible(node) && loadingPattern.test(text(node)));
    if (loadingNode) return loadingNode.closest(".market-ai-panel,.market-ai-block,section,div") || loadingNode;
    return null;
  }

  function ensurePanel() {
    let panel = findPanel();
    if (panel) return panel;
    const market = document.querySelector("#market-view");
    if (!market || !isAiMode()) return null;
    panel = document.createElement("section");
    panel.className = "market-ai-panel";
    market.appendChild(panel);
    return panel;
  }

  function stockRow(stock, index) {
    return `<article class="market-ai-stock-row">
      <div class="market-ai-rank">#${index + 1}</div>
      <div>
        <h4><span class="market-ai-code">${esc(stock.code || "--")}</span><span class="market-ai-name">${esc(stock.name || "--")}</span></h4>
        <p>${esc(stock.source || "正式 API")}，分數 ${esc(stock.score ?? "--")}，漲幅 ${num(stock.pct ?? stock.percent).toFixed(2)}%。</p>
      </div>
      <div><span class="market-ai-chip">${esc(stock.industry || "--")}</span></div>
      <div class="market-ai-score"><small>分數</small><strong>${esc(stock.score ?? "--")}</strong></div>
      <div class="market-ai-tags">${arr(stock.tags).slice(0, 5).map((tag) => `<span>${esc(tag)}</span>`).join("")}</div>
    </article>`;
  }

  function bindFilters(panel) {
    panel.querySelectorAll("[data-market-ai-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        panel.querySelectorAll("[data-market-ai-filter]").forEach((item) => item.classList.toggle("active", item === button));
      });
    });
  }

  function renderPayload(panel, payload) {
    const dashboard = payload?.dashboard || {};
    const freshness = payload?.dataFreshness || {};
    const summary = payload?.summary || {};
    const issues = arr(freshness.sourceIssues);
    const stale = arr(freshness.staleSources);
    const points = arr(payload?.todayPoints);
    const risks = arr(payload?.riskNotes);
    const reasoning = arr(payload?.reasoning);
    const stocks = arr(payload?.hotStocks);
    const counts = summary.filterCounts || {};
    const tradeDate = dashboard.tradeDate || freshness.heatmapTradeDate || freshness.radarTradeDate || payload?.marketSession?.today;
    const sourceStatus = issues.length
      ? `水源異常：${issues.join("；")}`
      : stale.length
        ? `舊資料已排除：${stale.join("、")}`
        : "今日正式水源可用";
    const signature = JSON.stringify([
      payload?.updatedAt,
      tradeDate,
      dashboard.sample,
      dashboard.up,
      dashboard.down,
      dashboard.bias,
      sourceStatus,
      stocks.map((stock) => `${stock.code}:${stock.score}`).join("|"),
    ]);
    if (signature === lastSignature && panel.querySelector("[data-market-ai-live-watchdog]")) return;
    lastSignature = signature;
    panel.dataset.marketApiAi = "live-contract-watchdog";
    panel.dataset.marketAiStableSignature = signature;
    panel.innerHTML = `
      <section class="market-ai-hero-board" data-market-ai-live-watchdog="1">
        <article class="market-ai-card hero">
          <small>盤中決策總覽 · 資料 ${esc(dateLabel(tradeDate))}</small>
          <strong>${esc(dashboard.bias || summary.bias || "等待方向")}</strong>
          <p>${esc(sourceStatus)}。${esc(payload?.priorityObservation?.text || "依正式 API-only contract 判讀。")}</p>
          <div class="market-ai-hero-metrics">
            <span>樣本<b>${num(dashboard.sample || summary.sample).toLocaleString("zh-TW")}</b></span>
            <span>上漲<b>${num(dashboard.up || summary.up).toLocaleString("zh-TW")}</b></span>
            <span>下跌<b>${num(dashboard.down || summary.down).toLocaleString("zh-TW")}</b></span>
            <span>信心<b>${esc(dashboard.confidence || summary.confidence || "觀察")}</b></span>
          </div>
        </article>
      </section>
      <section class="market-ai-summary">
        <article class="market-ai-card"><small>操作建議</small><strong>${esc(dashboard.action || summary.action || "等待方向")}</strong><p>${esc(payload?.priorityObservation?.text || "不使用舊 panel cache 當正常資料。")}</p></article>
        <article class="market-ai-card ${issues.length ? "warning" : ""}"><small>水源狀態</small><strong>${issues.length ? "水源異常" : "水源正常"}</strong><p>${esc(sourceStatus)}</p></article>
        <article class="market-ai-card"><small>正式 contract</small><strong>${esc(payload?.source || payload?.cacheSource || "api/market-ai-live")}</strong><p>heatmap ${esc(freshness.heatmapTradeDate || "--")} / radar ${esc(freshness.radarTradeDate || "--")}；舊 snapshot 不作正常判讀。</p></article>
      </section>
      <nav class="market-ai-filterbar" aria-label="AI 觀察分類">
        ${[
          ["all", "全部", counts.all || stocks.length],
          ["momentum", "動能強", counts.momentum || 0],
          ["institution", "法人買超", counts.institution || 0],
          ["intraday", "當沖熱", counts.intraday || 0],
          ["risk", "風險高", counts.risk || risks.length],
        ].map(([key, label, count], index) => `<button type="button" class="${index === 0 ? "active" : ""}" data-market-ai-filter="${key}">${label}<b>${num(count)}</b></button>`).join("")}
      </nav>
      <section class="market-ai-main">
        <article class="market-ai-block">
          <h3>AI 今日重點</h3>
          <small>${esc(dateLabel(tradeDate))} 最新資料</small>
          <div class="market-ai-list">${(points.length ? points : [sourceStatus]).slice(0, 5).map((item, index) => `<div class="market-ai-point"><b>${index + 1}</b><span>${esc(item)}</span></div>`).join("")}</div>
        </article>
        <aside class="market-ai-block">
          <h3>風險提醒</h3>
          <small>${risks.length} 則</small>
          <div class="market-ai-risk">${(risks.length ? risks : [{ title: issues.length ? "水源異常" : "水源正常", text: sourceStatus }]).slice(0, 4).map((note) => `<article><h4>${esc(note.title || "風險")}</h4><p>${esc(note.text || note.reason || sourceStatus)}</p></article>`).join("")}</div>
        </aside>
      </section>
      <section class="market-ai-block">
        <h3>AI 判讀依據</h3>
        <small>正式 API-only contract</small>
        <div class="market-ai-evidence">${(reasoning.length ? reasoning : [{ key: "來源", title: payload?.source || "api/market-ai-live", text: sourceStatus }]).slice(0, 5).map((item) => `<article><small>${esc(item.key || "依據")}</small><strong>${esc(item.title || "--")}</strong><p>${esc(item.text || sourceStatus)}</p></article>`).join("")}</div>
      </section>
      <section class="market-ai-block">
        <h3>熱門觀察股</h3>
        <small>依正式 API 排序</small>
        <div class="market-ai-hot">${stocks.length ? stocks.slice(0, 10).map(stockRow).join("") : '<div class="empty-state">目前正式 API 尚未產生觀察股，未回退舊 cache。</div>'}</div>
      </section>`;
    bindFilters(panel);
  }

  async function refresh(force = false) {
    if (loading || !isAiMode()) return;
    const panel = ensurePanel();
    if (!panel) return;
    const bodyText = text(panel);
    const hasWatchdogDom = Boolean(panel.querySelector("[data-market-ai-live-watchdog]"));
    if (!force && !loadingPattern.test(bodyText) && hasWatchdogDom) return;
    if (!force && lastPayload && Date.now() - lastFetchedAt < 30000) {
      renderPayload(panel, lastPayload);
      return;
    }
    loading = true;
    try {
      const response = await fetch(`${endpoint}&t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-store" },
      });
      if (!response.ok) throw new Error(`market_ai_live_http_${response.status}`);
      lastPayload = await response.json();
      lastFetchedAt = Date.now();
      renderPayload(panel, lastPayload);
    } catch (error) {
      panel.dataset.marketApiAi = "live-contract-watchdog-error";
      panel.innerHTML = `<div class="empty-state">AI 判讀正式水源讀取失敗：${esc(error?.message || error)}。不使用舊 panel cache 當正常資料。</div>`;
    } finally {
      loading = false;
    }
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest?.("[data-market-mode],aside.sidebar a[data-view='market']")) {
      setTimeout(() => refresh(true), 450);
      setTimeout(() => refresh(true), 1800);
    }
  }, true);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh(true);
  }, { passive: true });
  window.addEventListener("focus", () => refresh(true), { passive: true });
  setTimeout(() => refresh(true), 2200);
  setInterval(() => refresh(false), 900);
})();
