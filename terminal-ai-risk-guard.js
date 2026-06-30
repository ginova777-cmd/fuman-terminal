function installMarketAiRuntimeLine() {
  const box = "display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px;padding:10px 12px;border:1px solid rgba(127,166,255,.28);border-radius:8px;color:#b9c9e8;font-size:13px;font-weight:800";
  const run = () => {
    try {
      const panel = document.querySelector("#market-view");
      const anchor = panel?.querySelector(".market-ai-summary,.market-ai-block");
      if (!anchor) return;
      let line = panel.querySelector(".market-ai-runtime-line");
      if (!line) {
        line = document.createElement("div");
        line.className = "market-ai-runtime-line";
        line.style.cssText = box;
        anchor.before(line);
      }
      const now = new Date();
      const mins = 60 * now.getHours() + now.getMinutes();
      const active = mins >= 540 && mins <= 810;
      line.innerHTML = `<strong>AI 判讀運作時間：09:00-13:30</strong><span>${active ? "運作中" : "盤後模式"}</span><span>${active ? "盤中資料同步判讀" : "收盤/快取資料判讀，不新增即時訊號"}</span>`;
    } catch (error) {}
  };
  setInterval(run, 1500);
  document.addEventListener("click", (event) => {
    event.target.closest?.("[data-market-mode]") && setTimeout(run, 120);
  }, true);
  setTimeout(run, 700);
}

function installMarketAiPriorityRiskGuard() {
  const items = [
    ["事件波動風險最高", "6/17 台指期大結算、6/19 美股四巫日接近；留意尾盤結算、轉倉與避險。"],
    ["個股極端波動風險", "接近 +10% 或 -10% 僅標方向，不當追買；先確認量、族群、隔日開盤。"],
    ["AI 盤中/盤後模式風險", "09:00-13:30 盤中判讀；盤後只做隔日風險提醒，不當秒級下單訊號。"],
  ];
  const run = () => {
    try {
      const block = [...document.querySelectorAll("#market-view .market-ai-block")]
        .find((node) => (node.querySelector("h3")?.textContent || "").includes("風險提醒"));
      const risk = block?.querySelector(".market-ai-risk");
      if (!risk) return;
      risk.querySelectorAll("[data-ai-priority-risk]").forEach((node) => node.remove());
      items.slice().reverse().forEach(([title, text]) => {
        const article = document.createElement("article");
        article.dataset.aiPriorityRisk = "1";
        article.innerHTML = `<h4>${title}</h4><p>${text}</p>`;
        risk.prepend(article);
      });
      const count = block.querySelector("small");
      if (count) count.textContent = "3 則優先風險 + 原始提醒";
    } catch (error) {}
  };
  setInterval(run, 1500);
  document.addEventListener("click", (event) => {
    event.target.closest?.("[data-market-mode]") && setTimeout(run, 120);
  }, true);
  setTimeout(run, 700);
}

function installMarketAiLiveContractPanel() {
  if (window.__fumanMarketAiLiveContractPanel) return;
  window.__fumanMarketAiLiveContractPanel = "20260630-03";

  const endpoint = "/api/market-ai-live?canvas=1&compact=1&shell=1&limit=40";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
  const arr = (value) => Array.isArray(value) ? value : [];
  const num = (value) => Number(value) || 0;
  const dateLabel = (value) => {
    const text = String(value || "").replace(/\D/g, "");
    return text.length >= 8 ? `${text.slice(4, 6)}/${text.slice(6, 8)}` : "--";
  };
  const todayLabel = () => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()).replace("-", "/");

  let loading = false;
  let lastSig = "";
  let suppressObserver = false;

  function aiPanel() {
    return document.querySelector("#market-view .market-ai-panel,#market-view [data-market-api-ai],#market-ai-panel");
  }

  function active() {
    const view = document.querySelector("#market-view");
    return Boolean(view?.classList.contains("active") && document.querySelector('[data-market-mode="ai"]')?.classList.contains("active"));
  }

  function staleLegacyPanel(panel = aiPanel()) {
    if (!panel) return false;
    const text = panel.innerText || "";
    if (panel.dataset.marketApiAi === "loading-contract" && /載入今日正式 AI 判讀\/熱力圖資料中/.test(text)) return false;
    const today = todayLabel();
    const matches = [...text.matchAll(/(?:資料|API|最新資料)\s*(\d{2}\/\d{2})/g)].map((match) => match[1]);
    return matches.some((value) => value && value !== today);
  }

  function setLoadingPanel(reason = "loading") {
    const panel = aiPanel();
    if (!panel) return;
    suppressObserver = true;
    panel.dataset.marketApiAi = "loading-contract";
    panel.innerHTML = `<div class="empty-state">載入今日正式 AI 判讀/熱力圖資料中...<br><small>${esc(reason)}｜不顯示舊 panel cache。</small></div>`;
    suppressObserver = false;
  }

  function row(stock, index) {
    return `<article class="market-ai-stock-row"><div class="market-ai-rank">#${index + 1}</div><div><h4><span class="market-ai-code">${esc(stock.code || "--")}</span><span class="market-ai-name">${esc(stock.name || "--")}</span></h4><p>${esc(stock.source || "AI 判讀")}，分數 ${esc(stock.score ?? "--")}，漲幅 ${num(stock.pct ?? stock.percent).toFixed(2)}%。</p></div><div><span class="market-ai-chip">${esc(stock.industry || "--")}</span></div><div class="market-ai-score"><small>分數</small><strong>${esc(stock.score ?? "--")}</strong></div><div class="market-ai-tags">${arr(stock.tags).slice(0, 5).map((tag) => `<span>${esc(tag)}</span>`).join("")}</div></article>`;
  }

  function paint(payload) {
    const panel = aiPanel();
    if (!panel) return;
    if (panel.dataset.marketApiAi === "live-contract-watchdog" && panel.querySelector("[data-market-ai-live-watchdog]")) return;
    const dashboard = payload?.dashboard || {};
    const fresh = payload?.dataFreshness || {};
    const summary = payload?.summary || {};
    const issues = arr(fresh.sourceIssues);
    const stale = arr(fresh.staleSources);
    const points = arr(payload?.todayPoints);
    const risks = arr(payload?.riskNotes);
    const reasoning = arr(payload?.reasoning);
    const stocks = arr(payload?.hotStocks);
    const tradeDate = dashboard.tradeDate || fresh.heatmapTradeDate || fresh.radarTradeDate || fresh.today || payload?.marketSession?.today;
    const status = issues.length ? `水源異常：${issues.join("；")}` : stale.length ? `舊資料已排除：${stale.join("、")}` : "今日正式水源可用";
    const sig = JSON.stringify([payload?.updatedAt, tradeDate, dashboard.sample, dashboard.up, dashboard.down, dashboard.bias, status, stocks.map((stock) => `${stock.code}:${stock.score}`).join("|")]);
    if (sig === lastSig && panel.dataset.marketApiAi === "live-contract") return;
    lastSig = sig;
    suppressObserver = true;
    panel.dataset.marketApiAi = "live-contract";
    panel.innerHTML = `<section class="market-ai-summary"><article class="market-ai-card hero"><small>盤中決策總覽 · 資料 ${esc(dateLabel(tradeDate))}</small><strong>${esc(dashboard.bias || "等待方向")}</strong><p>${esc(status)}。${esc(payload?.priorityObservation?.text || "等待正式水源判讀。")}</p><div class="market-ai-metrics"><span>樣本數<b>${num(dashboard.sample || summary.sample).toLocaleString("zh-TW")}</b></span><span>上漲<b>${num(dashboard.up || summary.up).toLocaleString("zh-TW")}</b></span><span>下跌<b>${num(dashboard.down || summary.down).toLocaleString("zh-TW")}</b></span><span>信心<b>${esc(dashboard.confidence || summary.confidence || "觀察")}</b></span></div></article><article class="market-ai-card"><small>操作建議</small><strong>${esc(dashboard.action || "等待方向")}</strong><p>${esc(payload?.priorityObservation?.text || "依正式 API 判讀，不讀舊 panel JSON。")}</p></article><article class="market-ai-card ${issues.length ? "warning" : ""}"><small>水源狀態</small><strong>${issues.length ? "水源異常" : "水源正常"}</strong><p>${esc(status)}</p></article><article class="market-ai-card"><small>正式 contract</small><strong>${esc(payload?.source || payload?.cacheSource || "api/market-ai-live")}</strong><p>heatmap ${esc(fresh.heatmapTradeDate || "--")} / radar ${esc(fresh.radarTradeDate || "--")}；舊 snapshot 不作正常判讀。</p></article></section><section class="market-ai-main"><article class="market-ai-block"><h3>AI 今日重點</h3><small>${esc(dateLabel(tradeDate))} 最新資料</small><div class="market-ai-list">${(points.length ? points : [status]).slice(0, 5).map((text, index) => `<div class="market-ai-point"><b>${index + 1}</b><span>${esc(text)}</span></div>`).join("")}</div></article><aside class="market-ai-block"><h3>風險提醒</h3><small>${risks.length} 則</small><div class="market-ai-risk">${(risks.length ? risks : [{ title: issues.length ? "水源異常" : "水源正常", text: status }]).slice(0, 4).map((note) => `<article><h4>${esc(note.title || "風險")}</h4><p>${esc(note.text || note.reason || "")}</p></article>`).join("")}</div></aside></section><section class="market-ai-block"><h3>AI 判讀依據</h3><small>正式 API-only contract</small><div class="market-ai-evidence">${reasoning.slice(0, 5).map((item) => `<article><small>${esc(item.key || "依據")}</small><strong>${esc(item.title || "--")}</strong><p>${esc(item.text || "")}</p></article>`).join("") || `<article><small>來源</small><strong>${esc(payload?.source || "api/market-ai-live")}</strong><p>${esc(status)}</p></article>`}</div></section><section class="market-ai-block"><h3>熱門觀察股</h3><small>依正式 API 排序</small><div class="market-ai-hot">${stocks.length ? stocks.slice(0, 10).map(row).join("") : '<div class="empty-state">目前正式 API 尚未產生觀察股。</div>'}</div></section>`;
    suppressObserver = false;
  }

  async function run(force = false) {
    if (loading || !active()) return;
    const panel = aiPanel();
    if (!panel) return;
    loading = true;
    if (force || staleLegacyPanel(panel)) setLoadingPanel("正式水源同步中");
    try {
      const response = await fetch(`${endpoint}&t=${Date.now()}`, { cache: "no-store", headers: { "Cache-Control": "no-store" } });
      if (!response.ok) throw new Error(`market_ai_live_http_${response.status}`);
      paint(await response.json());
    } catch (error) {
      suppressObserver = true;
      panel.dataset.marketApiAi = "live-contract";
      panel.innerHTML = `<div class="empty-state">AI 判讀正式水源讀取失敗：${esc(error?.message || error)}。不使用舊 panel cache 當正常資料。</div>`;
      suppressObserver = false;
    } finally {
      loading = false;
    }
  }

  function guardStaleFirstPaint() {
    if (!active() || suppressObserver) return;
    const panel = aiPanel();
    if (!staleLegacyPanel(panel)) return;
    setLoadingPanel("攔截舊資料");
    run(true);
  }

  const observer = new MutationObserver(() => queueMicrotask(guardStaleFirstPaint));
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  setInterval(() => run(false), 3000);
  document.addEventListener("pointerdown", (event) => {
    const button = event.target.closest?.('[data-market-mode="ai"],[data-view="market"]');
    if (!button) return;
    queueMicrotask(() => {
      if (active()) {
        setLoadingPanel("切換 AI 判讀");
        run(true);
      }
    });
  }, true);
  document.addEventListener("click", (event) => {
    event.target.closest?.("[data-market-mode],[data-view]") && setTimeout(() => run(true), 0);
  }, true);
  document.addEventListener("visibilitychange", () => { document.hidden || run(true); }, { passive: true });
  window.addEventListener("focus", () => run(true), { passive: true });
  setTimeout(() => run(true), 300);
}

function installMarketHeatmapLiveContractPanel() {
  if (window.__fumanMarketHeatmapLiveContractPanel) return;
  window.__fumanMarketHeatmapLiveContractPanel = "20260630-03";

  const endpoint = "/api/heatmap?limit=999&stocks=999&source=desktop-live-contract";
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
  const arr = (value) => Array.isArray(value) ? value : [];
  const num = (value) => Number(String(value ?? "").replace(/[,+%]/g, "")) || 0;
  const todayKey = () => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()).replace(/\D/g, "");
  const todayLabel = () => `${todayKey().slice(4, 6)}/${todayKey().slice(6, 8)}`;
  const dateLabel = (value) => {
    const text = String(value || "").replace(/\D/g, "");
    return text.length >= 8 ? `${text.slice(4, 6)}/${text.slice(6, 8)}` : todayLabel();
  };
  const nowTime = () => new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  const duringSession = () => {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now).reduce((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
    const mins = 60 * Number(parts.hour || 0) + Number(parts.minute || 0);
    return mins >= 540 && mins <= 810;
  };

  function setMarketChrome(text) {
    const view = document.querySelector("#market-view");
    if (!view) return;
    view.querySelectorAll(".refresh-line").forEach((node) => {
      node.textContent = text;
    });
    const time = view.querySelector(".market-time");
    if (time) time.textContent = `${todayLabel()} ${nowTime()}`;
    const message = view.querySelector("#terminal-message");
    if (message && /等待|快取|snapshot|06\/|2026-06-2/.test(message.textContent || "")) {
      message.textContent = text;
    }
  }

  let loading = false;
  let lastSig = "";
  let suppressObserver = false;

  function heatmapPanel() {
    return document.querySelector("#heatmap");
  }

  function active() {
    const view = document.querySelector("#market-view");
    const aiMode = document.querySelector('[data-market-mode="ai"]')?.classList.contains("active")
      || view?.classList.contains("market-ai-mode");
    return Boolean(view?.classList.contains("active") && !aiMode && heatmapPanel());
  }

  function staleLegacyHeatmap(panel = heatmapPanel()) {
    if (!panel) return false;
    const text = panel.innerText || "";
    if (panel.dataset.heatmapApi === "loading-contract" && /載入今日正式 AI 判讀\/熱力圖資料中/.test(text)) return false;
    const today = todayLabel();
    const shortDates = [...text.matchAll(/\b(\d{2}\/\d{2})\b/g)].map((match) => match[1]);
    const compactDates = [...text.matchAll(/\b(20\d{6})\b/g)].map((match) => dateLabel(match[1]));
    const hyphenDates = [...text.matchAll(/\b20\d{2}-(\d{2})-(\d{2})\b/g)].map((match) => `${match[1]}/${match[2]}`);
    if ([...shortDates, ...compactDates, ...hyphenDates].some((value) => value && value !== today)) return true;
    return Boolean(duringSession() && panel.dataset.heatmapApi !== "live-contract" && /快取|snapshot|收盤|舊/.test(text));
  }

  function setLoadingHeatmap(reason = "loading") {
    const panel = heatmapPanel();
    if (!panel) return;
    suppressObserver = true;
    panel.dataset.heatmapApi = "loading-contract";
    panel.innerHTML = `<div class="empty-state">載入今日正式 AI 判讀/熱力圖資料中...<br><small>${esc(reason)}｜不顯示舊 heatmap cache。</small></div>`;
    setMarketChrome(`載入今日正式 AI 判讀/熱力圖資料中 · ${todayLabel()} ${nowTime()} · ${reason}`);
    suppressObserver = false;
  }

  function heatmapStatus(payload) {
    const health = payload?.health || {};
    const today = todayKey();
    const issues = [];
    if (health.today && String(health.today) !== today) issues.push(`日期 ${health.today} 非今日 ${today}`);
    if (num(health.badDate)) issues.push(`非今日報價 ${num(health.badDate)} 檔`);
    if (num(health.notRealtime)) issues.push(`非即時報價 ${num(health.notRealtime)} 檔`);
    if (num(health.noPrice)) issues.push(`缺價格 ${num(health.noPrice)} 檔`);
    if (health.isHealthy === false) issues.push(`health=false`);
    if (payload?.ok === false) issues.push(payload.error || payload.reason || "api ok=false");
    const stocks = num(health.stockCount || payload?.stockCount);
    const realtime = num(health.realtimeStockCount || payload?.realtimeStockCount);
    const quoteTime = health.quoteTime || payload?.quoteTime || "--";
    return {
      ok: issues.length === 0 && stocks >= 500,
      text: issues.length
        ? `熱力圖水源異常：${issues.join("；")}`
        : `今日正式熱力圖可用：樣本 ${stocks.toLocaleString("zh-TW")}，即時 ${realtime.toLocaleString("zh-TW")}，quote ${esc(quoteTime)}`,
    };
  }

  function stockRow(stock) {
    const pct = num(stock.pct ?? stock.percent ?? stock.changePercent);
    const klass = pct >= 0 ? "tw-up" : "tw-down";
    return `<span class="${klass}">${esc(stock.code || stock.Code || "--")} ${esc(stock.name || stock.Name || "")} ${pct.toFixed(2)}%</span>`;
  }

  function sectorCard(sector) {
    const pct = num(sector.pct ?? sector.percent ?? sector.changePercent);
    const klass = pct >= 0 ? "tw-up" : "tw-down";
    const stocks = arr(sector.stocks || sector.rows).slice(0, 4).map(stockRow).join("");
    return `<article class="sector-card heatmap-live-card ${klass}"><div><small>${esc(sector.name || sector.label || "--")}</small><strong>${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</strong></div><p>上漲 ${num(sector.up).toLocaleString("zh-TW")} / 下跌 ${num(sector.down).toLocaleString("zh-TW")}</p><div class="sector-stocks">${stocks || "<span>等待成分股</span>"}</div></article>`;
  }

  function paintHeatmap(payload) {
    const panel = heatmapPanel();
    if (!panel) return;
    const sectors = arr(payload?.sectors);
    const status = heatmapStatus(payload);
    const tradeDate = payload?.resolvedTradeDate || payload?.tradeDate || payload?.health?.today || todayKey();
    const sig = JSON.stringify([payload?.updatedAt, tradeDate, status.text, sectors.length, payload?.health?.stockCount, payload?.health?.quoteTime]);
    if (sig === lastSig && panel.dataset.heatmapApi === "live-contract") return;
    lastSig = sig;
    suppressObserver = true;
    panel.dataset.heatmapApi = "live-contract";
    panel.innerHTML = status.ok && sectors.length
      ? `<div class="heatmap-health-bar" data-heatmap-live-contract="1"><strong>熱力圖 ${esc(dateLabel(tradeDate))}</strong><span>${esc(status.text)}</span></div><div class="heatmap-grid heatmap-live-grid">${sectors.slice(0, 18).map(sectorCard).join("")}</div>`
      : `<div class="empty-state">熱力圖正式水源未達可用標準：${esc(status.text)}。不使用舊 heatmap cache 當正常資料。</div>`;
    setMarketChrome(`熱力圖 ${dateLabel(tradeDate)} · ${status.text}`);
    suppressObserver = false;
  }

  async function run(force = false) {
    if (loading || !active()) return;
    const panel = heatmapPanel();
    if (!panel) return;
    loading = true;
    if (force || staleLegacyHeatmap(panel) || (duringSession() && panel.dataset.heatmapApi !== "live-contract")) {
      setLoadingHeatmap("正式熱力圖水源同步中");
    }
    try {
      const response = await fetch(`${endpoint}&t=${Date.now()}`, { cache: "no-store", headers: { "Cache-Control": "no-store" } });
      if (!response.ok) throw new Error(`heatmap_http_${response.status}`);
      paintHeatmap(await response.json());
    } catch (error) {
      suppressObserver = true;
      panel.dataset.heatmapApi = "live-contract";
      panel.innerHTML = `<div class="empty-state">熱力圖正式水源讀取失敗：${esc(error?.message || error)}。不使用舊 heatmap cache 當正常資料。</div>`;
      setMarketChrome(`熱力圖正式水源讀取失敗 · ${todayLabel()} ${nowTime()} · 不顯示舊 cache`);
      suppressObserver = false;
    } finally {
      loading = false;
    }
  }

  function guardStaleFirstPaint() {
    if (!active() || suppressObserver) return;
    const panel = heatmapPanel();
    if (!staleLegacyHeatmap(panel)) return;
    setLoadingHeatmap("攔截舊熱力圖資料");
    run(true);
  }

  const observer = new MutationObserver(() => queueMicrotask(guardStaleFirstPaint));
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  queueMicrotask(() => {
    if (active() && heatmapPanel()?.dataset.heatmapApi !== "live-contract") {
      setLoadingHeatmap("啟動市場總覽");
    }
  });
  setInterval(guardStaleFirstPaint, 800);
  setInterval(() => run(false), 5000);
  document.addEventListener("pointerdown", (event) => {
    const button = event.target.closest?.('[data-market-mode="overview"],[data-view="market"]');
    if (!button) return;
    queueMicrotask(() => {
      if (active()) {
        setLoadingHeatmap("切換市場總覽");
        run(true);
      }
    });
  }, true);
  document.addEventListener("click", (event) => {
    event.target.closest?.("[data-market-mode],[data-view]") && setTimeout(() => run(true), 0);
  }, true);
  document.addEventListener("visibilitychange", () => { document.hidden || run(true); }, { passive: true });
  window.addEventListener("focus", () => run(true), { passive: true });
  setTimeout(() => run(true), 40);
  setTimeout(() => run(true), 400);
}

installMarketAiRuntimeLine();
installMarketAiPriorityRiskGuard();
installMarketAiLiveContractPanel();
installMarketHeatmapLiveContractPanel();
