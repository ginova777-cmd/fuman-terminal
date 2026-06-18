(function () {
  "use strict";

  function install(context) {
    const {
      document, window, localStorage, FUMAN_UI_CONFIG, viewPanels, endpoints,
      isViewActive, isTerminalUnlocked, isDocumentHidden, loadFumanStyle, deferUiWork, syncMobileStrategyVisibility, arrangeWatchlistSearch,
      cleanNumber, normalizeArray, normalizeTradeVolumeLots, normalizeMarketAiDateKey, marketAiTodayKey, marketAiQuoteDateKey,
      refreshDataFreshnessBars, fetchJson, fetchVersionedJson, loadStrategyStocks, loadInstitution, getInstitutionTotal, formatInstitution,
      latestStocksRef, institutionDataRef, valueOf, rankValue, clamp, formatStockPrice, roundTradePrice, estimateTradeValue, radarMoney,
      showView, applyStrategyPresetFromLink, recordFumanPerformance, loadFumanFeatureModule
    } = context;
    const latestStocks = new Proxy([], {
      get(_target, prop) { const rows = latestStocksRef.get() || []; const value = rows[prop]; return typeof value === "function" ? value.bind(rows) : value; },
      set(_target, prop, value) { const rows = latestStocksRef.get() || []; rows[prop] = value; return true; }
    });
    const institutionData = new Proxy({}, {
      get(_target, prop) { return (institutionDataRef.get() || {})[prop]; },
      ownKeys() { return Reflect.ownKeys(institutionDataRef.get() || {}); },
      getOwnPropertyDescriptor(_target, prop) { return Object.getOwnPropertyDescriptor(institutionDataRef.get() || {}, prop) || { enumerable: true, configurable: true }; }
    });

    // ===== 自選股功能 =====
    const watchlistView = document.querySelector("#watchlist-view");
    const watchlistStocks = document.querySelector("#watchlist-stocks");
    const watchlistAnalysis = document.querySelector("#watchlist-analysis");
    const watchlistSearchInput = document.querySelector("#watchlist-search-input");
    const watchlistAddBtn = document.querySelector("#watchlist-add-btn");
    const watchlistRefresh = document.querySelector("#watchlist-refresh");
    
    function getWatchlist() {
      try { return JSON.parse(localStorage.getItem("fuman_watchlist") || "[]"); } catch { return []; }
    }
    
    function saveWatchlist(list) {
      localStorage.setItem("fuman_watchlist", JSON.stringify(list));
    }

    function isMobileWatchlistViewport() {
      const width = window.innerWidth || document.documentElement.clientWidth || 0;
      const height = window.innerHeight || document.documentElement.clientHeight || 0;
      return width <= 760 || (width <= 920 && height <= 430 && width > height);
    }

    function setWatchlistDetailOpen(open) {
      watchlistView?.classList.toggle("watchlist-detail-open", Boolean(open));
      document.body.classList.toggle("watchlist-detail-open", Boolean(open));
    }

    function updateWatchlistEntryStatus() {
      const card = document.querySelector("#watchlist-view .watchlist-entry-card");
      if (!card) return;
      const now = new Date();
      const dateText = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
      const timeText = now.toLocaleTimeString("zh-TW", {hour12:false});
      card.dataset.watchStatus = `模式：自選股｜即時/盤後資料｜資料日期：${dateText}｜今日：${dateText}｜更新：${timeText}`;
    }
    
    function ensureWatchlistAnalysisStyles() {
      const version = window.FUMAN_TERMINAL_VERSION || window.FUMAN_TERMINAL_BOOT?.version || Date.now();
      loadFumanStyle(`terminal-watchlist.css?v=${encodeURIComponent(version)}`, "watchlist-analysis-styles");
    }
    
    function showTVAnalysis(code, name) {
      const symbol = `TWSE:${code}`;
      const isLightTheme = document.body.classList.contains("fuman-light-theme");
      const headerBorder = isLightTheme ? "#dbe3ee" : "#2a2f45";
      const headerMuted = isLightTheme ? "#64748b" : "#aaa";
      const headerText = isLightTheme ? "#111827" : "#fff";
      const widgetTheme = isLightTheme ? "light" : "dark";
      watchlistAnalysis.innerHTML = `
        <div style="width:100%; padding:16px 20px 0; border-bottom:1px solid ${headerBorder};">
          <div style="color:${headerMuted}; font-size:12px;">技術分析</div>
          <div style="font-size:18px; font-weight:700; color:${headerText}; margin-top:2px;">${code} ${name}</div>
        </div>
        <div style="flex:1; width:100%; display:flex; flex-direction:column; gap:0;">
          <div class="tradingview-widget-container" style="flex:1; min-height:460px;">
            <div class="tradingview-widget-container__widget"></div>
            <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js" async>
            {
              "interval": "1D",
              "width": "100%",
              "isTransparent": true,
              "height": "100%",
              "symbol": "${symbol}",
              "showIntervalTabs": true,
              "displayMode": "single",
              "locale": "zh_TW",
              "colorTheme": "${widgetTheme}"
            }
            <\/script>
          </div>
        </div>
      `;
    }
    
    function signalLabel(score) {
      if (score >= 76) return "強力買入";
      if (score >= 58) return "買入";
      if (score >= 43) return "中立";
      if (score >= 26) return "賣出";
      return "強力賣出";
    }
    
    function signalClass(score) {
      if (score >= 58) return "buy";
      if (score >= 43) return "neutral";
      return "sell";
    }
    
    const technicalTimeframes = FUMAN_UI_CONFIG.technicalTimeframes || [];
    
    let selectedTechnicalTimeframe = localStorage.getItem("fuman-technical-timeframe") || "1D";
    let watchlistRefreshLoading = false;
    
    function getTechnicalTimeframe(key = selectedTechnicalTimeframe) {
      return technicalTimeframes.find((item) => item.key === key) || technicalTimeframes.find((item) => item.key === "1D");
    }
    
    function buildTimeframeButtons(activeKey) {
      return technicalTimeframes.map((item) => `
        <button class="ta-timeframe ${item.key === activeKey ? "active" : ""}" type="button" data-timeframe="${item.key}">
          ${item.label}
        </button>
      `).join("");
    }
    
    function dashboardGaugeMarkup(code, analysis) {
      return `
        <section class="watch-ta-panel">
          ${gaugeMarkup(`${code}的技術分析`, analysis.score, "large")}
        </section>
      `;
    }
    
    function hexToRgb(hex) {
      const value = hex.replace("#", "");
      return {
        r: parseInt(value.slice(0, 2), 16),
        g: parseInt(value.slice(2, 4), 16),
        b: parseInt(value.slice(4, 6), 16),
      };
    }
    
    function mixColor(from, to, ratio) {
      const a = hexToRgb(from);
      const b = hexToRgb(to);
      const blend = (start, end) => Math.round(start + (end - start) * ratio);
      return `rgb(${blend(a.r, b.r)}, ${blend(a.g, b.g)}, ${blend(a.b, b.b)})`;
    }
    
    function colorAtGaugeAngle(angle) {
      const stops = [
        { angle: 0, color: "#2f8cff" },
        { angle: 42, color: "#4d6cf2" },
        { angle: 86, color: "#8743b9" },
        { angle: 126, color: "#d43d88" },
        { angle: 158, color: "#ff4964" },
        { angle: 180, color: "#ff4964" },
      ];
      for (let i = 1; i < stops.length; i++) {
        if (angle <= stops[i].angle) {
          const prev = stops[i - 1];
          const next = stops[i];
          const ratio = (angle - prev.angle) / (next.angle - prev.angle);
          return mixColor(prev.color, next.color, ratio);
        }
      }
      return stops[stops.length - 1].color;
    }
    
    function gaugeGradient(score) {
      const fill = clamp(score, 0, 100) / 100 * 180;
      const track = "rgba(128, 132, 122, 0.72)";
      const baseStops = [
        { angle: 0, color: "#2f8cff" },
        { angle: 42, color: "#4d6cf2" },
        { angle: 86, color: "#8743b9" },
        { angle: 126, color: "#d43d88" },
        { angle: 158, color: "#ff4964" },
      ];
      const visibleStops = baseStops
        .filter((stop) => stop.angle <= fill)
        .map((stop) => `${stop.color} ${stop.angle}deg`);
      const fillColor = colorAtGaugeAngle(fill);
    
      if (fill <= 1) {
        return `conic-gradient(from 270deg at 50% 100%, ${track} 0deg 180deg, transparent 180deg 360deg)`;
      }
    
      return `conic-gradient(from 270deg at 50% 100%, ${visibleStops.join(", ")}, ${fillColor} ${fill.toFixed(1)}deg, ${track} ${fill.toFixed(1)}deg 180deg, transparent 180deg 360deg)`;
    }
    
    function buildTechnicalSummary(stock, timeframeKey = selectedTechnicalTimeframe) {
      const timeframe = getTechnicalTimeframe(timeframeKey);
      const pct = stock?.percent || 0;
      const inst = getInstitutionTotal(stock?.code);
      const smartMoney = inst.total + inst.trust * 1.35;
      const volumeValues = latestStocks.map(s => s.tradeVolume || 0).filter(Boolean).sort((a, b) => a - b);
      const volumeRank = stock?.tradeVolume && volumeValues.length ? rankValue(stock.tradeVolume, volumeValues) : 50;
      const valueRank = stock?.value ? rankValue(stock.value, latestStocks.map(s => s.value || 0).sort((a, b) => a - b)) : 50;
      const moneyBias = Math.sign(smartMoney) * 8 * timeframe.money;
      const momentumScore = clamp(Math.round(50 + pct * 8 * timeframe.momentum + valueRank * timeframe.volume + moneyBias), 0, 100);
      const oscillatorScore = clamp(Math.round(50 + pct * 10 * timeframe.momentum + volumeRank * timeframe.volume), 0, 100);
      const maScore = clamp(Math.round(48 + pct * 9 * (0.74 + timeframe.money * 0.18) + valueRank * timeframe.volume + Math.sign(stock?.change || 0) * 6), 0, 100);
      const sell = clamp(Math.round((100 - momentumScore) / 6), 0, 15);
      const buy = clamp(Math.round(momentumScore / 6), 1, 15);
      const neutral = clamp(17 - sell - buy, 0, 17);
    
      return {
        score: momentumScore,
        oscillatorScore,
        maScore,
        sell,
        neutral,
        buy,
        foreign: inst.foreign,
        trust: inst.trust,
        hasInstitution: Boolean(institutionData[stock?.code]),
        volumeRank: stock?.tradeVolume && volumeValues.length ? volumeRank : null,
      };
    }
    
    function formatVolumeMetric(stock, analysis) {
      if (analysis.volumeRank !== null) return `${analysis.volumeRank}%`;
      if (stock?.tradeVolume) return `${Math.round(stock.tradeVolume).toLocaleString("zh-TW")}張`;
      return "載入中";
    }
    
    function pctText(value) {
      const number = cleanNumber(value);
      return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
    }
    
    function watchToneClass(value) {
      const number = cleanNumber(value);
      if (number > 0) return "watch-up";
      if (number < 0) return "watch-down";
      return "watch-flat";
    }
    
    function formatLots(value) {
      const number = normalizeTradeVolumeLots(value);
      if (!number) return "--";
      return `${Math.round(number).toLocaleString("zh-TW")} 張`;
    }
    
    function buildWatchAnalysisModel(stock, analysis, timeframe) {
      const close = cleanNumber(stock.close);
      const open = cleanNumber(stock.open);
      const high = cleanNumber(stock.high) || Math.max(close, open || close);
      const low = cleanNumber(stock.low) || Math.min(close, open || close);
      const prevClose = cleanNumber(stock.prevClose) || close - cleanNumber(stock.change);
      const pct = cleanNumber(stock.percent);
      const range = Math.max(high - low, 0);
      const rangePosition = range ? clamp(Math.round(((close - low) / range) * 100), 0, 100) : 50;
      const inst = getInstitutionTotal(stock.code);
      const supportA = close ? close * 0.997 : 0;
      const supportB = close ? Math.max(low || 0, close * 0.985) : 0;
      const supportC = close ? close * 0.97 : 0;
      const pressureA = close ? Math.max(high || 0, close * 1.012) : 0;
      const pressureB = close ? close * 1.02 : 0;
      const pressureC = close ? close * 1.04 : 0;
      const volumeLots = normalizeTradeVolumeLots(stock.tradeVolume || stock.volume);
      const turnoverValue = cleanNumber(stock.value) || estimateTradeValue(close, volumeLots);
      const instRow = institutionData[stock.code] || {};
      const instVolume = cleanNumber(stock.tradeVolume || instRow.tradeVolume || instRow.volume);
      const instFlowRatio = instVolume ? (inst.total / instVolume) * 100 : 0;
      const instFlowAbs = Math.abs(instFlowRatio);
      const streakBonus = Math.min(cleanNumber(instRow.foreignStreak) * 2 + cleanNumber(instRow.trustStreak) * 3 + cleanNumber(instRow.jointStreak) * 4, 18);
      const flowBonus = Math.min(instFlowAbs * 8, 24);
      const chipScore = analysis.hasInstitution
        ? clamp(Math.round(50 + Math.sign(inst.total) * 10 + Math.sign(inst.trust) * 8 + Math.sign(inst.total) * flowBonus + (inst.total > 0 ? streakBonus : -streakBonus)), 0, 100)
        : 0;
      const trendLabel = analysis.score >= 70
        ? "強勢整理"
        : analysis.score >= 58
          ? "偏多整理"
          : analysis.score >= 43
            ? "弱勢整理"
            : "轉弱觀察";
      const strategyLabel = analysis.score >= 70
        ? "等待拉回"
        : analysis.score >= 58
          ? "等待轉強"
          : analysis.score >= 43
            ? "等待確認"
            : "先避開";
      const riskLabel = pct >= 7
        ? "漲幅過熱"
        : pct <= -5
          ? "跌幅偏深"
          : rangePosition >= 82
            ? "追高風險"
            : "風險可控";
      const actionTitle = analysis.score >= 58 ? "等待轉強" : "等待確認";
      const actionHint = analysis.score >= 58
        ? `先等量價延續，站回 ${formatStockPrice(pressureA)} 後再觀察。`
        : `先看 ${formatStockPrice(supportA)} 是否守住，不急著追。`;
      const dataQuality = [
        `即時/收盤價格：${formatStockPrice(close)}，漲跌幅 ${pctText(pct)}，資料來源為終端現有市場資料。`,
        analysis.hasInstitution
          ? `法人資料可用：外資 ${formatInstitution(inst.foreign)}，投信 ${formatInstitution(inst.trust)}，法人合計 ${formatInstitution(inst.total)}。`
          : "法人資料目前尚未完整更新，籌碼判斷以盤後資料為主。",
        `成交量 ${formatLots(volumeLots)}，成交金額約 ${radarMoney(turnoverValue)}，量能排名 ${analysis.volumeRank ?? "--"}%。`,
      ];
      const technical = [
        `趨勢方向：${trendLabel}，${timeframe.label} 動能分 ${analysis.score}，震盪分 ${analysis.oscillatorScore}，均線分 ${analysis.maScore}。`,
        `當日位置：高 ${formatStockPrice(high)}、低 ${formatStockPrice(low)}、收 ${formatStockPrice(close)}，收盤位於區間約 ${rangePosition}%。`,
        `支撐觀察：${formatStockPrice(supportA)}、${formatStockPrice(supportB)}、${formatStockPrice(supportC)}；壓力觀察：${formatStockPrice(pressureA)}、${formatStockPrice(pressureB)}、${formatStockPrice(pressureC)}。`,
      ];
      const chips = [
        analysis.hasInstitution
          ? `外資 ${formatInstitution(inst.foreign)}，投信 ${formatInstitution(inst.trust)}，法人合計 ${formatInstitution(inst.total)}，籌碼分 ${chipScore}。`
          : "法人資料尚未完整，先不把籌碼視為主要決策依據。",
        inst.total > 0
          ? "法人合計偏買，若量價同步續強，籌碼可視為加分。"
          : inst.total < 0
            ? "法人合計偏賣，若價格跌破支撐，需優先控制風險。"
            : "法人合計中性，仍以價格與成交量變化為主。",
      ];
      const bullPoints = [
        pct > 0 ? `股價上漲 ${pctText(pct)}，短線仍有動能。` : "若能重新站回平盤並放量，才有轉強條件。",
        rangePosition >= 50 ? "收盤位於日內中上區，買盤承接尚可。" : "收盤位置偏低，需要先確認承接。",
        chipScore >= 60 ? "法人籌碼偏多，對後續續航有加分。" : "籌碼尚未明顯偏多，需等待確認。",
      ];
      const bearPoints = [
        rangePosition >= 82 ? "收盤接近日內高位，短線追價風險上升。" : `跌破 ${formatStockPrice(supportA)} 後，短線轉弱機率提高。`,
        pct >= 7 ? "單日漲幅偏大，隔日容易震盪洗盤。" : "若量能縮小，容易變成整理而非續攻。",
        chipScore <= 40 && analysis.hasInstitution ? "法人籌碼偏弱，需避免只看價格追高。" : "若法人買盤不延續，仍需回到量價確認。",
      ];
      const summary = [
        `${stock.code} ${stock.name || ""} 目前判斷為「${trendLabel}」，現價 ${formatStockPrice(close)}，漲幅 ${pctText(pct)}。`,
        `主要支撐看 ${formatStockPrice(supportA)} / ${formatStockPrice(supportB)}，壓力看 ${formatStockPrice(pressureA)} / ${formatStockPrice(pressureB)}。`,
        `操作提醒：${actionHint}`,
        "以上為系統量價與籌碼整理，不構成投資建議。",
      ];
    
      return {
        close,
        prevClose,
        pct,
        high,
        low,
        rangePosition,
        trendLabel,
        strategyLabel,
        riskLabel,
        actionTitle,
        actionHint,
        supportA,
        supportB,
        supportC,
        pressureA,
        pressureB,
        pressureC,
        chipScore,
        instFlowRatio,
        inst,
        volumeLots,
        turnoverValue,
        dataQuality,
        technical,
        chips,
        bullPoints,
        bearPoints,
        summary,
      };
    }
    
    function gaugeMarkup(title, score, size = "small") {
      const rotation = Math.round(180 + (clamp(score, 0, 100) / 100) * 180);
      const label = signalLabel(score);
      const tone = signalClass(score);
      const gradient = gaugeGradient(score);
      const sell = clamp(Math.round((100 - score) / 6), 0, 15);
      const buy = clamp(Math.round(score / 6), 1, 15);
      const neutral = clamp(17 - sell - buy, 0, 17);
      return `
        <article class="ta-gauge-card ${size}">
          <h3>${title}</h3>
          <div class="ta-gauge ${tone}" style="--needle:${rotation}deg; --gauge-bg:${gradient};">
            <span class="gauge-label l1">強力賣出</span>
            <span class="gauge-label l2">賣出</span>
            <span class="gauge-label l3">中立</span>
            <span class="gauge-label l4">買入</span>
            <span class="gauge-label l5">強力買入</span>
            <i></i>
          </div>
          <strong class="${tone}">${label}</strong>
          <div class="ta-gauge-votes">
            <div><span>賣出</span><b class="sell">${sell}</b></div>
            <div><span>中立</span><b>${neutral}</b></div>
            <div><span>買入</span><b class="buy">${buy}</b></div>
          </div>
        </article>
      `;
    }
    
    function scoreTone(score) {
      if (score >= 70) return "good";
      if (score >= 45) return "mid";
      return "bad";
    }
    
    function buildDashboardScores(stock, analysis) {
      const pct = stock?.percent || 0;
      const volumeScore = analysis.volumeRank ?? 50;
      const chipScore = analysis.hasInstitution
        ? clamp(Math.round(50 + Math.sign(analysis.foreign) * 16 + Math.sign(analysis.trust) * 22), 0, 100)
        : null;
      const shortScore = clamp(Math.round(analysis.oscillatorScore * 0.58 + analysis.score * 0.28 + volumeScore * 0.14), 0, 100);
      const swingScore = clamp(Math.round(analysis.maScore * 0.52 + analysis.score * 0.28 + (chipScore ?? 50) * 0.20), 0, 100);
      const tags = [];
    
      if (pct >= 7) tags.push({ text: "漲幅過熱", tone: "bad" });
      if (pct <= -7) tags.push({ text: "跌幅偏深", tone: "bad" });
      if (analysis.volumeRank !== null && analysis.volumeRank >= 80) tags.push({ text: "量能放大", tone: "good" });
      if (analysis.volumeRank !== null && analysis.volumeRank <= 25) tags.push({ text: "量能偏冷", tone: "mid" });
      if (!analysis.hasInstitution) tags.push({ text: "法人盤後", tone: "mid" });
      if (analysis.hasInstitution && analysis.foreign > 0 && analysis.trust > 0) tags.push({ text: "法人同步買", tone: "good" });
      if (!tags.length) tags.push({ text: "正常觀察", tone: "mid" });
    
      return {
        shortScore,
        swingScore,
        chipScore,
        tags: tags.slice(0, 3),
      };
    }
    
    function dashboardScoreMarkup(stock, analysis) {
      const scores = buildDashboardScores(stock, analysis);
      const chipText = scores.chipScore === null ? "盤後" : scores.chipScore;
      const tagMarkup = scores.tags.map((tag) => `<span class="${tag.tone}">${tag.text}</span>`).join("");
    
      return `
        <section class="ta-score-strip">
          <article class="${scoreTone(scores.shortScore)}">
            <span>短線分</span>
            <strong>${scores.shortScore}</strong>
            <em>看盤動能</em>
          </article>
          <article class="${scoreTone(scores.swingScore)}">
            <span>波段分</span>
            <strong>${scores.swingScore}</strong>
            <em>趨勢強弱</em>
          </article>
          <article class="risk">
            <span>狀態提示</span>
            <div>${tagMarkup}</div>
          </article>
        </section>
      `;
    }
    
    const watchlistStrategySources = [
      { key: "openBuy", label: "策略1-明日開盤入", urls: () => [endpoints.openBuyCache, endpoints.openBuyBackup], fields: ["matches"] },
      { key: "strategy2", label: "策略2-當沖雷達", urls: () => [endpoints.strategy2IntradayLiveTop, endpoints.strategy2IntradayTop, endpoints.strategy2IntradaySlim], fields: ["events", "records"] },
      { key: "strategy3", label: "策略3-隔日沖", urls: () => [endpoints.strategy3Cache, endpoints.strategy3Backup], fields: ["matches"] },
      { key: "strategy4", label: "策略4-波段", urls: () => [endpoints.strategy4ScoreTop, endpoints.strategy4ZoneA, endpoints.strategy4ZoneBPage1], fields: ["matches"] },
      { key: "strategy5", label: "策略5-綜合策略", urls: () => [endpoints.strategy5Cache, endpoints.strategy5Backup], fields: ["matches"] },
      { key: "realtime", label: "即時雷達", urls: () => [endpoints.realtimeRadarCache], fields: ["rows"] },
      { key: "institution", label: "買賣超", urls: () => [endpoints.institutionCache, endpoints.institutionSlim, endpoints.institutionMobileTop], fields: ["data", "rows", "matches"], dataObject: true },
      { key: "cb", label: "CB名單", urls: () => [endpoints.cbDetectCache], fields: ["rows", "matches"] },
      { key: "warrant", label: "權證", urls: () => [endpoints.warrantFlowCache, endpoints.warrantFlowMobileTop, endpoints.warrantFlowSlim], fields: ["matches", "rows"], codeField: "underlyingCode" },
    ];
    
    function watchlistRowsFromPayload(payload, fields = []) {
      if (Array.isArray(payload)) return payload;
      return fields.flatMap((field) => {
        const value = payload?.[field];
        if (value && !Array.isArray(value) && typeof value === "object") return Object.values(value);
        return normalizeArray(value);
      });
    }
    
    function watchlistSignalLabelById(id) {
      const key = String(id || "").trim();
      if (!key) return "";
      const defs = [
        ...Object.values(STRATEGY_BY_ID || {}),
        ...normalizeArray(FUMAN_STRATEGY_CONFIG.INTRADAY_SIGNAL_DEFS),
        ...normalizeArray(FUMAN_STRATEGY_CONFIG.SWING_SIGNAL_DEFS),
      ];
      const match = defs.find((item) => item?.id === key);
      return match?.label || match?.title || "";
    }
    
    function watchlistSignalText(value) {
      if (!value) return "";
      if (typeof value === "string") {
        return watchlistSignalLabelById(value) || value;
      }
      const id = value.id || value.strategy;
      return value.label || value.name || value.title || watchlistSignalLabelById(id) || value.strategy || value.id || "";
    }
    
    function watchlistStrategyDetails(row, sourceKey = "") {
      const detailSources = {
        openBuy: [
          row.setup,
          row.status,
        ],
        strategy2: [
          row.strategy,
          row.stateLabel,
          ...normalizeArray(row.strategies).map(watchlistSignalText),
          ...normalizeArray(row.intradaySignals).map(watchlistSignalText),
        ],
        strategy3: [
          row.setup,
          row.status,
          ...normalizeArray(row.matches).map(watchlistSignalText),
        ],
        strategy4: [
          row.strategyLabel,
          ...normalizeArray(row.signals).map(watchlistSignalText),
          ...normalizeArray(row.swingSignals).map(watchlistSignalText),
        ],
        strategy5: [
          row.activeMatch,
          ...normalizeArray(row.matches).filter((match) => STRATEGY5_BASE_PRESET_IDS.includes(match?.id)).map(watchlistSignalText),
        ],
        realtime: [
          ...normalizeArray(row.signalTags).map(watchlistSignalText),
        ],
        institution: [
          row.total > 0 ? "法人合計買超" : row.total < 0 ? "法人合計賣超" : "法人中性",
          row.foreign > 0 ? "外資買超" : row.foreign < 0 ? "外資賣超" : "",
          row.trust > 0 ? "投信買超" : row.trust < 0 ? "投信賣超" : "",
          row.jointStreak ? `連買${row.jointStreak}日` : "",
        ],
        cb: [
          row.entryLabel,
          row.tradableLabel,
          row.conversionPriceLabel,
          row.sourceLayer,
          row.cbName,
        ],
        warrant: [
          row.signalGrade ? `等級${row.signalGrade}` : "",
          row.actionLabel,
          row.stockSetupLabel,
          row.branchLabel,
          row.level ? `Level ${row.level}` : "",
        ],
      };
      const labels = (detailSources[sourceKey] || []).map(watchlistSignalText).map((item) => String(item || "").trim()).filter(Boolean);
      return [...new Set(labels)].slice(0, 4);
    }
    
    async function loadWatchlistStrategyIndex() {
      if (!endpoints.strategyMatchIndex) return null;
      if (!watchlistStrategyIndexPromise) {
        watchlistStrategyIndexPromise = fetchVersionedJson(endpoints.strategyMatchIndex, 4500, "latest", false)
          .then((payload) => {
            watchlistStrategyIndexCache = payload?.byCode && typeof payload.byCode === "object" ? payload : null;
            return watchlistStrategyIndexCache;
          })
          .catch(() => {
            watchlistStrategyIndexCache = null;
            return null;
          });
      }
      return watchlistStrategyIndexCache || await watchlistStrategyIndexPromise;
    }
    
    async function loadWatchlistStrategyMatches(code) {
      const targetCode = String(code || "");
      if (!targetCode) return [];
      const indexPayload = await loadWatchlistStrategyIndex();
      const indexed = normalizeArray(indexPayload?.byCode?.[targetCode]);
      if (indexed.length) {
        return indexed.map((match) => ({
          key: match.key || "",
          label: match.label || match.key || "",
          details: normalizeArray(match.details).slice(0, 5),
          score: cleanNumber(match.score),
          date: normalizeMarketAiDateKey(match.date || match.updatedAt),
        }));
      }
      if (!watchlistStrategyMatchPromise) {
        watchlistStrategyMatchPromise = Promise.all(watchlistStrategySources.map(async (source) => {
          const urls = source.urls().filter(Boolean);
          for (const url of urls) {
            try {
              const payload = await fetchVersionedJson(url, 9000, "latest", false);
              const rows = watchlistRowsFromPayload(payload, source.fields);
              if (!rows.length) continue;
              return {
                ...source,
                rows,
                date: normalizeMarketAiDateKey(payload?.usedDate || payload?.date || payload?.tradeDate || payload?.updatedAt),
              };
            } catch (error) {
            }
          }
          return { ...source, rows: [], date: "" };
        })).then((sources) => {
          watchlistStrategyMatchCache = sources;
          return sources;
        });
      }
      const sources = watchlistStrategyMatchCache || await watchlistStrategyMatchPromise;
      return sources.flatMap((source) => {
        const codeField = source.codeField || "code";
        const rows = normalizeArray(source.rows).filter((row) => String(row?.[codeField] || row?.code || "") === targetCode);
        if (!rows.length) return [];
        const details = [...new Set(rows.flatMap((row) => watchlistStrategyDetails(row, source.key)))].slice(0, 5);
        const score = Math.max(...rows.map((row) => cleanNumber(row.score || row.maxScore)).filter(Boolean), 0);
        return [{
          key: source.key,
          label: source.label,
          details,
          score,
          date: source.date,
        }];
      });
    }
    
    const WATCHLIST_CHIP_MATCH_KEYS = new Set(["institution", "cb", "warrant"]);

    function watchlistMatchPill(match) {
      const detail = match.details.length ? `：${match.details.join("、")}` : "";
      return `<span>${escapeAttr(match.label)}${escapeAttr(detail)}</span>`;
    }

    function watchlistMatchGroupMarkup(title, matches, emptyText) {
      const pills = matches.map(watchlistMatchPill).join("");
      return `
        <div class="watch-match-group">
          <b>${title} ${matches.length}</b>
          <div class="watch-strategy-list">${pills || `<span class="empty">${emptyText}</span>`}</div>
        </div>
      `;
    }

    function watchlistStrategySummaryMarkup(matches) {
      if (!matches.length) {
        return `<strong>0</strong><em>未出現在策略 / 籌碼終端</em>`;
      }
      const strategyMatches = matches.filter((match) => !WATCHLIST_CHIP_MATCH_KEYS.has(match.key));
      const chipMatches = matches.filter((match) => WATCHLIST_CHIP_MATCH_KEYS.has(match.key));
      return `
        <strong>${matches.length}</strong>
        <em>策略 ${strategyMatches.length}｜籌碼 ${chipMatches.length}</em>
        <div class="watch-match-grid">
          ${watchlistMatchGroupMarkup("策略命中", strategyMatches, "未命中策略")}
          ${watchlistMatchGroupMarkup("籌碼命中", chipMatches, "未命中籌碼")}
        </div>
      `;
    }
    
    async function showTradingDashboard(code, name) {
      ensureWatchlistAnalysisStyles();
      setWatchlistDetailOpen(true);
      watchlistAnalysis.innerHTML = `
        <div class="watch-analysis-panel ta-dashboard blackbean-stock-detail">
          <section class="watch-detail-hero">
            <button class="watch-detail-close" type="button" data-watch-back aria-label="返回個股清單">×</button>
            <span>AI 個股判讀</span>
            <h2>${code} 技術分析</h2>
            <p>正在載入 ${code} 的個股資料。</p>
          </section>
          <div class="watch-mobile-empty">載入資料中...</div>
        </div>
      `;
      watchlistAnalysis.querySelector("[data-watch-back]")?.addEventListener("click", () => {
        setWatchlistDetailOpen(false);
        watchlistAnalysis.innerHTML = `<div class="watch-mobile-empty">點選股票查看 AI 個股判讀</div>`;
      });
      const fallback = latestStocks.find(s => s.code === code) || { code, name, close: 0, change: 0, percent: 0 };
      const [stockSettled, strategySettled] = await Promise.allSettled([
        fetchStockPrice(code),
        loadWatchlistStrategyMatches(code),
        typeof loadInstitution === "function" ? loadInstitution() : Promise.resolve(null),
      ]);
      const stock = stockSettled.status === "fulfilled" && stockSettled.value ? stockSettled.value : fallback;
      const strategyMatches = strategySettled.status === "fulfilled" ? normalizeArray(strategySettled.value) : [];
      const activeTimeframe = getTechnicalTimeframe();
      watchlistDashboardSignature = `${code}:${stock.close}:${stock.change.toFixed(2)}:${stock.percent.toFixed(2)}:${activeTimeframe.key}`;
      const analysis = buildTechnicalSummary(stock, activeTimeframe.key);
      const sign = stock.change >= 0 ? "+" : "";
      const changeClass = stock.change >= 0 ? "down" : "up";
      const trustText = analysis.hasInstitution ? `${analysis.trust >= 0 ? "+" : ""}${(analysis.trust / 1000).toFixed(0)}k` : "盤後";
      const trustClass = analysis.hasInstitution ? (analysis.trust >= 0 ? "down" : "up") : "";
      const volumeText = formatVolumeMetric(stock, analysis);
      const model = buildWatchAnalysisModel(stock, analysis, activeTimeframe);
      const trendTone = analysis.score >= 58 ? "good" : analysis.score >= 43 ? "neutral" : "warn";
      const riskTone = model.riskLabel === "風險可控" ? "good" : "warn";
      const changeTone = stock.percent >= 0 ? "watch-up" : "watch-down";
      const riskCount = model.riskLabel === "風險可控" ? 0 : 1;
      const riskHint = riskCount
        ? (model.riskLabel === "追高風險" ? "盤中位置偏高，追價風險較高。" : "短線波動偏大，先控制風險。")
        : "目前沒有明顯過熱風險，仍需搭配成交量確認。";
      const chipTitle = analysis.hasInstitution
        ? (model.chipScore >= 60 ? "籌碼偏強" : model.chipScore <= 40 ? "籌碼偏弱" : "籌碼待確認")
        : "法人盤後";
      const mainScore = analysis.hasInstitution ? clamp(Math.round(analysis.score * 0.58 + model.chipScore * 0.42), 0, 100) : null;
      const chipScoreText = analysis.hasInstitution ? model.chipScore : "--";
      const mainScoreText = mainScore === null ? "--" : mainScore;
      const chipDetailText = analysis.hasInstitution
        ? `外資 ${formatInstitution(model.inst.foreign)}，投信 ${formatInstitution(model.inst.trust)}，法人合計 ${formatInstitution(model.inst.total)}；法人淨流向約成交量 ${model.instFlowRatio.toFixed(2)}%。`
        : "法人資料尚未完整，外資與投信以盤後更新後再判讀。";
    
      watchlistAnalysis.innerHTML = `
        <div class="watch-analysis-panel ta-dashboard blackbean-stock-detail">
          <section class="watch-detail-hero">
            <button class="watch-detail-close" type="button" data-watch-back aria-label="返回個股清單">×</button>
            <span>AI 個股判讀</span>
            <h2>${code} 技術分析</h2>
            <p>已帶入 ${code}，可載入資料後查看 AI 個股判讀。</p>
          </section>
          <section class="watch-action-row">
            <label>
              股票代碼
              <input value="${code}" readonly>
            </label>
            <button class="primary" type="button" data-watch-load>⌁ 載入資料</button>
          </section>
    
          <section class="watch-summary-grid">
            <article class="watch-metric">
              <span>標的</span>
              <strong>${code} ${stock.name || name || ""}</strong>
            </article>
            <article class="watch-metric">
              <span>趨勢判斷</span>
              <strong class="${trendTone === "good" ? "watch-up" : trendTone === "warn" ? "watch-down" : "watch-flat"}">${model.trendLabel}</strong>
            </article>
            <article class="watch-metric">
              <span>漲跌幅</span>
              <strong class="${changeTone}">${pctText(stock.percent)}</strong>
              <em>前收 ${formatStockPrice(model.prevClose)} → 現價 ${formatStockPrice(stock.close)}</em>
            </article>
            <article class="watch-metric">
              <span>符合策略 / 籌碼</span>
              ${watchlistStrategySummaryMarkup(strategyMatches)}
            </article>
          </section>
    
          <section class="watch-detail-sections">
            <article class="watch-detail-section-card trend ${trendTone}">
              <span>趨勢</span>
              <strong>${model.trendLabel}</strong>
              <b>${pctText(stock.percent)}</b>
              <em>收盤位於日內區間 ${model.rangePosition}%。</em>
            </article>
            <article class="watch-detail-section-card price">
              <span>價位</span>
              <strong>現價 ${formatStockPrice(model.close)}</strong>
              <b>${formatStockPrice(model.supportA)} / ${formatStockPrice(model.pressureA)}</b>
              <em>支撐觀察：${formatStockPrice(model.supportA)}、${formatStockPrice(model.supportB)}、${formatStockPrice(model.supportC)}；壓力觀察：${formatStockPrice(model.pressureA)}、${formatStockPrice(model.pressureB)}、${formatStockPrice(model.pressureC)}。</em>
            </article>
            <article class="watch-detail-section-card chip">
              <span>籌碼</span>
              <strong>${chipTitle}</strong>
              <b>籌碼 ${chipScoreText} / 主力 ${mainScoreText}</b>
              <em>${chipDetailText}</em>
            </article>
            <article class="watch-detail-section-card risk ${riskTone}">
              <span>風險</span>
              <strong>${model.riskLabel === "風險可控" ? "風險可控" : "先控風險"}</strong>
              <b>${riskCount} 則</b>
              <em>${riskHint}</em>
            </article>
            <article class="watch-detail-section-card action">
              <span>操作提醒</span>
              <strong>${model.actionTitle}</strong>
              <b>支撐 ${formatStockPrice(model.supportA)}</b>
              <em>${model.actionHint}</em>
            </article>
          </section>
    
          <section class="watch-note-row">
            <article><b>1</b><small>${code} ${stock.name || ""}：${model.trendLabel}，漲跌幅 ${pctText(stock.percent)}，收盤位於日內區間 ${model.rangePosition}%。</small></article>
            <article><b>2</b><small>支撐觀察：${formatStockPrice(model.supportA)}、${formatStockPrice(model.supportB)}、${formatStockPrice(model.supportC)}；壓力觀察：${formatStockPrice(model.pressureA)}、${formatStockPrice(model.pressureB)}、${formatStockPrice(model.pressureC)}。</small></article>
            <article><b>3</b><small>${model.riskLabel === "風險可控" ? "目前風險可控，但仍需搭配成交量確認。" : "短線波動偏高，先等待支撐或轉強訊號。"}</small></article>
          </section>
    
          <section class="ta-period-panel" data-watch-dashboard-panel>
            <nav class="ta-timeframes" aria-label="技術分析週期">
              <button class="ta-timeframe ta-dashboard-tab active" type="button" aria-current="page">儀表板</button>
              ${buildTimeframeButtons(activeTimeframe.key)}
            </nav>
            ${dashboardGaugeMarkup(code, analysis)}
          </section>
        </div>
      `;
    
      watchlistAnalysis.querySelectorAll(".ta-timeframe[data-timeframe]").forEach((button) => {
        button.addEventListener("click", () => {
          selectedTechnicalTimeframe = button.dataset.timeframe;
          localStorage.setItem("fuman-technical-timeframe", selectedTechnicalTimeframe);
          showTradingDashboard(code, stock.name || name);
        });
      });
    
      watchlistAnalysis.querySelector("[data-watch-load]")?.addEventListener("click", () => {
        showTradingDashboard(code, stock.name || name);
      });
      watchlistAnalysis.querySelector("[data-watch-back]")?.addEventListener("click", () => {
        setWatchlistDetailOpen(false);
        watchlistAnalysis.innerHTML = `<div class="watch-mobile-empty">點選股票查看 AI 個股判讀</div>`;
      });
    }
    
    function parseQuoteNumber(...values) {
      for (const value of values) {
        const text = String(value ?? "").replace(/,/g, "").trim();
        const firstLevel = text.includes("_") ? text.split("_").find(Boolean) : text;
        const number = Number(firstLevel);
        if (Number.isFinite(number) && number > 0) return number;
      }
      return 0;
    }
    
    function parseRealtimeQuotePrice(item) {
      const last = parseQuoteNumber(item?.z, item?.pz);
      if (last) return last;
      const bestBid = parseQuoteNumber(item?.b);
      const bestAsk = parseQuoteNumber(item?.a);
      if (bestBid && bestAsk) return roundTradePrice((bestBid + bestAsk) / 2);
      return parseQuoteNumber(bestBid, bestAsk, item?.o, item?.h, item?.l, item?.y);
    }
    
    async function fetchDailyStockFallback(code) {
      try {
        const rows = await loadStrategyStocks();
        const item = normalizeArray(rows).find((row) => String(row.code || row.Code || "") === code);
        if (!item) return null;
        const close = cleanNumber(item.close || item.ClosingPrice);
        const change = cleanNumber(item.change || item.Change);
        const previous = close - change;
        const percent = previous ? (change / previous) * 100 : 0;
        return { code, name: item.name || item.Name || code, close, change, percent, tradeVolume: cleanNumber(item.tradeVolume) || normalizeTradeVolumeLots(item.TradeVolume) };
      } catch {
        return null;
      }
    }

    async function fetchMobileTopStockFallback(code) {
      if (!endpoints.stocksQuotesMobileTop) return null;
      try {
        const payload = await fetchVersionedJson(endpoints.stocksQuotesMobileTop, 3500, "latest", false);
        const item = normalizeArray(payload?.quotes || payload?.stocks || payload).find((row) => String(row.code || row.Code || "") === code);
        if (!item) return null;
        const close = cleanNumber(item.close || item.ClosingPrice);
        const change = cleanNumber(item.change || item.Change);
        const previous = close - change;
        const percent = cleanNumber(item.percent ?? item.pct) || (previous ? (change / previous) * 100 : 0);
        return {
          code,
          name: item.name || item.Name || code,
          close,
          change,
          percent,
          tradeVolume: cleanNumber(item.tradeVolume) || normalizeTradeVolumeLots(item.TradeVolume),
          quoteDate: item.quoteDate || item.TradeDate || payload?.resolvedTradeDate || "",
          quoteTime: item.quoteTime || item.time || "",
        };
      } catch {
        return null;
      }
    }
    
    async function fetchHeatmapStockFallback(code) {
      try {
        const payload = await fetchJson(endpoints.heatmap, 12000);
        const sectors = normalizeArray(payload.sectors);
        for (const sector of sectors) {
          const item = normalizeArray(sector.stocks).find((row) => String(row.code || "") === code);
          if (!item) continue;
          const close = cleanNumber(item.close);
          const percent = cleanNumber(item.pct);
          const prev = cleanNumber(item.prev) || (percent === -100 ? close : close / (1 + percent / 100));
          const change = cleanNumber(item.change) || (close - prev);
          return {
            code,
            name: item.name || code,
            close,
            change,
            percent,
            value: cleanNumber(item.value),
            tradeVolume: cleanNumber(item.volume),
          };
        }
      } catch {}
      return null;
    }
    
    function updateWatchlistQuoteDate(stock) {
      const quoteDate = marketAiQuoteDateKey(stock) || (stock?.isRealtime ? marketAiTodayKey() : "");
      if (!quoteDate) return;
      if (!watchlistQuoteDateKey || quoteDate >= watchlistQuoteDateKey) {
        watchlistQuoteDateKey = quoteDate;
        refreshDataFreshnessBars();
      }
    }
    
    async function fetchStockPrice(code) {
      const cached = latestStocks.find(s => s.code === code) || null;
      try {
    
        const url = `/api/proxy?code=${code}`;
        const data = await fetchJson(url, 5000);
        const item = data?.msgArray?.[0];
        if (!item) return await fetchHeatmapStockFallback(code) || await fetchMobileTopStockFallback(code) || await fetchDailyStockFallback(code) || cached;
    
        const close = parseRealtimeQuotePrice(item);
        const prev = parseQuoteNumber(item.y, item.z, item.o, item.h, item.l);
        if (!close || !prev) return await fetchHeatmapStockFallback(code) || await fetchMobileTopStockFallback(code) || await fetchDailyStockFallback(code) || cached;
        const change = close - prev;
        const percent = prev ? (change / prev) * 100 : 0;
        return {
          code,
          name: item.n || code,
          close,
          change,
          percent,
          tradeVolume: parseQuoteNumber(item.v, item.tv),
          quoteDate: normalizeMarketAiDateKey(item.d || item.date || item.tlong) || marketAiTodayKey(),
          quoteTime: item.t || item.ot || "",
          isRealtime: true,
        };
      } catch {
        return await fetchHeatmapStockFallback(code) || await fetchMobileTopStockFallback(code) || await fetchDailyStockFallback(code) || cached;
      }
    }
    
    async function renderWatchlist() {
      if (!isViewActive("watchlist") || !isTerminalUnlocked()) return;
      setWatchlistDetailOpen(false);
      updateWatchlistEntryStatus();
      const list = getWatchlist();
      if (!list.length) {
        const candidates = latestStocks.slice(0, 80);
        if (!candidates.length) {
          watchlistStocks.innerHTML = `<div class="watch-mobile-empty">尚未新增自選股，請輸入股票代號後點新增</div>`;
          return;
        }
        watchlistStocks.innerHTML = candidates.map((stock) => `
          <div class="watchlist-card watchlist-card-candidate" id="wcard-${stock.code}" data-code="${stock.code}" data-name="${stock.name || stock.code}">
            <div class="watch-card-main">
              <div class="watch-card-title">
                <span class="watch-code">${stock.code}</span>
                <span class="watch-name">${stock.name || ""}</span>
                <span class="watch-market-badge">上市</span>
              </div>
              <div class="watch-card-price">
                <span id="wprice-${stock.code}">${stock.close ? stock.close.toLocaleString("zh-TW") : "--"}</span>
                <small id="wchange-${stock.code}" class="${stock.percent >= 0 ? "watch-up" : "watch-down"}">${pctText(stock.percent || 0)}</small>
              </div>
              <div class="watch-card-flow" id="winst-${stock.code}">
                <span>點選股票查看 AI 個股判讀</span>
              </div>
            </div>
          </div>
        `).join("");
      } else {
        watchlistStocks.innerHTML = list.map(item => `
          <div class="watchlist-card" id="wcard-${item.code}" data-code="${item.code}" data-name="${item.name || item.code}">
            <div class="watch-card-main">
              <div class="watch-card-title">
                <span class="watch-code">${item.code}</span>
                <span class="watch-name">${item.name || ""}</span>
                <span class="watch-market-badge">上市</span>
              </div>
              <div class="watch-card-price">
                <span id="wprice-${item.code}">--</span>
                <small id="wchange-${item.code}">載入中...</small>
              </div>
              <div class="watch-card-flow" id="winst-${item.code}">
                <span>外資 <b>--</b></span>
                <span>投信 <b>--</b></span>
              </div>
            </div>
            <button class="watch-remove" type="button" onclick="removeFromWatchlist('${item.code}')" aria-label="移除 ${item.code}">×</button>
          </div>
        `).join("");
      }
    
      document.querySelectorAll(".watchlist-card").forEach(card => {
        card.addEventListener("click", (e) => {
          if (e.target.tagName === "BUTTON") return;
          document.querySelectorAll(".watchlist-card").forEach(c => c.classList.remove("selected"));
          card.classList.add("selected");
          setWatchlistDetailOpen(true);
          showTradingDashboard(card.dataset.code, card.dataset.name);
        });
      });
    
      const selectedCard = document.querySelector(".watchlist-card.selected") || document.querySelector(".watchlist-card");
      if (selectedCard && !watchlistAnalysis.querySelector(".ta-dashboard") && !isMobileWatchlistViewport()) {
        selectedCard.click();
      } else if (!watchlistAnalysis.querySelector(".ta-dashboard")) {
        watchlistAnalysis.innerHTML = `<div class="watch-mobile-empty">點選股票查看 AI 個股判讀</div>`;
      }
    
      for (const item of list) {
        fetchStockPrice(item.code).then(stock => {
          if (!stock) return;
          updateWatchlistQuoteDate(stock);
          const priceEl = document.querySelector(`#wprice-${item.code}`);
          const changeEl = document.querySelector(`#wchange-${item.code}`);
          const instEl = document.querySelector(`#winst-${item.code}`);
          if (priceEl) priceEl.textContent = stock.close.toLocaleString("zh-TW");
          if (changeEl) {
            const sign = stock.change >= 0 ? "+" : "";
            const color = stock.change > 0 ? "#e74c3c" : stock.change < 0 ? "#27ae60" : "#aaa";
            changeEl.style.color = color;
            changeEl.textContent = `${sign}${stock.change.toFixed(2)} (${sign}${stock.percent.toFixed(2)}%)`;
            if (stock.name && stock.name !== item.code) {
              item.name = stock.name;
              saveWatchlist(getWatchlist().map(w => w.code === item.code ? {...w, name: stock.name} : w));
              const nameEls = document.querySelectorAll(`#wcard-${item.code} span`);
              if (nameEls[1]) nameEls[1].textContent = stock.name;
            }
          }
          if (instEl) {
            const inst = institutionData[item.code];
            if (inst) {
              const fColor = inst.foreign > 0 ? "#e74c3c" : inst.foreign < 0 ? "#27ae60" : "#aaa";
              const tColor = inst.trust > 0 ? "#e74c3c" : inst.trust < 0 ? "#27ae60" : "#aaa";
              instEl.innerHTML = `<span>外資 <b style="color:${fColor}">${inst.foreign > 0 ? "+" : ""}${(inst.foreign/1000).toFixed(0)}k</b></span><span>投信 <b style="color:${tColor}">${inst.trust > 0 ? "+" : ""}${(inst.trust/1000).toFixed(0)}k</b></span>`;
            } else {
              instEl.innerHTML = `<span>外資 <b>盤後</b></span><span>投信 <b>盤後</b></span>`;
            }
          }
        });
      }
    
      if (watchlistRefresh) {
        const now = new Date();
        watchlistRefresh.textContent = `${String(now.getMonth()+1).padStart(2,"0")}/${String(now.getDate()).padStart(2,"0")}  更新 ${now.toLocaleTimeString("zh-TW", {hour12:false})}`;
      }
      updateWatchlistEntryStatus();
    }
    
    async function addToWatchlist() {
      if (!isTerminalUnlocked()) return;
      const code = watchlistSearchInput.value.trim().replace(/\D/g, "");
      if (!code) return;
    
      const list = getWatchlist();
      if (list.find(w => w.code === code)) {
        watchlistSearchInput.value = "";
        alert("此股票已在自選股中");
        return;
      }
    
      list.push({ code, name: code });
      saveWatchlist(list);
      watchlistSearchInput.value = "";
      await renderWatchlist();
    
      const firstCard = document.querySelector(".watchlist-card");
      if (firstCard) firstCard.click();
    }
    
    function removeFromWatchlist(code) {
      if (!isTerminalUnlocked()) return;
      const list = getWatchlist().filter(w => w.code !== code);
      saveWatchlist(list);
      renderWatchlist();
      watchlistAnalysis.innerHTML = `<div style="color:#555; font-size:14px;">點擊左側股票查看技術分析</div>`;
    }

    async function refreshSelectedWatchlistQuote() {
      if (isDocumentHidden() || !isViewActive("watchlist") || !isTerminalUnlocked()) return;
      if (watchlistRefreshLoading) return;
      const card = document.querySelector(".watchlist-card.selected");
      if (!card) return;
      watchlistRefreshLoading = true;
      try {
        const stock = await fetchStockPrice(card.dataset.code);
        if (!stock) return;
        updateWatchlistQuoteDate(stock);
        const priceEl = document.querySelector(`#wprice-${card.dataset.code}`);
        const changeEl = document.querySelector(`#wchange-${card.dataset.code}`);
        if (priceEl) priceEl.textContent = stock.close ? stock.close.toLocaleString("zh-TW") : "--";
        if (changeEl) {
          const sign = stock.change >= 0 ? "+" : "";
          changeEl.style.color = stock.change > 0 ? "#e74c3c" : stock.change < 0 ? "#27ae60" : "#aaa";
          changeEl.textContent = `${sign}${stock.change.toFixed(2)} (${sign}${stock.percent.toFixed(2)}%)`;
        }
        const signature = `${card.dataset.code}:${stock.close}:${stock.change.toFixed(2)}:${stock.percent.toFixed(2)}:${selectedTechnicalTimeframe}`;
        if (signature === watchlistDashboardSignature) return;
        watchlistDashboardSignature = signature;
        showTradingDashboard(card.dataset.code, stock.name || card.dataset.name);
      } finally {
        watchlistRefreshLoading = false;
      }
    }

    async function runSelfCheck() {
      const startedAt = performance?.now ? performance.now() : Date.now();
      const originalList = getWatchlist();
      const testCode = "2330";
      const result = { ok: false, steps: [], at: new Date().toISOString() };
      try {
        saveWatchlist([{ code: testCode, name: "台積電" }]);
        result.steps.push("save");
        await renderWatchlist();
        result.steps.push("render");
        const card = document.querySelector(`#wcard-${testCode}`);
        if (!card) throw new Error("watchlist card missing");
        card.click();
        result.steps.push("select");
        await new Promise((resolve) => setTimeout(resolve, 500));
        const timeframe = watchlistAnalysis.querySelector(".ta-timeframe[data-timeframe]");
        if (timeframe) {
          timeframe.click();
          result.steps.push("timeframe");
        }
        removeFromWatchlist(testCode);
        result.steps.push("remove");
        result.ok = true;
      } catch (error) {
        result.error = error?.message || String(error);
      } finally {
        saveWatchlist(originalList);
        await renderWatchlist();
        result.ms = Math.round((performance?.now ? performance.now() : Date.now()) - startedAt);
        window.FUMAN_TERMINAL_BOOT = window.FUMAN_TERMINAL_BOOT || {};
        window.FUMAN_TERMINAL_BOOT.watchlistSelfCheck = result;
      }
      return result;
    }

    viewPanels.watchlist = document.querySelector("#watchlist-view");
    syncMobileStrategyVisibility();
    arrangeWatchlistSearch();
    window.addEventListener("resize", () => deferUiWork(syncMobileStrategyVisibility, 80));
    
    watchlistSearchInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addToWatchlist();
    });
    watchlistAddBtn?.addEventListener("click", addToWatchlist);
    
    

    return { renderWatchlist, refreshSelectedWatchlistQuote, addToWatchlist, removeFromWatchlist, runSelfCheck };
  }

  window.FUMAN_WATCHLIST_MODULE = { install };
})();
