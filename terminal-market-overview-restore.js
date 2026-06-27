(function restoreMarketOverviewLegacySurface() {
  if (window.__fumanDesktopFastShell === "20260623-09") {
    window.__fumanMarketOverviewRestoreReady = true;
    document.documentElement.dataset.fumanMarketOverviewRestoreSkipped = "desktop-fast-shell";
    if (!window.__fumanMarketOverviewDirectPainter) {
      window.__fumanMarketOverviewDirectPainter = true;
      window.__fumanMarketDirectSectors = [];
      window.__fumanMarketAiDrilldowns = {};
      window.__fumanMarketHeatmapMode = window.__fumanMarketHeatmapMode || "all";
      window.__fumanMarketHeatmapGroups = {};
      window.__fumanMarketHeatmapPayload = null;
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
        panel.querySelector(":scope > .ticker-strip")?.remove();
        panel.querySelector(":scope > .strength-panel")?.remove();
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
        const metricGrid = panel.querySelector(":scope > .metric-grid");
        if (!panel.querySelector(":scope > .terminal-band")) {
          const band = document.createElement("section");
          band.className = "terminal-band";
          band.setAttribute("aria-label", "Terminal status");
          band.innerHTML = `
            <div class="terminal-log"><span>FMN://market.scan</span><strong id="terminal-message">等待官方資料回應...</strong></div>
            <label class="search-box"><span>搜尋</span><input id="stock-search" type="search" placeholder="輸入股票代號或名稱" autocomplete="off"></label>
          `;
          (metricGrid || tabs || header || panel).insertAdjacentElement(metricGrid || tabs || header ? "afterend" : "beforeend", band);
        }
        if (!panel.querySelector(":scope > .sector-section")) {
          const section = document.createElement("section");
          section.className = "sector-section";
          section.innerHTML = `
            <div class="section-title">
              <div><h2>熱力圖</h2><p>公開資料排序</p></div>
              <span>全部 · -- 個</span>
            </div>
            <div class="tabs" data-market-heatmap-tabs>
              <button type="button" class="active" data-market-heatmap-mode="all">全部</button>
              <button type="button" data-market-heatmap-mode="official">官方產業</button>
              <button type="button" data-market-heatmap-mode="electronics">電子細分</button>
              <button type="button" data-market-heatmap-mode="themes">群組概念</button>
              <button type="button" data-market-heatmap-mode="groups">集團股</button>
            </div>
            <div class="heatmap" id="heatmap"></div>
          `;
          (panel.querySelector(":scope > .terminal-band") || metricGrid || tabs || header || panel).insertAdjacentElement(
            panel.querySelector(":scope > .terminal-band") || metricGrid || tabs || header ? "afterend" : "beforeend",
            section
          );
        }
        const heatmapTabs = panel.querySelector(".sector-section .tabs");
        if (heatmapTabs && !heatmapTabs.matches("[data-market-heatmap-tabs]")) {
          heatmapTabs.setAttribute("data-market-heatmap-tabs", "1");
          heatmapTabs.innerHTML = `
            <button type="button" class="active" data-market-heatmap-mode="all">全部</button>
            <button type="button" data-market-heatmap-mode="official">官方產業</button>
            <button type="button" data-market-heatmap-mode="electronics">電子細分</button>
            <button type="button" data-market-heatmap-mode="themes">群組概念</button>
            <button type="button" data-market-heatmap-mode="groups">集團股</button>
          `;
        }
        return panel;
      };
      const marketActive = () => document.querySelector("#market-view.active:not([hidden])");
      const cleanGroupName = (value) => safeText(value).trim().replace(/業$/u, "") || "";
      const stockPctValue = (stock) => num(stock?.pct ?? stock?.changePct ?? stock?.changePercent);
      const stockAmountValue = (stock) => num(stock?.value || (num(stock?.amountYi) * 100000000));
      const heatmapStockUniverse = (sectors) => list(sectors).flatMap((sector) =>
        list(sector.stocks).map((stock) => ({
          ...stock,
          _sourceSector: sector.name || sector.industry || stock.industry || "--",
        }))
      );
      const firstKnown = (...values) => values.map(cleanGroupName).find(Boolean) || "";
      const uniqueLabels = (values) => [...new Set(values.map(cleanGroupName).filter(Boolean))];
      const isElectronicsLabel = (value) => /電子|半導體|IC|PCB|載板|光|網通|AI|CPU|ASIC|IP|記憶體|被動|伺服器|通路|零組件|電源|BBU|UPS|封測|晶圓|矽|面板|光通訊/u.test(safeText(value));
      const labelsForMode = (stock, mode) => {
        const profile = stock?.industryProfile || {};
        const themes = list(stock?.themes || profile.themes);
        const base = firstKnown(stock?.primaryIndustry, profile.primaryIndustry, stock?.industry, stock?._sourceSector);
        const official = firstKnown(stock?.officialIndustry, profile.officialIndustry, stock?.primaryIndustry, stock?._sourceSector);
        if (mode === "official") return [official || base || "未分類"];
        if (mode === "electronics") {
          const candidates = uniqueLabels([base, stock?.industry, stock?.primaryIndustry, stock?._sourceSector, ...themes])
            .filter(isElectronicsLabel);
          return candidates;
        }
        if (mode === "themes") {
          const candidates = uniqueLabels([...themes, profile.theme, profile.concept, stock?.concept, base]);
          return candidates.length ? candidates.slice(0, 2) : [base || official || "未分類"];
        }
        if (mode === "groups") {
          const candidates = uniqueLabels([
            stock?.companyGroup,
            stock?.businessGroup,
            stock?.conglomerate,
            stock?.group,
            profile.companyGroup,
            profile.businessGroup,
            profile.conglomerate,
          ]);
          return candidates.length ? candidates : [`${base || official || stock?._sourceSector || "市場"}系`];
        }
        return [base || official || "未分類"];
      };
      const aggregateHeatmapSectors = (rawSectors, mode) => {
        if (mode === "all") return list(rawSectors);
        const buckets = new Map();
        heatmapStockUniverse(rawSectors).forEach((stock) => {
          labelsForMode(stock, mode).forEach((label) => {
            if (!label) return;
            if (!buckets.has(label)) buckets.set(label, { name: label, stocks: [], totalValue: 0, up: 0, down: 0, flat: 0 });
            const bucket = buckets.get(label);
            const pct = stockPctValue(stock);
            bucket.stocks.push(stock);
            bucket.totalValue += stockAmountValue(stock);
            if (pct > 0) bucket.up++;
            else if (pct < 0) bucket.down++;
            else bucket.flat++;
          });
        });
        return [...buckets.values()].filter((group) => group.stocks.length).map((group) => {
          const totalAmountYi = group.totalValue / 100000000;
          const avgPct = group.stocks.reduce((sum, stock) => sum + stockPctValue(stock), 0) / group.stocks.length;
          const weightedPct = group.totalValue
            ? group.stocks.reduce((sum, stock) => sum + stockPctValue(stock) * stockAmountValue(stock), 0) / group.totalValue
            : avgPct;
          const sortedStocks = [...group.stocks].sort((a, b) => stockAmountValue(b) - stockAmountValue(a));
          const leader = sortedStocks[0];
          return {
            name: group.name,
            pct: Number(weightedPct.toFixed(2)),
            avgPct: Number(avgPct.toFixed(2)),
            totalValue: group.totalValue,
            amountYi: Number(totalAmountYi.toFixed(1)),
            count: group.stocks.length,
            up: group.up,
            down: group.down,
            flat: group.flat,
            leader: leader ? `${leader.name || leader.code} ${stockPctValue(leader) >= 0 ? "+" : ""}${stockPctValue(leader).toFixed(2)}%` : "--",
            leaderCode: leader?.code || "",
            stocks: sortedStocks,
          };
        }).sort((a, b) => num(b.pct ?? b.avgPct) - num(a.pct ?? a.avgPct));
      };
      const heatmapModeLabel = (mode) => ({
        all: "全部",
        official: "官方產業",
        electronics: "電子細分",
        themes: "群組概念",
        groups: "集團股",
      })[mode] || "全部";
      const setHeatmapButtons = (panel, mode) => {
        panel.querySelectorAll("[data-market-heatmap-mode]").forEach((button) => {
          button.classList.toggle("active", button.dataset.marketHeatmapMode === mode);
        });
      };
      const renderHeatmapCards = (panel, heatPayload = {}) => {
        const mode = window.__fumanMarketHeatmapMode || "all";
        const rawSectors = list(window.__fumanMarketHeatmapPayload?.rawSectors || heatPayload.sectors);
        const modeSectors = list(window.__fumanMarketHeatmapGroups?.[mode] || rawSectors).slice(0, 80);
        const heatmap = panel.querySelector("#heatmap");
        window.__fumanMarketDirectSectors = modeSectors;
        setHeatmapButtons(panel, mode);
        if (heatmap) {
          heatmap.innerHTML = `
            <div class="heatmap-health-bar"><strong>熱力圖 ${esc(heatmapModeLabel(mode))}</strong><span>${esc(heatPayload.updatedAt || heatPayload.servedAt || "")}</span></div>
            ${modeSectors.map((sector, index) => {
              const pct = num(sector.pct ?? sector.avgPct);
              const leader = sector.leader || list(sector.stocks)[0] || {};
              const leaderText = typeof leader === "string" ? leader : leader ? `${leader.name || leader.code || "--"} ${num(leader.pct) >= 0 ? "+" : ""}${num(leader.pct).toFixed(2)}%` : "--";
              return `<article class="sector-card ${pct >= 0 ? "hot up" : "cold down"}" data-market-direct-sector="${index}" role="button" tabindex="0">
                <div><h3>${esc(sector.name || sector.industry || "--")}</h3><strong>${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</strong></div>
                <p>${esc(sector.count || list(sector.stocks).length || 0)} 檔 · ${esc(yi(sector.totalValue || sector.value || (num(sector.amountYi) * 100000000)))}</p>
                <small>▲ ${esc(sector.up || 0)} ▼ ${esc(sector.down || 0)}</small>
                <span>${esc(leaderText)}</span>
              </article>`;
            }).join("") || '<div class="empty-state">此分類目前沒有資料。</div>'}
          `;
        }
        const count = panel.querySelector(".sector-section .section-title > span");
        if (count) count.textContent = `${heatmapModeLabel(mode)} · ${modeSectors.length} 個`;
      };
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
        panel.querySelector(":scope > .ticker-strip")?.remove();
        panel.querySelector(":scope > .strength-panel")?.remove();
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
        const rawSectors = list(heatPayload.sectors).slice(0, 80);
        if (!rawSectors.length) return;
        window.__fumanMarketHeatmapPayload = { heatPayload, rawSectors };
        window.__fumanMarketHeatmapGroups = {
          all: aggregateHeatmapSectors(rawSectors, "all"),
          official: aggregateHeatmapSectors(rawSectors, "official"),
          electronics: aggregateHeatmapSectors(rawSectors, "electronics"),
          themes: aggregateHeatmapSectors(rawSectors, "themes"),
          groups: aggregateHeatmapSectors(rawSectors, "groups"),
        };
        renderHeatmapCards(panel, heatPayload);
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
        const flat = Math.max(0, sample - up - down);
        const pctOf = (value, base = sample) => base ? Math.max(0, Math.min(100, (value / base) * 100)) : 0;
        const upRatio = pctOf(up);
        const downRatio = pctOf(down);
        const flatRatio = Math.max(0, 100 - upRatio - downRatio);
        const strong = sectors.filter((s) => num(s.pct ?? s.avgPct) >= 0).sort((a, b) => num(b.pct ?? b.avgPct) - num(a.pct ?? a.avgPct)).slice(0, 8);
        const weak = sectors.filter((s) => num(s.pct ?? s.avgPct) < 0).sort((a, b) => num(a.pct ?? a.avgPct) - num(b.pct ?? b.avgPct)).slice(0, 8);
        const hotStocks = strong.flatMap((sector) => list(sector.stocks).slice(0, 3).map((stock) => ({ ...stock, industry: sector.name || sector.industry || "--", sectorPct: num(sector.pct ?? sector.avgPct), aiTag: "動能強" }))).slice(0, 10);
        const riskStocks = weak.flatMap((sector) => list(sector.stocks).slice(0, 3).map((stock) => ({ ...stock, industry: sector.name || sector.industry || "--", sectorPct: num(sector.pct ?? sector.avgPct), aiTag: "風險高" }))).slice(0, 8);
        const sectorStockItems = (sector, limit = 4) => {
          const sectorName = sector?.name || sector?.industry || "--";
          return list(sector?.stocks).slice(0, limit).map((stock) => ({
            code: safeText(stock.code || stock.stockCode || stock.ticker || ""),
            name: safeText(stock.name || stock.stockName || ""),
            pct: num(stock.pct ?? stock.changePct ?? stock.changePercent),
            value: stock.value || (num(stock.amountYi) * 100000000),
            close: stock.close || stock.price || stock.lastPrice || "--",
            industry: safeText(stock.officialIndustry || stock.primaryIndustry || sectorName)
          })).filter((stock) => stock.code || stock.name);
        };
        const makeGroupItem = (sector, index, tone = "up") => {
          const pct = num(sector?.pct ?? sector?.avgPct);
          const stocks = sectorStockItems(sector, 4);
          const count = num(sector?.count || list(sector?.stocks).length || stocks.length);
          return {
            rank: index + 1,
            title: safeText(sector?.name || sector?.industry || "--"),
            pct,
            tone,
            count,
            amount: yi(sector?.totalValue || sector?.value || (num(sector?.amountYi) * 100000000)),
            ratioLabel: `${pct >= 0 ? "上漲" : "下跌"} ${Math.abs(pct).toFixed(1)}%`,
            stocks
          };
        };
        const strongItems = strong.slice(0, 3).map((sector, index) => makeGroupItem(sector, index, "up"));
        const weakItems = weak.slice(0, 3).map((sector, index) => makeGroupItem(sector, index, "down"));
        const mixedItems = strongItems.slice(0, 2).concat(weakItems.slice(0, 1));
        window.__fumanMarketAiDrilldowns = {
          focusStrong: {
            kicker: "族群聚焦",
            title: "只看強族群前 3 名",
            subtitle: `目前有 ${strongItems.length} 組族群強度較佳，先聚焦領頭股與同族群擴散。`,
            items: strongItems,
            footerPrimary: "多用動能篩選",
            footerSecondary: "只看說明"
          },
          riskExclude: {
            kicker: "風險排除",
            title: "風險高標的先排除",
            subtitle: `弱勢族群先排除，避免反彈失敗標的拖累節奏。`,
            items: weakItems,
            footerPrimary: "套用風險排除",
            footerSecondary: "只看說明"
          },
          breadth: {
            kicker: "廣度檢核",
            title: "廣度代表族群",
            subtitle: `上漲 ${up.toLocaleString("zh-TW")} / 下跌 ${down.toLocaleString("zh-TW")}，先看強弱兩端代表族群。`,
            items: mixedItems,
            footerPrimary: "看強弱分布",
            footerSecondary: "只看說明"
          },
          strongGroup: {
            kicker: "強勢群組",
            title: "強勢族群清單",
            subtitle: "依族群漲跌、樣本數與成交額排序，優先看最有延續性的族群。",
            items: strongItems,
            footerPrimary: "多用動能篩選",
            footerSecondary: "只看說明"
          },
          sectorStructure: {
            kicker: "族群結構",
            title: "強族群前 3 名",
            subtitle: "目前先確認強族群是否有多檔股票同步發動，避免只追單一領頭。",
            items: strongItems,
            footerPrimary: "看族群擴散",
            footerSecondary: "只看說明"
          },
          riskCheck: {
            kicker: "風險檢核",
            title: "融券壓力與弱勢族群",
            subtitle: "弱勢族群若無法收斂，盤中反彈要先降低追價與隔日風險。",
            items: weakItems,
            footerPrimary: "套用風險排除",
            footerSecondary: "只看說明"
          }
        };
        const maxSectorMove = Math.max(1, ...strong.concat(weak).map((sector) => Math.abs(num(sector.pct ?? sector.avgPct))));
        const maxStockScore = Math.max(1, ...hotStocks.concat(riskStocks).map((stock) => Math.abs(num(stock.pct)) + Math.abs(num(stock.sectorPct)) * 0.45));
        const stockAmount = (stock) => num(stock.value || stock.amount || stock.tradingValue || stock.amountYi * 100000000);
        const institutionalStocks = hotStocks.filter((stock) => {
          const foreign = num(stock.foreign || stock.foreignBuySell || stock.foreignNet);
          const trust = num(stock.trust || stock.investmentTrust || stock.trustNet);
          const dealer = num(stock.dealer || stock.dealerNet || stock.selfDealer);
          return foreign > 0 || trust > 0 || dealer > 0 || /法人|外資|投信/.test(safeText(stock.reason || stock.memo || stock.tags));
        }).slice(0, 10);
        const intradayStocks = hotStocks.slice().sort((a, b) => stockAmount(b) - stockAmount(a)).slice(0, 10);
        const aiStockBuckets = {
          all: { label: "綜合分數", note: "依綜合分數與族群強度排序，適合快速挑選今日熱門觀察股。", stocks: hotStocks },
          momentum: { label: "動能強", note: "只看族群強度與個股漲幅同向的標的。", stocks: hotStocks.filter((stock) => num(stock.pct) >= 0).slice(0, 10) },
          institution: { label: "法人買超", note: "優先顯示帶有法人買超線索的標的；若資料源未提供法人欄位，顯示綜合分數候選。", stocks: institutionalStocks.length ? institutionalStocks : hotStocks },
          intraday: { label: "當沖熱", note: "依成交額與盤中熱度排序，優先看流動性較高的觀察股。", stocks: intradayStocks },
          risk: { label: "風險高", note: "弱勢族群與反轉風險較高的標的，先排除追高。", stocks: riskStocks.length ? riskStocks : weakItems.flatMap((item) => list(item.stocks)).slice(0, 8) }
        };
        window.__fumanMarketAiStockBuckets = aiStockBuckets;
        window.__fumanMarketAiStocks = {};
        const activeAiFilter = window.__fumanMarketAiActiveFilter && aiStockBuckets[window.__fumanMarketAiActiveFilter]
          ? window.__fumanMarketAiActiveFilter
          : "all";
        const sectorBars = (items, tone) => items.length ? items.map((sector, index) => {
          const pct = num(sector.pct ?? sector.avgPct);
          const width = Math.max(8, Math.min(100, Math.abs(pct) / maxSectorMove * 100));
          const count = num(sector.count || list(sector.stocks).length);
          return `<div class="market-ai-bar-row ${tone}">
            <div><strong>${index + 1}. ${esc(sector.name || sector.industry || "--")}</strong><span>${count.toLocaleString("zh-TW")} 檔</span></div>
            <div class="market-ai-bar-track"><i style="width:${width.toFixed(1)}%"></i></div>
            <b>${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</b>
          </div>`;
        }).join("") : '<div class="empty-state">等待熱力圖資料。</div>';
        const hotStockRows = (stocks, bucket = "all") => stocks.length ? stocks.map((stock, index) => {
          const stockPct = num(stock.pct);
          const score = Math.max(8, Math.min(100, (Math.abs(stockPct) + Math.abs(num(stock.sectorPct)) * 0.45) / maxStockScore * 100));
          const aiScore = Math.round(72 + score * 0.28);
          const stockKey = `${bucket}-${index}-${safeText(stock.code || stock.stockCode || stock.ticker || stock.name)}`;
          window.__fumanMarketAiStocks[stockKey] = {
            ...stock,
            code: safeText(stock.code || stock.stockCode || stock.ticker || ""),
            name: safeText(stock.name || stock.stockName || ""),
            aiScore,
            score,
            pct: stockPct,
            value: stockAmount(stock),
            bucket
          };
          return `<article class="market-ai-pick-row" data-market-ai-stock="${esc(stockKey)}">
            <div class="market-ai-rank">#${index + 1}</div>
            <div class="market-ai-pick-main"><h4><span class="market-ai-code">${esc(stock.code)}</span><span class="market-ai-name">${esc(stock.name)}</span></h4><p>排名主因：${esc(stock.industry)}族群強度 · 成交額 ${esc(yi(stock.value || stock.amountYi * 100000000))} · 漲幅 ${stockPct >= 0 ? "+" : ""}${stockPct.toFixed(2)}%。</p><div class="market-ai-scorebar"><i style="width:${score.toFixed(1)}%"></i></div></div>
            <div class="market-ai-pick-score"><small>綜合分數</small><strong>${aiScore}</strong></div>
            <div class="market-ai-pick-tags"><span class="market-ai-chip">${esc(stock.aiTag || aiStockBuckets[bucket]?.label || "動能強")}</span><span class="market-ai-chip">${esc(stock.industry)}</span><span class="market-ai-chip">${stockPct >= 0 ? "+" : ""}${stockPct.toFixed(2)}%</span></div>
            <div class="market-ai-pick-actions"><button type="button" data-market-ai-stock-action="analysis" data-market-ai-stock-key="${esc(stockKey)}">看分析</button><button type="button" data-market-ai-stock-action="watch" data-market-ai-stock-key="${esc(stockKey)}">加入自選</button></div>
          </article>`;
        }).join("") : '<div class="empty-state">等待 AI 判讀資料。</div>';
        const bias = up >= down ? "多方壓制" : "空方壓制";
        const confidence = Math.abs(upRatio - downRatio) >= 24 ? "中" : "低";
        const leadingStock = hotStocks[0] || {};
        const leadingName = leadingStock.code ? `${leadingStock.code} ${leadingStock.name || ""}` : "--";
        const dateLabel = safeText(heatPayload.tradeDate || heatPayload.date || heatPayload.updatedAt || heatPayload.servedAt).slice(0, 10) || "--";
        const todayPoints = [
          `市場廣度顯示上漲家數占 ${upRatio.toFixed(1)}%，站在全市場角度先判斷為${bias}。`,
          `${esc(strong[0]?.name || "強勢族群")}排名靠前，平均漲跌 ${num(strong[0]?.pct ?? strong[0]?.avgPct).toFixed(2)}%。`,
          `熱門觀察股先看 ${esc(leadingName)}，同時留意 ${strong.length} 個強勢來源。`,
          `盤中需盯住下跌 ${down.toLocaleString("zh-TW")} 檔與風險族群是否擴散。`
        ];
        const riskNotes = [
          { title: "族群集中", text: `${esc(strong[0]?.name || "強勢族群")}延續時可以追蹤，但仍要避免只追單一領頭股。` },
          { title: "融券壓力", text: `${weak.length || 0} 個弱勢族群排在風險端，盤中若反彈失敗要降低追高風險。` }
        ];
        ai.innerHTML = `
          <section class="market-ai-panel market-ai-visual-dashboard">
            <section class="market-ai-hero-board">
              <div class="market-ai-hero-copy">
                <small>盤中決策節奏 · 資料 ${esc(dateLabel)}</small>
                <strong>${bias}</strong>
                <p>下跌家數偏多，盤面先以風險控管為主；強勢股需確認族群延續，不追高雜訊。</p>
              </div>
              <div class="market-ai-hero-metrics">
                <span><small>樣本數</small><b>${sample.toLocaleString("zh-TW")}</b></span>
                <span><small>上漲</small><b>${up.toLocaleString("zh-TW")}</b></span>
                <span><small>下跌</small><b>${down.toLocaleString("zh-TW")}</b></span>
                <span><small>信心</small><b>${confidence}</b></span>
              </div>
              <div class="market-ai-hero-action"><small>操作建議</small><b>降低追價</b><span>盤面互抵偏高，先把強勢條件收緊，避免追高。</span></div>
            </section>
            <section class="market-ai-summary">
              <article class="market-ai-card hero"><small>盤勢廣度</small><strong>${bias}</strong><p>上漲 ${up.toLocaleString("zh-TW")} / 下跌 ${down.toLocaleString("zh-TW")}，樣本 ${sample.toLocaleString("zh-TW")}。</p></article>
              <article class="market-ai-card warning"><small>風險控管</small><strong>先控風險</strong><p>${esc(weak.slice(0, 2).map((s) => s.name || s.industry).join("、") || "弱勢族群")} 位於風險端。</p></article>
              <article class="market-ai-card"><small>優先觀察</small><strong>${esc(leadingName)}</strong><p>${esc(leadingStock.industry || strong[0]?.name || "--")} · 排名由族群強度與成交額排序。</p></article>
            </section>
            <section class="market-ai-decision-strip"><span>判讀依據與風險細節</span><small>盤中操作 · 完整依據 · 風險提醒</small></section>
            <section class="market-ai-decision-grid">
              <article data-market-ai-drilldown="focusStrong" role="button" tabindex="0" aria-label="打開強族群前 3 名股票清單"><small>族群聚焦</small><strong>只看強族群前 3 名</strong><i>›</i></article>
              <article data-market-ai-drilldown="riskExclude" role="button" tabindex="0" aria-label="打開風險高標的清單"><small>風險排除</small><strong>風險高標的先排除</strong><i>›</i></article>
            </section>
            <section class="market-ai-evidence">
              <header><h4>AI 判讀依據</h4><span>只保留跟盤勢結論有關的關鍵線索</span></header>
              <div>
                <article data-market-ai-drilldown="breadth" role="button" tabindex="0" aria-label="打開廣度檢核股票清單"><small>廣度檢核</small><strong>上漲 ${upRatio.toFixed(2)}% / 下跌 ${downRatio.toFixed(2)}%</strong><p>樣本 ${sample.toLocaleString("zh-TW")} 檔，平均漲跌 ${num(heatPayload.avgPct).toFixed(2)}%。</p><i>›</i></article>
                <article data-market-ai-drilldown="strongGroup" role="button" tabindex="0" aria-label="打開強勢群組股票清單"><small>強勢群組</small><strong>${esc(strong.slice(0, 2).map((s) => s.name || s.industry).join(" / ") || "--")}</strong><p>明確看 ${strong.length} 組強勢來源，先找族群中軍。</p><i>›</i></article>
                <article data-market-ai-drilldown="sectorStructure" role="button" tabindex="0" aria-label="打開強族群前 3 名股票清單"><small>族群結構</small><strong>強族群前 ${Math.min(3, strong.length)} 名</strong><p>目前優先檢查光學元件、電子服務、強勢元件。</p><i>›</i></article>
                <article data-market-ai-drilldown="riskCheck" role="button" tabindex="0" aria-label="打開風險族群股票清單"><small>風險檢核</small><strong>融券壓力</strong><p>${weak.length} 個族群中低迷訊號偏高，急拉後反轉需控風險。</p><i>›</i></article>
              </div>
            </section>
            <section class="market-ai-lower-grid">
              <article class="market-ai-points">
                <header><h4>AI 今日重點</h4><span>${esc(dateLabel)} 最新判讀</span></header>
                ${todayPoints.map((point, index) => `<p><b>${index + 1}</b><span>${point}</span></p>`).join("")}
              </article>
              <article class="market-ai-risk-panel">
                <header><h4>風險提醒</h4><span>${riskNotes.length} 則</span></header>
                ${riskNotes.map((item) => `<div><strong>${esc(item.title)}</strong><p>${esc(item.text)}</p></div>`).join("")}
              </article>
            </section>
            <section class="market-ai-block market-ai-hot-section">
              <header><div><h4>熱門觀察股</h4><p>精選前 10 檔</p></div></header>
              <div class="market-ai-filter-row">
                <button type="button" class="${activeAiFilter === "all" ? "active" : ""}" data-market-ai-filter="all">全部 <b>${aiStockBuckets.all.stocks.length}</b></button>
                <button type="button" class="${activeAiFilter === "momentum" ? "active" : ""}" data-market-ai-filter="momentum">動能強 <b>${aiStockBuckets.momentum.stocks.length}</b></button>
                <button type="button" class="${activeAiFilter === "institution" ? "active" : ""}" data-market-ai-filter="institution">法人買超 <b>${aiStockBuckets.institution.stocks.length}</b></button>
                <button type="button" class="${activeAiFilter === "intraday" ? "active" : ""}" data-market-ai-filter="intraday">當沖熱 <b>${aiStockBuckets.intraday.stocks.length}</b></button>
                <button type="button" class="${activeAiFilter === "risk" ? "active" : ""}" data-market-ai-filter="risk">風險高 <b>${aiStockBuckets.risk.stocks.length}</b></button>
              </div>
              <div class="market-ai-current-rule"><small>目前排序</small><strong>${esc(aiStockBuckets[activeAiFilter].label)}</strong><span>${esc(aiStockBuckets[activeAiFilter].note)}</span></div>
              <div class="market-ai-hot">
                ${hotStockRows(aiStockBuckets[activeAiFilter].stocks, activeAiFilter)}
              </div>
            </section>
          </section>
        `;
      };
      const openAiDrilldown = (key) => {
        const detail = window.__fumanMarketAiDrilldowns?.[key];
        if (!detail) return;
        document.querySelector("[data-market-ai-modal]")?.remove();
        const modal = document.createElement("section");
        modal.className = "market-ai-modal-overlay";
        modal.dataset.marketAiModal = "1";
        const stockLabel = (stock) => [stock?.code, stock?.name].filter(Boolean).join(" ");
        const items = list(detail.items);
        const itemHtml = items.length ? items.map((item, index) => {
          const pct = num(item.pct);
          const stocks = list(item.stocks);
          const chips = stocks.length ? stocks.map((stock) => {
            const stockPct = num(stock.pct);
            const label = stockLabel(stock) || "--";
            return `<span class="market-ai-modal-stock-chip ${stockPct >= 0 ? "up" : "down"}">${esc(label)}${stockPct ? ` <b>${stockPct >= 0 ? "+" : ""}${stockPct.toFixed(2)}%</b>` : ""}</span>`;
          }).join("") : '<span class="market-ai-modal-stock-chip muted">等待個股資料</span>';
          return `<article class="market-ai-modal-item ${item.tone === "down" ? "down" : "up"}">
            <div class="market-ai-modal-item-head">
              <div><small>#${esc(item.rank || index + 1)}</small><strong>${esc(item.title || "--")}</strong></div>
              <b>${esc(item.ratioLabel || `${pct >= 0 ? "上漲" : "下跌"} ${Math.abs(pct).toFixed(1)}%`)}</b>
            </div>
            <p>${esc(item.count || 0)} 檔樣本 · 平均漲跌 ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% · 成交額約 ${esc(item.amount || "--")}</p>
            <div class="market-ai-modal-stock-chips">${chips}</div>
          </article>`;
        }).join("") : '<div class="market-ai-modal-empty">目前沒有可展開的族群股票。</div>';
        modal.innerHTML = `<div class="market-ai-modal-shell" role="dialog" aria-modal="true" aria-label="${esc(detail.title || "AI 判讀明細")}">
          <header class="market-ai-modal-header">
            <div class="market-ai-modal-title-block"><small>${esc(detail.kicker || "AI 判讀")}</small><h2>${esc(detail.title || "AI 判讀明細")}</h2><p>${esc(detail.subtitle || "")}</p></div>
            <button type="button" class="market-ai-modal-close" data-market-ai-close aria-label="關閉">×</button>
          </header>
          <div class="market-ai-modal-list">${itemHtml}</div>
          <footer class="market-ai-modal-footer">
            <button type="button" class="primary">${esc(detail.footerPrimary || "套用篩選")}</button>
            <button type="button" data-market-ai-close>${esc(detail.footerSecondary || "關閉")}</button>
          </footer>
        </div>`;
        document.body.appendChild(modal);
      };
      const showAiToast = (message) => {
        document.querySelector("[data-market-ai-toast]")?.remove();
        const toast = document.createElement("div");
        toast.dataset.marketAiToast = "1";
        toast.className = "market-ai-toast";
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 1800);
      };
      const renderAiFilter = (filterKey, button) => {
        const bucket = window.__fumanMarketAiStockBuckets?.[filterKey] || window.__fumanMarketAiStockBuckets?.all;
        const panel = button?.closest?.(".market-ai-hot-section");
        if (!bucket || !panel) return;
        window.__fumanMarketAiActiveFilter = filterKey;
        panel.querySelectorAll("[data-market-ai-filter]").forEach((item) => item.classList.toggle("active", item === button));
        const rule = panel.querySelector(".market-ai-current-rule");
        if (rule) {
          const strong = rule.querySelector("strong");
          const note = rule.querySelector("span");
          if (strong) strong.textContent = bucket.label || "綜合分數";
          if (note) note.textContent = bucket.note || "依最新 AI 判讀排序。";
        }
        const hot = panel.querySelector(".market-ai-hot");
        if (!hot) return;
        const stocks = list(bucket.stocks);
        if (!stocks.length) {
          hot.innerHTML = `<div class="empty-state">${esc(bucket.label || "此分類")} 目前沒有符合條件的股票。</div>`;
          return;
        }
        const maxScore = Math.max(1, ...stocks.map((stock) => Math.abs(num(stock.pct)) + Math.abs(num(stock.sectorPct)) * 0.45));
        window.__fumanMarketAiStocks = window.__fumanMarketAiStocks || {};
        hot.innerHTML = stocks.map((stock, index) => {
          const code = safeText(stock.code || stock.stockCode || stock.ticker || "");
          const name = safeText(stock.name || stock.stockName || "");
          const pct = num(stock.pct ?? stock.changePct ?? stock.changePercent);
          const value = num(stock.value || stock.amount || stock.tradingValue || stock.amountYi * 100000000);
          const score = Math.max(8, Math.min(100, (Math.abs(pct) + Math.abs(num(stock.sectorPct)) * 0.45) / maxScore * 100));
          const aiScore = Math.round(72 + score * 0.28);
          const stockKey = `${filterKey}-${index}-${code || name}`;
          window.__fumanMarketAiStocks[stockKey] = { ...stock, code, name, pct, value, aiScore, score, bucket: filterKey };
          return `<article class="market-ai-pick-row" data-market-ai-stock="${esc(stockKey)}">
            <div class="market-ai-rank">#${index + 1}</div>
            <div class="market-ai-pick-main"><h4><span class="market-ai-code">${esc(code || "--")}</span><span class="market-ai-name">${esc(name || "--")}</span></h4><p>排名主因：${esc(stock.industry || "--")}族群強度 · 成交額 ${esc(yi(value))} · 漲幅 ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%。</p><div class="market-ai-scorebar"><i style="width:${score.toFixed(1)}%"></i></div></div>
            <div class="market-ai-pick-score"><small>綜合分數</small><strong>${aiScore}</strong></div>
            <div class="market-ai-pick-tags"><span class="market-ai-chip">${esc(bucket.label || stock.aiTag || "AI")}</span><span class="market-ai-chip">${esc(stock.industry || "--")}</span><span class="market-ai-chip">${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</span></div>
            <div class="market-ai-pick-actions"><button type="button" data-market-ai-stock-action="analysis" data-market-ai-stock-key="${esc(stockKey)}">看分析</button><button type="button" data-market-ai-stock-action="watch" data-market-ai-stock-key="${esc(stockKey)}">加入自選</button></div>
          </article>`;
        }).join("");
      };
      const openAiStockAnalysis = (stockKey) => {
        const stock = window.__fumanMarketAiStocks?.[stockKey];
        if (!stock) return showAiToast("這筆股票資料尚未載入");
        document.querySelector("[data-market-ai-modal]")?.remove();
        const pct = num(stock.pct);
        const score = num(stock.aiScore || stock.score);
        const modal = document.createElement("section");
        modal.className = "market-ai-modal-overlay";
        modal.dataset.marketAiModal = "1";
        const chips = [
          stock.industry,
          stock.aiTag || window.__fumanMarketAiStockBuckets?.[stock.bucket]?.label,
          `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
          stock.value ? yi(stock.value) : ""
        ].filter(Boolean).map((item) => `<span class="market-ai-modal-stock-chip ${pct >= 0 ? "up" : "down"}">${esc(item)}</span>`).join("");
        modal.innerHTML = `<div class="market-ai-modal-shell" role="dialog" aria-modal="true" aria-label="${esc(stock.code || stock.name || "AI 股票分析")}">
          <header class="market-ai-modal-header">
            <div class="market-ai-modal-title-block"><small>AI 股票分析</small><h2>${esc([stock.code, stock.name].filter(Boolean).join(" ") || "--")}</h2><p>依熱門觀察股、族群強度、成交額與漲跌幅整理。</p></div>
            <button type="button" class="market-ai-modal-close" data-market-ai-close aria-label="關閉">×</button>
          </header>
          <div class="market-ai-modal-list">
            <article class="market-ai-modal-item ${pct >= 0 ? "up" : "down"}">
              <div class="market-ai-modal-item-head"><div><small>綜合分數</small><strong>${esc(stock.aiScore || Math.round(score) || "--")}</strong></div><b>${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</b></div>
              <p>排名主因：${esc(stock.industry || "--")}族群強度，成交額 ${esc(stock.value ? yi(stock.value) : "--")}。${esc(stock.reason || stock.memo || "")}</p>
              <div class="market-ai-modal-stock-chips">${chips || '<span class="market-ai-modal-stock-chip muted">等待更多欄位</span>'}</div>
            </article>
          </div>
          <footer class="market-ai-modal-footer">
            <button type="button" class="primary" data-market-ai-stock-action="watch" data-market-ai-stock-key="${esc(stockKey)}">加入自選</button>
            <button type="button" data-market-ai-close>關閉</button>
          </footer>
        </div>`;
        document.body.appendChild(modal);
      };
      const addAiStockToWatchlist = (stockKey, button) => {
        const stock = window.__fumanMarketAiStocks?.[stockKey];
        if (!stock) return showAiToast("這筆股票資料尚未載入");
        const key = "fuman-terminal-ai-watchlist";
        let rows = [];
        try { rows = JSON.parse(localStorage.getItem(key) || "[]"); } catch (_) { rows = []; }
        const code = safeText(stock.code || stock.stockCode || stock.ticker || "");
        const next = rows.filter((item) => safeText(item.code) !== code);
        next.unshift({ code, name: safeText(stock.name || stock.stockName || ""), industry: safeText(stock.industry || ""), addedAt: new Date().toISOString() });
        localStorage.setItem(key, JSON.stringify(next.slice(0, 80)));
        if (button) {
          button.textContent = "已加入";
          button.classList.add("is-added");
        }
        showAiToast(`${code || stock.name || "股票"} 已加入自選`);
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
        const aiClose = event.target.closest?.("[data-market-ai-close]");
        if (aiClose || event.target.matches?.("[data-market-ai-modal]")) {
          document.querySelector("[data-market-ai-modal]")?.remove();
          return;
        }
        const aiDrilldown = event.target.closest?.("[data-market-ai-drilldown]");
        if (aiDrilldown) {
          openAiDrilldown(aiDrilldown.dataset.marketAiDrilldown);
          return;
        }
        const aiFilter = event.target.closest?.("[data-market-ai-filter]");
        if (aiFilter) {
          renderAiFilter(aiFilter.dataset.marketAiFilter || "all", aiFilter);
          return;
        }
        const aiStockAction = event.target.closest?.("[data-market-ai-stock-action]");
        if (aiStockAction) {
          const stockKey = aiStockAction.dataset.marketAiStockKey || aiStockAction.closest?.("[data-market-ai-stock]")?.dataset.marketAiStock;
          if (aiStockAction.dataset.marketAiStockAction === "watch") addAiStockToWatchlist(stockKey, aiStockAction);
          else openAiStockAnalysis(stockKey);
          return;
        }
        const heatmapModeButton = event.target.closest?.("[data-market-heatmap-mode]");
        if (heatmapModeButton) {
          window.__fumanMarketHeatmapMode = heatmapModeButton.dataset.marketHeatmapMode || "all";
          const panel = ensureMarketScaffold();
          const heatPayload = window.__fumanMarketHeatmapPayload?.heatPayload || {};
          renderHeatmapCards(panel, heatPayload);
          return;
        }
        const close = event.target.closest?.("[data-market-direct-close]");
        if (close || event.target.matches?.("[data-market-direct-modal]")) {
          document.querySelector("[data-market-direct-modal]")?.remove();
          return;
        }
        const card = event.target.closest?.("[data-market-direct-sector]");
        if (card) openSector(card.dataset.marketDirectSector);
      }, true);
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const aiDrilldown = event.target.closest?.("[data-market-ai-drilldown]");
        if (!aiDrilldown) return;
        event.preventDefault();
        openAiDrilldown(aiDrilldown.dataset.marketAiDrilldown);
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
