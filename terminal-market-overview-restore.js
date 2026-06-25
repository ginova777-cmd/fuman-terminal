(function restoreMarketOverviewLegacySurface() {
  if (window.__fumanDesktopFastShell === "20260623-09") {
    window.__fumanMarketOverviewRestoreReady = true;
    document.documentElement.dataset.fumanMarketOverviewRestoreSkipped = "desktop-fast-shell";
    if (!window.__fumanMarketOverviewDirectPainter) {
      window.__fumanMarketOverviewDirectPainter = true;
      window.__fumanMarketDirectSectors = [];
      const safeText = (value) => String(value ?? "");
      const esc = (value) => safeText(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
      const list = (value) => Array.isArray(value) ? value : [];
      const num = (value) => Number(safeText(value).replace(/[,+%]/g, "")) || 0;
      const yi = (value) => {
        const n = num(value);
        if (!n) return "--";
        return n >= 100000000 ? `${(n / 100000000).toFixed(n >= 1000000000 ? 1 : 2)} 億` : n.toLocaleString("zh-TW");
      };
      const xhrJson = (url, timeout = 8500) => new Promise((resolve) => {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open("GET", `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, true);
          xhr.timeout = timeout;
          xhr.setRequestHeader("Accept", "application/json");
          xhr.onload = () => {
            if (xhr.status < 200 || xhr.status >= 300) {
              resolve(null);
              return;
            }
            try { resolve(JSON.parse(xhr.responseText || "{}")); } catch (error) { resolve(null); }
          };
          xhr.onerror = () => resolve(null);
          xhr.ontimeout = () => resolve(null);
          xhr.send();
        } catch (error) {
          resolve(null);
        }
      });
      const ensureMarketScaffold = () => {
        const panel = document.querySelector("#market-view");
        if (!panel) return null;
        panel.querySelectorAll(":scope > .desktop-route-shell.desktop-canvas-app").forEach((node) => node.remove());
        panel.classList.add("fuman-market-overview-shell");
        if (!panel.classList.contains("market-ai-mode")) panel.classList.add("market-overview-mode");
        if (!panel.querySelector(":scope > .page-header")) {
          panel.insertAdjacentHTML("afterbegin", `
            <header class="page-header">
              <div>
                <p class="eyebrow">輔滿股票終端</p>
                <h1>市場總覽</h1>
                <span class="refresh-line">等待市場資料</span>
              </div>
              <div class="header-time market-time">--:--</div>
            </header>
          `);
        }
        const header = panel.querySelector(":scope > .page-header");
        let tabs = panel.querySelector("[data-fuman-market-tabs], #market-mode-tabs");
        if (!tabs) {
          tabs = document.createElement("section");
          tabs.className = "market-mode-tabs";
          tabs.dataset.fumanMarketTabs = "1";
          tabs.setAttribute("aria-label", "市場總覽切換");
          tabs.innerHTML = '<button type="button" class="active" data-market-mode="overview">◉ 市場總覽</button><button type="button" data-market-mode="ai">♙ AI 判讀</button>';
          header?.insertAdjacentElement("afterend", tabs);
        }
        let ai = panel.querySelector("[data-market-api-ai], #market-ai-panel");
        if (!ai) {
          ai = document.createElement("section");
          ai.className = "market-ai-panel";
          ai.dataset.marketApiAi = "1";
          ai.hidden = true;
          ai.innerHTML = '<div class="empty-state">載入最新 AI 判讀資料中...</div>';
          tabs.insertAdjacentElement("afterend", ai);
        }
        if (!panel.querySelector(":scope > .metric-grid")) {
          const metric = document.createElement("section");
          metric.className = "metric-grid";
          metric.setAttribute("aria-label", "Market indexes");
          metric.innerHTML = [
            '<article class="metric-card"><span>↗ 加權指數</span><strong>--</strong><em>等待官方資料</em></article>',
            '<article class="metric-card"><span>↗ 櫃買指數</span><strong>--</strong><em>等待官方資料</em></article>',
            '<article class="metric-card"><span>⇅ 台指期夜盤</span><strong>--</strong><em>等待期交所資料</em></article>',
            '<article class="metric-card"><span>☾ 台指次月</span><strong>--</strong><em>等待期交所資料</em></article>'
          ].join("");
          tabs.insertAdjacentElement("afterend", metric);
        }
        if (!panel.querySelector(":scope > .ticker-strip")) {
          const ticker = document.createElement("section");
          ticker.className = "ticker-strip";
          ticker.setAttribute("aria-label", "Market ticker");
          ticker.innerHTML = "<span>等待熱力圖資料...</span>";
          panel.querySelector(":scope > .metric-grid")?.insertAdjacentElement("afterend", ticker);
        }
        if (!panel.querySelector(":scope > .strength-panel")) {
          const strength = document.createElement("section");
          strength.className = "strength-panel";
          strength.innerHTML = `
            <div class="strength-head">
              <div><h2>強勢</h2><p>等待官方資料</p></div>
              <strong>--<span>上漲比例</span></strong>
            </div>
            <div class="stats-row">
              <div><span>上漲</span><strong class="down">--</strong></div>
              <div><span>下跌</span><strong class="up">--</strong></div>
              <div><span>平盤</span><strong>--</strong></div>
              <div><span>成交值</span><strong>--</strong></div>
            </div>
            <div class="balance-bar"><span class="red-zone"></span><span class="mid-zone"></span><span class="green-zone"></span></div>
          `;
          panel.querySelector(":scope > .ticker-strip")?.insertAdjacentElement("afterend", strength);
        }
        if (!panel.querySelector(":scope > .terminal-band")) {
          const band = document.createElement("section");
          band.className = "terminal-band";
          band.setAttribute("aria-label", "Terminal status");
          band.innerHTML = `
            <div class="terminal-log"><span>FMN://market.scan</span><strong id="terminal-message">等待官方資料回應...</strong></div>
            <label class="search-box"><span>搜尋</span><input id="stock-search" type="search" placeholder="輸入股票代號或名稱" autocomplete="off"></label>
          `;
          panel.querySelector(":scope > .strength-panel")?.insertAdjacentElement("afterend", band);
        }
        if (!panel.querySelector(":scope > .sector-section")) {
          const section = document.createElement("section");
          section.className = "sector-section";
          section.innerHTML = `
            <div class="section-title">
              <div><h2>熱力圖</h2><p>公開資料排序</p></div>
              <span>全部 · -- 個</span>
            </div>
            <div class="tabs"><button>全部</button><button>官方產業</button><button>電子細分</button><button>群組概念</button><button>集團股</button></div>
            <div class="heatmap" id="heatmap"></div>
          `;
          (panel.querySelector(":scope > .terminal-band") || panel.querySelector(":scope > .strength-panel") || tabs).insertAdjacentElement("afterend", section);
        }
        return panel;
      };
      const marketActive = () => document.querySelector("#market-view.active:not([hidden])");
      const indexBy = (payload, names) => list(payload?.indexes).find((item) => names.some((name) => safeText(item?.["指數"] || item?.name).includes(name))) || null;
      const deltaText = (item) => {
        if (!item) return "等待官方資料";
        const sign = safeText(item["漲跌"] || item.sign).includes("-") ? "-" : "+";
        const diff = safeText(item["漲跌點數"] ?? item.change ?? "0").replace(/^[+-]/, "");
        const pct = safeText(item["漲跌百分比"] ?? item.pct ?? "0").replace(/[+%-]/g, "");
        return `${sign}${diff}（${sign}${pct}%）`;
      };
      const setCard = (card, label, value, sub, up) => {
        if (!card) return;
        const title = card.querySelector("span");
        const strong = card.querySelector("strong");
        const em = card.querySelector("em");
        if (title) title.textContent = label;
        if (strong) strong.textContent = value || "--";
        if (em) em.textContent = sub || "等待官方資料";
        card.classList.toggle("market-card-up", up === true);
        card.classList.toggle("market-card-down", up === false);
      };
      const paintMarket = (marketPayload = {}, heatPayload = {}) => {
        const panel = ensureMarketScaffold();
        if (!panel) return;
        const updatedAt = marketPayload.updatedAt || heatPayload.updatedAt || heatPayload.servedAt || "";
        const compactTime = safeText(updatedAt).match(/(\d{2}):(\d{2})/)?.slice(1, 3).join(":") || "最新";
        const refresh = panel.querySelector(".refresh-line");
        const clock = panel.querySelector(".market-time");
        if (refresh) refresh.textContent = `${compactTime} 更新 · Supabase/API`;
        if (clock) clock.textContent = compactTime;
        const twse = indexBy(marketPayload, ["加權", "發行量"]);
        const otc = indexBy(marketPayload, ["櫃買"]);
        const near = marketPayload.futuresNear || marketPayload.futures || null;
        const next = marketPayload.futuresNext || null;
        const cards = [...panel.querySelectorAll(".metric-grid .metric-card")];
        setCard(cards[0], "↗ 加權指數", num(twse?.["收盤指數"]).toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), deltaText(twse), !safeText(twse?.["漲跌"]).includes("-"));
        setCard(cards[1], "↗ 櫃買指數", num(otc?.["收盤指數"]).toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), deltaText(otc), !safeText(otc?.["漲跌"]).includes("-"));
        setCard(cards[2], "⇅ 台指期夜盤", near?.price ? num(near.price).toLocaleString("zh-TW") : "--", near ? `${near.change || "--"}（${near.pct || "--"}）${near.basisLabel ? ` · ${near.basisLabel}` : ""}` : "等待期交所資料", !safeText(near?.change).includes("-"));
        setCard(cards[3], "☾ 台指次月", next?.price ? num(next.price).toLocaleString("zh-TW") : "--", next ? `${next.change || "--"}（${next.pct || "--"}）${next.basisLabel ? ` · ${next.basisLabel}` : ""}` : "等待期交所資料", !safeText(next?.change).includes("-"));
        const sectors = list(heatPayload.sectors).slice(0, 60);
        if (!sectors.length) return;
        window.__fumanMarketDirectSectors = sectors;
        const stocks = sectors.flatMap((sector) => list(sector.stocks));
        const up = sectors.reduce((sum, sector) => sum + num(sector.up), 0);
        const down = sectors.reduce((sum, sector) => sum + num(sector.down), 0);
        const sample = num(heatPayload.stockCount || heatPayload.sample || heatPayload.count) || stocks.length || up + down;
        const flat = Math.max(0, sample - up - down);
        const totalValue = sectors.reduce((sum, sector) => sum + num(sector.totalValue || sector.value || (num(sector.amountYi) * 100000000)), 0);
        const ratio = sample ? (up / sample) * 100 : 0;
        const strength = panel.querySelector(".strength-panel");
        if (strength) {
          const title = strength.querySelector(".strength-head h2");
          const sub = strength.querySelector(".strength-head p");
          const strong = strength.querySelector(".strength-head strong");
          const stats = strength.querySelectorAll(".stats-row strong");
          if (title) title.textContent = up >= down ? "強勢" : "弱勢";
          if (sub) sub.textContent = `${sample.toLocaleString("zh-TW")} 檔 · 平均 ${num(heatPayload.avgPct).toFixed(2)}%`;
          if (strong) strong.innerHTML = `${ratio.toFixed(2)}%<span>上漲比例</span>`;
          if (stats[0]) stats[0].textContent = up.toLocaleString("zh-TW");
          if (stats[1]) stats[1].textContent = down.toLocaleString("zh-TW");
          if (stats[2]) stats[2].textContent = flat.toLocaleString("zh-TW");
          if (stats[3]) stats[3].textContent = yi(totalValue);
        }
        const ticker = panel.querySelector(".ticker-strip");
        if (ticker) {
          ticker.innerHTML = sectors.slice().sort((a, b) => num(b.pct ?? b.avgPct) - num(a.pct ?? a.avgPct)).slice(0, 28).map((sector) => {
            const pct = num(sector.pct ?? sector.avgPct);
            const leader = sector.leader || list(sector.stocks)[0] || {};
            const leaderText = typeof leader === "string" ? leader : (leader.name || leader.code || "");
            return `<span class="${pct >= 0 ? "ticker-up" : "ticker-down"}">${esc(sector.name || sector.industry || "--")} <b>${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</b> <small>${esc(leaderText)}</small></span>`;
          }).join("");
        }
        const heatmap = panel.querySelector("#heatmap");
        if (heatmap) {
          heatmap.innerHTML = `
            <div class="heatmap-health-bar"><strong>熱力圖 API</strong><span>${esc(heatPayload.updatedAt || heatPayload.servedAt || "")}</span></div>
            ${sectors.map((sector, index) => {
              const pct = num(sector.pct ?? sector.avgPct);
              const leader = sector.leader || list(sector.stocks)[0] || {};
              const leaderText = typeof leader === "string" ? leader : leader ? `${leader.name || leader.code || "--"} ${num(leader.pct) >= 0 ? "+" : ""}${num(leader.pct).toFixed(2)}%` : "--";
              return `<article class="sector-card ${pct >= 0 ? "hot up" : "cold down"}" data-market-direct-sector="${index}" role="button" tabindex="0">
                <div><h3>${esc(sector.name || sector.industry || "--")}</h3><strong>${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</strong></div>
                <p>${esc(sector.count || list(sector.stocks).length || 0)} 檔 · ${esc(yi(sector.totalValue || sector.value || (num(sector.amountYi) * 100000000)))}</p>
                <small>▲ ${esc(sector.up || 0)} ▼ ${esc(sector.down || 0)}</small>
                <span>${esc(leaderText)}</span>
              </article>`;
            }).join("")}
          `;
        }
        const count = panel.querySelector(".sector-section .section-title > span");
        if (count) count.textContent = `全部 · ${sectors.length} 個`;
        const message = panel.querySelector("#terminal-message");
        if (message) message.textContent = "市場總覽已同步 Supabase/API，點熱力圖產業可看相關股票。";
        paintMarketAi(panel, marketPayload, heatPayload);
      };
      const paintMarketAi = (panel, marketPayload = {}, heatPayload = {}) => {
        const ai = panel.querySelector("[data-market-api-ai], #market-ai-panel, .market-ai-panel");
        if (!ai) return;
        const sectors = list(heatPayload.sectors);
        const up = sectors.reduce((sum, sector) => sum + num(sector.up), 0);
        const down = sectors.reduce((sum, sector) => sum + num(sector.down), 0);
        const sample = num(heatPayload.stockCount || heatPayload.sample || heatPayload.count) || up + down;
        const strong = sectors.filter((s) => num(s.pct ?? s.avgPct) >= 0).sort((a, b) => num(b.pct ?? b.avgPct) - num(a.pct ?? a.avgPct)).slice(0, 5);
        const weak = sectors.filter((s) => num(s.pct ?? s.avgPct) < 0).sort((a, b) => num(a.pct ?? a.avgPct) - num(b.pct ?? b.avgPct)).slice(0, 5);
        const hotStocks = strong.flatMap((sector) => list(sector.stocks).slice(0, 3).map((stock) => ({ ...stock, industry: sector.name || sector.industry || "--", sectorPct: num(sector.pct ?? sector.avgPct) }))).slice(0, 10);
        ai.innerHTML = `
          <section class="market-ai-panel">
            <div class="market-ai-sort-note"><strong>AI 判讀 09:00-13:30</strong><span>盤中巡邏，收盤後固定最後 snapshot。</span><span>${esc(heatPayload.heatmapDetectWindow?.reason || "snapshot")}</span></div>
            <section class="market-ai-summary">
              <article class="market-ai-card hero"><small>市場廣度</small><strong>${up >= down ? "多方壓制" : "空方壓制"}</strong><p>上漲 ${up.toLocaleString("zh-TW")} / 下跌 ${down.toLocaleString("zh-TW")}，樣本 ${sample.toLocaleString("zh-TW")}。</p></article>
              <article class="market-ai-card"><small>強勢族群</small><strong>${esc(strong[0]?.name || "--")}</strong><p>${esc(strong.slice(0, 3).map((s) => s.name || s.industry).join("、") || "等待熱力圖資料")}</p></article>
              <article class="market-ai-card warning"><small>風險排除</small><strong>${esc(weak[0]?.name || "--")}</strong><p>${esc(weak.slice(0, 3).map((s) => s.name || s.industry).join("、") || "暫無明顯弱勢")}</p></article>
              <article class="market-ai-card"><small>觀察股</small><strong>${esc(hotStocks[0] ? `${hotStocks[0].code} ${hotStocks[0].name}` : "--")}</strong><p>依熱力圖族群強度與成交額排序。</p></article>
            </section>
            <section class="market-ai-block market-ai-hot-section">
              <header><div><h4>熱門觀察股</h4><p>精選前 10 檔</p></div><span>API snapshot</span></header>
              <div class="market-ai-hot">
                ${hotStocks.length ? hotStocks.map((stock, index) => `<article class="market-ai-stock-row">
                  <div class="market-ai-rank">#${index + 1}</div>
                  <div><h4><span class="market-ai-code">${esc(stock.code)}</span><span class="market-ai-name">${esc(stock.name)}</span></h4><p>${esc(stock.industry)}，漲幅 ${num(stock.pct).toFixed(2)}%，成交額 ${esc(yi(stock.value || stock.amountYi * 100000000))}。</p></div>
                  <div><span class="market-ai-chip">${esc(stock.industry)}</span><span class="market-ai-chip">${num(stock.pct) >= 0 ? "+" : ""}${num(stock.pct).toFixed(2)}%</span></div>
                </article>`).join("") : '<div class="empty-state">等待 AI 判讀資料。</div>'}
              </div>
            </section>
          </section>
        `;
      };
      const openSector = (index) => {
        const sector = window.__fumanMarketDirectSectors[Number(index)];
        if (!sector) return;
        const stocks = list(sector.stocks).slice().sort((a, b) => num(b.value || b.amountYi) - num(a.value || a.amountYi));
        document.querySelector("[data-market-direct-modal]")?.remove();
        const modal = document.createElement("section");
        modal.className = "sector-modal-overlay";
        modal.dataset.marketDirectModal = "1";
        modal.innerHTML = `<div class="sector-modal-shell" role="dialog" aria-modal="true">
          <header class="sector-modal-header"><div class="sector-modal-title-block"><small>熱力圖產業</small><h2>${esc(sector.name || sector.industry || "--")}</h2><p>${stocks.length} 檔股票，依成交額排序。</p></div><button type="button" class="sector-modal-close" data-market-direct-close>×</button></header>
          <div class="sector-modal-scroll"><table class="sector-modal-table"><thead><tr><th>股票</th><th>現價</th><th>漲跌</th><th>成交額</th><th>量</th><th>官方產業</th></tr></thead><tbody>
          ${stocks.map((stock) => `<tr><td><div class="sector-modal-stock-title">${esc(stock.code)} <span>${esc(stock.name)}</span></div></td><td>${esc(stock.close || stock.price || "--")}</td><td class="${num(stock.pct) >= 0 ? "sector-pct-up" : "sector-pct-down"}">${num(stock.pct) >= 0 ? "+" : ""}${num(stock.pct).toFixed(2)}%</td><td>${esc(yi(stock.value || stock.amountYi * 100000000))}</td><td>${num(stock.volume).toLocaleString("zh-TW")}</td><td>${esc(stock.officialIndustry || stock.primaryIndustry || "--")}</td></tr>`).join("")}
          </tbody></table></div>
        </div>`;
        document.body.appendChild(modal);
      };
      document.addEventListener("click", (event) => {
        const close = event.target.closest?.("[data-market-direct-close]");
        if (close || event.target.matches?.("[data-market-direct-modal]")) {
          document.querySelector("[data-market-direct-modal]")?.remove();
          return;
        }
        const card = event.target.closest?.("[data-market-direct-sector]");
        if (card) openSector(card.dataset.marketDirectSector);
      }, true);
      const run = async () => {
        if (!marketActive() || window.__fumanMarketDirectPaintLoading) return;
        ensureMarketScaffold();
        window.__fumanMarketDirectPaintLoading = true;
        try {
          const [market, heat] = await Promise.all([
            xhrJson("/api/market?canvas=1&compact=1&shell=1&limit=24"),
            xhrJson("/api/heatmap?canvas=1&compact=1&shell=1&limit=60"),
          ]);
          paintMarket(market || {}, heat || {});
        } finally {
          window.__fumanMarketDirectPaintLoading = false;
        }
      };
      window.FUMAN_MARKET_DIRECT_PAINT = run;
      window.addEventListener("fuman:desktop-route", (event) => {
        if (String(event?.detail?.key || "") === "market|市場總覽") setTimeout(run, 120);
      });
      document.addEventListener("click", (event) => {
        if (event.target.closest?.('[data-view="market"], [data-market-mode]')) setTimeout(run, 220);
      }, true);
      window.addEventListener("focus", () => setTimeout(run, 220));
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") setTimeout(run, 220);
      });
      [600, 2400, 6800, 12000].forEach((delay) => setTimeout(run, delay));
    }
    [600, 2400, 6800].forEach((delay) => {
      setTimeout(() => {
        if (document.querySelector("#market-view.active:not([hidden])")) {
          window.FUMAN_MARKET_API_HYDRATE?.(true);
        }
      }, delay);
    });
    return;
  }
  if (window.__fumanMarketOverviewRestoreReady) return;
  window.__fumanMarketOverviewRestoreReady = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const marketPanel = $("#market-view");
  const dashboard = $(".dashboard");
  const navList = $(".nav-list");
  if (!marketPanel || !dashboard) return;

  function ensureMarketTabs() {
    let tabs = $("#market-mode-tabs");
    if (!tabs) {
      tabs = document.createElement("section");
      tabs.id = "market-mode-tabs";
      tabs.className = "market-mode-tabs";
      tabs.setAttribute("aria-label", "市場總覽模式");
      tabs.innerHTML = [
        '<button type="button" class="active" data-market-mode="overview">◉ 市場總覽</button>',
        '<button type="button" data-market-mode="ai">♙ AI 判讀</button>'
      ].join("");
      const header = marketPanel.querySelector(".page-header");
      header?.after(tabs);
    }

    let aiPanel = $("#market-ai-panel");
    if (!aiPanel) {
      aiPanel = document.createElement("section");
      aiPanel.id = "market-ai-panel";
      aiPanel.className = "market-ai-panel";
      aiPanel.hidden = true;
      aiPanel.innerHTML = '<div class="empty-state">載入最新 AI 判讀資料中...</div>';
      tabs.after(aiPanel);
    }
  }

  function applyMarketMode(mode) {
    const next = mode === "ai" ? "ai" : "overview";
    const aiPanel = $("#market-ai-panel");
    marketPanel.classList.toggle("market-ai-mode", next === "ai");
    marketPanel.classList.toggle("market-overview-mode", next !== "ai");
    $$("#market-mode-tabs [data-market-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.marketMode === next);
    });
    if (aiPanel) {
      aiPanel.hidden = next !== "ai";
      if (next === "ai") {
        try {
          window.renderMarketAiPanel?.();
        } catch (error) {}
      }
    }
    const title = $("#market-view .page-header h1");
    if (title && !title.querySelector(".page-title-icon")) {
      title.textContent = next === "ai" ? "AI 盤面判讀" : "市場總覽";
    }
  }

  function ensureRealtimeRadarEntry() {
    if (!navList) return;
    const existingLinks = $$('.nav-list [data-view="realtime-radar"]');
    existingLinks.slice(1).forEach((node) => node.remove());
    let link = existingLinks[0] || null;
    if (!link) {
      link = document.createElement("a");
      link.className = "strategy-nav realtime-radar-nav";
      link.href = "#";
      link.dataset.view = "realtime-radar";
      link.dataset.mobileLabel = "即時";
      link.innerHTML = "<span>◎</span>即時雷達";
      const marketLink = $('.nav-list [data-view="market"]');
      const watchLink = $('.nav-list [data-view="watchlist"]');
      if (marketLink && watchLink) marketLink.after(link);
      else navList.prepend(link);
    }
    link.classList.remove("member-locked-link");
    link.removeAttribute("aria-disabled");

    let panel = $("#realtime-radar-view");
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "view-panel radar-view";
      panel.id = "realtime-radar-view";
      panel.hidden = true;
      panel.innerHTML = '<div class="empty-state">即時雷達載入中...</div>';
      marketPanel.after(panel);
    }
  }

  function showView(viewName) {
    $$(".view-panel").forEach((panel) => {
      const active = panel.id === `${viewName}-view`;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    $$("[data-view]").forEach((link) => {
      link.classList.toggle("active", link.dataset.view === viewName);
    });
    if (viewName === "realtime-radar") {
      try {
        window.renderRealtimeRadar?.();
      } catch (error) {}
    }
  }

  ensureMarketTabs();
  ensureRealtimeRadarEntry();
  applyMarketMode("overview");
  setTimeout(ensureRealtimeRadarEntry, 400);
  setTimeout(ensureRealtimeRadarEntry, 1400);

  document.addEventListener("click", (event) => {
    const modeButton = event.target.closest?.("[data-market-mode]");
    if (modeButton) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      applyMarketMode(modeButton.dataset.marketMode);
      return;
    }
    const realtimeLink = event.target.closest?.('[data-view="realtime-radar"]');
    if (realtimeLink) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showView("realtime-radar");
      return;
    }
    const marketLink = event.target.closest?.('[data-view="market"]');
    if (marketLink) {
      setTimeout(() => {
        ensureMarketTabs();
        applyMarketMode("overview");
        if (!marketPanel.classList.contains("active")) showView("market");
      }, 0);
    }
  }, true);
})();
