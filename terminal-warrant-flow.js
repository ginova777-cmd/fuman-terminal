(function () {
  const source = `
function normalizeSingleWarrantRows(payload) {
  const matches = normalizeArray(payload && payload.matches);
  if (matches.length) return matches;
  return normalizeArray(payload && payload.singleSignals);
}

function normalizeWarrantDateKey(value) {
  return String(value || "").replace(/\\D/g, "").slice(0, 8);
}

function formatWarrantDateKey(value) {
  const key = normalizeWarrantDateKey(value);
  return key ? key.slice(0, 4) + "/" + key.slice(4, 6) + "/" + key.slice(6, 8) : "待確認";
}

function getWarrantQuoteDate() {
  const row = warrantFlowData.find((item) => item.quoteDate || item.tradeDate || item.date);
  return normalizeWarrantDateKey((row && (row.quoteDate || row.tradeDate || row.date)) || "");
}

function getWarrantStockQuoteDate() {
  const row = latestStocks.find((stock) => stock.quoteDate || stock.tradeDate || stock.date);
  return normalizeWarrantDateKey((row && (row.quoteDate || row.tradeDate || row.date)) || "");
}

function reportWarrantFlowError(stage, error) {
  try {
    const payload = JSON.stringify({
      kind: "warrant-flow:" + stage,
      message: String((error && error.message) || error || "unknown").slice(0, 240),
      view: "warrant-flow",
      at: Date.now(),
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/frontend-error", new Blob([payload], { type: "application/json" }));
    } else {
      fetch("/api/frontend-error", { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
    }
  } catch {}
}

function warrantErrorText(error) {
  return String((error && error.message) || error || "未知錯誤").replace(/[<>&]/g, "").slice(0, 120);
}

function formatWarrantMoney(value) {
  const number = cleanNumber(value);
  if (number >= 100000000) return (number / 100000000).toFixed(2) + " 億";
  if (number >= 10000) return Math.round(number / 10000).toLocaleString("zh-TW") + " 萬";
  return Math.round(number).toLocaleString("zh-TW");
}

function hydrateWarrantFlowItem(item) {
  const rawName = String(item.underlyingName || item.name || "").trim();
  const exact = latestStocks.find((stock) => stock.code === String(item.underlyingCode || item.code || "").trim() || stock.name === rawName);
  const partial = exact || latestStocks.find((stock) => rawName && (stock.name.includes(rawName) || rawName.includes(stock.name)));
  const code = String(item.underlyingCode || item.code || (partial && partial.code) || "").trim();
  const stockPercent = Number.isFinite(Number(item.underlyingPercent))
    ? Number(item.underlyingPercent)
    : Number.isFinite(Number(item.percent))
      ? Number(item.percent)
      : ((partial && partial.percent) || 0);
  const stockClose = cleanNumber(item.underlyingClose) || cleanNumber(item.close) || cleanNumber(item.displayClose) || ((partial && partial.close) || 0);
  const value = cleanNumber(item.value || item.totalSignalValue || item.callValue);
  const signalCount = cleanNumber(item.estimatedLargeSignalCount || item.largeSignalCount || item.signalCount);
  const score = cleanNumber(item.score || item.finalScore || item.warrantHeatScore);
  const days = cleanNumber(item.minDaysToExpiry || item.daysToExpiry);
  const moneyness = Math.abs(cleanNumber(item.moneynessPercent));
  const repeatLarge = !!item.hasRepeatLargeSignal || signalCount >= 2;
  return {
    ...item,
    code,
    name: rawName || ((partial && partial.name) || "--"),
    stockPercent,
    stockClose,
    value,
    signalCount,
    score,
    days,
    moneyness,
    repeatLarge,
    actionLabel: item.actionLabel || (repeatLarge ? "單券連續大額" : "單券大額"),
    warrantCode: String(item.warrantCode || item.symbol || "").trim(),
    warrantName: String(item.warrantName || item.name || "").trim(),
    priority: { isPriority: true, score, label: item.actionLabel || (repeatLarge ? "單券連續大額" : "單券大額") },
  };
}

function getWarrantPriorityRows() {
  const signature = String(warrantFlowUpdatedAt || 0) + ":" + warrantFlowData.length + ":" + latestStocks.length;
  if (signature === warrantFlowPrioritySignature && warrantFlowPriorityCache.length) return warrantFlowPriorityCache;
  warrantFlowPrioritySignature = signature;
  warrantFlowPriorityCache = warrantFlowData
    .map(hydrateWarrantFlowItem)
    .sort((a, b) =>
      Number(b.repeatLarge) - Number(a.repeatLarge) ||
      cleanNumber(b.signalCount) - cleanNumber(a.signalCount) ||
      cleanNumber(b.score) - cleanNumber(a.score) ||
      cleanNumber(b.value) - cleanNumber(a.value)
    )
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return warrantFlowPriorityCache;
}

function renderWarrantSignalBadges(item) {
  const metrics = [];
  const tags = [];
  const pushMetric = (label, tone) => {
    if (label && !metrics.some((entry) => entry.label === label)) metrics.push({ label, tone: tone || "" });
  };
  const pushTag = (label, tone) => {
    if (label && !tags.some((entry) => entry.label === label)) tags.push({ label, tone: tone || "" });
  };
  pushMetric("偵測分 " + formatNumber(item.score, 0), "hot");
  pushMetric("同券大額 " + formatNumber(item.signalCount, 0) + " 筆", item.repeatLarge ? "warm" : "neutral");
  if (item.value) pushMetric("合計 " + formatWarrantMoney(item.value), "warm");
  if (item.days) pushMetric("最近到期 " + formatNumber(item.days, 0) + " 天", "neutral");
  if (Number.isFinite(item.moneyness) && item.moneyness > 0) pushMetric("價平差 " + formatNumber(item.moneyness, 1) + "%", "neutral");
  pushTag(item.actionLabel || "單券大額", "hot");
  pushTag(item.warrantName || item.warrantCode || "權證未命名", "cool");
  if (item.stockPercent <= 6 && item.stockPercent > -3) pushTag("標的漲幅可控", "neutral");
  if (item.repeatLarge) pushTag("連續大額優先", "warm");
  const metricHtml = metrics.slice(0, 5).map((entry) => '<span class="open-buy-reason-chip ' + entry.tone + '">' + escapeAttr(entry.label) + '</span>').join("");
  const tagHtml = tags.slice(0, 5).map((entry) => '<span class="open-buy-reason-tag ' + entry.tone + '">' + escapeAttr(entry.label) + '</span>').join("");
  return '<div class="open-buy-reason-card strategy3-reason-card warrant-reason-card">' +
    '<strong class="open-buy-reason-title">' + escapeAttr(item.actionLabel || "單券大額") + '</strong>' +
    '<div class="open-buy-reason-chips">' + metricHtml + '</div>' +
    '<p>' + escapeAttr(item.reason || "盤後單一權證出現大額認購訊號，優先觀察標的是否正在醞釀發動。") + '</p>' +
    '<div class="open-buy-reason-tags">' + tagHtml + '</div>' +
    '</div>';
}

function renderWarrantFlow() {
  const panel = viewPanels["warrant-flow"];
  if (!panel) return;
  const keyword = warrantFlowKeyword.trim().toLowerCase();
  const allRows = getWarrantPriorityRows();
  const filteredRows = keyword
    ? allRows.filter((item) =>
      item.code.includes(keyword) ||
      item.name.toLowerCase().includes(keyword) ||
      item.warrantCode.toLowerCase().includes(keyword) ||
      item.warrantName.toLowerCase().includes(keyword))
    : allRows;
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  warrantFlowPage = Math.min(Math.max(1, warrantFlowPage), pageCount);
  const pageStart = (warrantFlowPage - 1) * pageSize;
  const rows = filteredRows.slice(pageStart, pageStart + pageSize);
  const listLabel = keyword
    ? "搜尋結果 " + filteredRows.length + " 檔｜第 " + warrantFlowPage + "/" + pageCount + " 頁"
    : "單券精選 " + allRows.length + " 檔｜第 " + warrantFlowPage + "/" + pageCount + " 頁";
  const helperText = keyword
    ? "搜尋盤後單券大額精選；可用股票代號、名稱或權證代號查詢。"
    : "顯示盤後單券大額權證精選：同券連續大額、價平附近與標的漲幅可控；ETF 與 2330 已排除。";
  const warrantQuoteDate = getWarrantQuoteDate();
  const stockQuoteDate = getWarrantStockQuoteDate();
  const scanTime = warrantFlowUpdatedAt ? new Date(warrantFlowUpdatedAt).toLocaleString("zh-TW", { hour12: false }) : "待確認";
  const dateWarning = warrantQuoteDate && stockQuoteDate && warrantQuoteDate !== stockQuoteDate
    ? "｜日期不同步：權證 " + formatWarrantDateKey(warrantQuoteDate) + " / 報價 " + formatWarrantDateKey(stockQuoteDate)
    : "";
  const freshnessText = "權證掃描 " + scanTime + "｜權證日期 " + formatWarrantDateKey(warrantQuoteDate) + "｜報價日期 " + formatWarrantDateKey(stockQuoteDate) + dateWarning;
  const pagination = buildTerminalPagination("warrant", warrantFlowPage, pageCount, filteredRows.length);
  const renderSignature = String(warrantFlowUpdatedAt || 0) + ":" + keyword + ":" + warrantFlowPage + ":" + filteredRows.length + ":" + rows.map((item) => item.code + ":" + item.rank + ":" + item.score + ":" + item.value).join("|");
  if (renderSignature === warrantFlowLastRenderSignature) return;
  warrantFlowLastRenderSignature = renderSignature;

  const body = rows.length ? rows.map((item) => {
    const sign = item.stockPercent >= 0 ? "+" : "";
    const hot = item.repeatLarge ? "hot" : item.score >= 70 ? "mid" : "low";
    const pct = Number.isFinite(Number(item.stockPercent)) ? sign + formatNumber(item.stockPercent, 2) + "%" : "--";
    return '<tr>' +
      '<td><span class="swing-score">' + (item.rank || "--") + '</span></td>' +
      '<td><span class="code">' + escapeAttr(item.code || "--") + '</span></td>' +
      '<td>' + escapeAttr(item.name) + '</td>' +
      '<td class="price">' + formatNumber(item.stockClose, item.stockClose >= 100 ? 0 : 2) + '</td>' +
      '<td><span class="code">' + escapeAttr(item.warrantCode || "--") + '</span><br><small>' + escapeAttr(item.warrantName || "--") + '</small></td>' +
      '<td><b class="swing-stage ' + hot + '">' + formatWarrantMoney(item.value) + '</b></td>' +
      '<td><b class="swing-stage ' + hot + '">' + escapeAttr(item.actionLabel) + '</b><br><small>' + formatNumber(item.signalCount, 0) + ' 筆</small></td>' +
      '<td class="price">' + pct + '</td>' +
      '<td class="warrant-reason-cell">' + renderWarrantSignalBadges(item) + '</td>' +
      '</tr>';
  }).join("") : '<tr><td colspan="9">' + (keyword ? "單券精選內找不到這檔股票或權證。" : "權證單券精選讀取中。") + '</td></tr>';

  panel.innerHTML = [
    '<section class="swing-dashboard warrant-flow-dashboard">',
    '<div class="swing-topbar"><div>',
    '<h2 data-warrant-refresh title="重新整理權證單券精選">' + titleWithSchedule("◒", "策略6：權證資金走向", "warrant") + '</h2>',
    '<p>' + helperText + '<br><small>' + escapeAttr(freshnessText) + '</small></p>',
    '</div></div>',
    renderDataFreshnessBarHtml("warrant-flow"),
    '<section class="swing-panel warrant-flow-panel">',
    '<div class="swing-tabs">',
    '<button class="active" type="button" data-warrant-refresh>' + listLabel + '</button>',
    '<div class="swing-actions warrant-search-box">',
    '<small class="warrant-search-hint">🔥 搜尋單券精選</small>',
    '<div class="warrant-search-row">',
    '<input id="warrant-flow-search" type="search" placeholder="搜尋股票/權證代號或名稱" value="' + escapeAttr(warrantFlowKeyword) + '" data-warrant-flow-search>',
    '<button id="warrant-flow-refresh" type="button" data-warrant-refresh data-mobile-full-load="warrant">重新整理</button>',
    '</div></div></div>',
    '<table class="swing-table"><thead><tr>',
    '<th>排名</th><th>股票代號</th><th>標的名稱</th><th>收盤價</th><th>權證代號</th><th>單券金額</th><th>訊號</th><th>標的漲幅</th><th>原因</th>',
    '</tr></thead><tbody>' + body + '</tbody></table>',
    pagination,
    '</section></section>',
  ].join("");
}

async function loadWarrantFlow(force = false) {
  if (!isViewActive("warrant-flow")) return;
  warrantFlowHasOpened = true;
  if (warrantFlowLoading) return;
  if (!force) renderWarrantFlow();
  warrantFlowLoading = true;
  const panel = viewPanels["warrant-flow"];
  try {
    if (!latestStocks.length) loadStrategyStocks();
    let payload = await fetchVersionedJson(endpoints.warrantFlowSingleSignal || "/data/warrant-single-signal-top.json", 7000, (warrantFlowSummary && warrantFlowSummary.updatedAt) || "", true);
    let rows = normalizeSingleWarrantRows(payload);
    if (!rows.length) {
      payload = await fetchVersionedJson(endpoints.warrantFlowMobileTop || endpoints.warrantFlowSlim, 8000, (warrantFlowSummary && warrantFlowSummary.updatedAt) || "", force);
      rows = normalizeArray(payload && payload.singleSignals);
    }
    if (!rows.length) {
      payload = await fetchVersionedJson(endpoints.warrantFlowSlim, 9000, (warrantFlowSummary && warrantFlowSummary.updatedAt) || "", force);
      rows = normalizeArray(payload && payload.singleSignals);
    }
    if (!rows.length) {
      payload = await fetchVersionedJson(endpoints.warrantFlowCache, 10000, (warrantFlowSummary && warrantFlowSummary.updatedAt) || "", force);
      rows = normalizeArray(payload && payload.singleSignals);
    }
    warrantFlowData = rows;
    warrantFlowPrioritySignature = "";
    warrantFlowLastRenderSignature = "";
    warrantFlowPage = 1;
    const updatedAt = Date.parse((payload && payload.updatedAt) || "");
    warrantFlowUpdatedAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
    saveWarrantFlowLocalCache();
    applyStaticTitleIcons();
    renderWarrantFlow();
  } catch (error) {
    reportWarrantFlowError("load", error);
    if (panel && !warrantFlowData.length) {
      panel.innerHTML = '<div class="empty-state">權證資料檔讀取失敗：' + warrantErrorText(error) + '。已回報 frontend-error，請重新整理或稍後再試。</div>';
    }
  } finally {
    warrantFlowLoading = false;
  }
}
`;

  window.FUMAN_WARRANT_FLOW_MODULE = {
    install(context) {
      return Function("scope", "with (scope) {\n" + source + "\nreturn { renderWarrantFlow, loadWarrantFlow };\n}")(context.scope);
    },
  };
})();
