(function () {
  let source = "function hydrateWarrantFlowItem(item) {\r\n  const name = String(item.underlyingName || \"\").trim();\r\n  const exact = latestStocks.find((stock) => stock.name === name);\r\n  const partial = exact || latestStocks.find((stock) => name && (stock.name.includes(name) || name.includes(stock.name)));\r\n  const code = String(item.underlyingCode || item.code || partial?.code || \"\").trim();\r\n  const stockPercent = Number.isFinite(Number(item.underlyingPercent))\r\n    ? Number(item.underlyingPercent)\r\n    : Number.isFinite(Number(item.percent))\r\n      ? Number(item.percent)\r\n      : partial?.percent || 0;\r\n  const stockClose = cleanNumber(item.underlyingClose) || cleanNumber(item.close) || cleanNumber(item.displayClose) || partial?.close || 0;\r\n  return {\r\n    ...item,\r\n    code,\r\n    name: name || partial?.name || \"--\",\r\n    stockPercent,\r\n    stockClose,\r\n    stockValue: partial?.value || 0,\r\n  };\r\n}\r\n\r\nfunction formatWarrantMoney(value) {\r\n  const number = cleanNumber(value);\r\n  if (number >= 100000000) return `${(number / 100000000).toFixed(2)} 億`;\r\n  if (number >= 10000) return `${Math.round(number / 10000).toLocaleString(\"zh-TW\")} 萬`;\r\n  return Math.round(number).toLocaleString(\"zh-TW\");\r\n}\r\n\r\nfunction parseWarrantReasonNumber(reason, label) {\n  const text = String(reason || \"\");\n  const index = text.indexOf(label);\n  if (index < 0) return 0;\n  const tail = text.slice(index + label.length);\n  const match = tail.match(/[0-9,]+/);\n  return match ? cleanNumber(String(match[0]).replace(/,/g, \"\")) : 0;\n}\n\nfunction getWarrantPriority(item) {\n  const reason = String(item.reason || \"\");\n  const levelText = String(item.level || item.grade || reason || \"\").toUpperCase();\n  const callValue = cleanNumber(item.callValue);\n  const putValue = cleanNumber(item.putValue);\n  const ratio = cleanNumber(item.callPutRatio);\n  const callCount = cleanNumber(item.callCount);\n  const putCount = cleanNumber(item.putCount);\n  const atMoneyCount = cleanNumber(item.atMoneyCallCount) || parseWarrantReasonNumber(reason, \"價平/價內\");\n  const days = cleanNumber(item.minDaysToExpiry) || parseWarrantReasonNumber(reason, \"最近到期\");\n  const pct = Number(item.stockPercent);\n  const score = cleanNumber(item.score);\n  const isA = levelText.includes(\"A\") || reason.includes(\"A級\") || score >= 90;\n  const isPriority = (\n    isA &&\n    callValue >= 20000000 &&\n    callCount >= 5 &&\n    atMoneyCount >= 2 &&\n    days >= 10 &&\n    ratio >= 2.5 &&\n    callValue > putValue &&\n    Number.isFinite(pct) &&\n    pct > -2 &&\n    pct <= 4\n  );\n  const reasons = [];\n  if (!isPriority) reasons.push(\"不在優先區\");\n  else if (pct <= 1.5 && ratio >= 6 && atMoneyCount >= 3) reasons.push(\"權證先熱，股票未噴\");\n  else if (pct <= 2.5) reasons.push(\"權證先熱，股票未過熱\");\n  else reasons.push(\"權證熱，股票漲幅仍可控\");\n  return {\n    isPriority,\n    score: Math.round(score + Math.min(callValue / 20000000, 18) + Math.min(ratio * 2, 14) + (pct <= 1.5 ? 12 : pct <= 2.5 ? 8 : 3)),\n    label: reasons[0],\n  };\n}\n\nfunction getWarrantPriorityRows() {\r\n  const signature = `${warrantFlowUpdatedAt || 0}:${warrantFlowData.length}:${latestStocks.length}`;\r\n  if (signature === warrantFlowPrioritySignature && warrantFlowPriorityCache.length) {\r\n    return warrantFlowPriorityCache;\r\n  }\r\n  warrantFlowPrioritySignature = signature;\r\n  warrantFlowPriorityCache = warrantFlowData\r\n    .map(hydrateWarrantFlowItem)\r\n    .map((item) => ({\r\n      ...item,\r\n      priority: getWarrantPriority(item),\r\n    }))\r\n    .filter((item) => item.priority.isPriority)\r\n    .sort((a, b) => b.priority.score - a.priority.score || b.score - a.score || b.callValue - a.callValue)\r\n    .map((item, index) => ({ ...item, rank: index + 1 }));\r\n  return warrantFlowPriorityCache;\r\n}\r\n\r\n\nfunction renderWarrantReasonBadges(item) {\n  const rawReason = String(item.reason || \"\");\n  const setup = rawReason.includes(\"A級\") || String(item.level || item.grade || \"\").toUpperCase().includes(\"A\")\n    ? \"符合固定條件\"\n    : \"權證候選\";\n  const atMoneyCount = cleanNumber(item.atMoneyCallCount) || parseWarrantReasonNumber(rawReason, \"價平/價內\");\n  const days = cleanNumber(item.minDaysToExpiry) || parseWarrantReasonNumber(rawReason, \"最近到期\");\n  const metrics = [];\n  const tags = [];\n  const pushMetric = (label, tone = \"\") => {\n    if (label && !metrics.some((entry) => entry.label === label)) metrics.push({ label, tone });\n  };\n  const pushTag = (label, tone = \"\") => {\n    if (label && !tags.some((entry) => entry.label === label)) tags.push({ label, tone });\n  };\n  pushMetric(\"認購 \" + formatNumber(item.callCount, 0) + \" 檔\", \"hot\");\n  if (atMoneyCount > 0) pushMetric(\"價平/價內 \" + formatNumber(atMoneyCount, 0) + \" 檔\", \"warm\");\n  pushMetric(\"認購金額 \" + formatWarrantMoney(item.callValue), \"hot\");\n  pushMetric(\"購售比 \" + (item.callPutRatio >= 99 ? \"99+\" : item.callPutRatio), \"neutral\");\n  if (days > 0) pushMetric(\"最近到期 \" + formatNumber(days, 0) + \" 天\", \"neutral\");\n  pushTag(setup, \"hot\");\n  pushTag(\"A級\", \"hot\");\n  pushTag(\"認購熱\", \"warm\");\n  pushTag(\"認售低\", \"warm\");\n  if (atMoneyCount >= 2) pushTag(\"價平/價內足夠\", \"neutral\");\n  pushTag(item.priority?.label || \"權證先熱\", \"cool\");\n  const metricHtml = metrics.slice(0, 5).map((entry) => '<span class=\"open-buy-reason-chip ' + entry.tone + '\">' + escapeAttr(entry.label) + '</span>').join(\"\");\n  const tagHtml = tags.slice(0, 6).map((entry) => '<span class=\"open-buy-reason-tag ' + entry.tone + '\">' + escapeAttr(entry.label) + '</span>').join(\"\");\n  return '<div class=\"open-buy-reason-card strategy3-reason-card warrant-reason-card\">' +\n    '<strong class=\"open-buy-reason-title\">' + escapeAttr(setup) + '</strong>' +\n    '<div class=\"open-buy-reason-chips\">' + metricHtml + '</div>' +\n    '<p>' + escapeAttr(rawReason) + '　判斷：' + escapeAttr(item.priority?.label || \"權證先熱\") + '。</p>' +\n    '<div class=\"open-buy-reason-tags\">' + tagHtml + '</div>' +\n    '</div>';\n}\n\n\nfunction renderWarrantFlow() {\r\n  const panel = viewPanels[\"warrant-flow\"];\r\n  if (!panel) return;\r\n  const keyword = warrantFlowKeyword.trim().toLowerCase();\r\n  const allRows = getWarrantPriorityRows();\r\n  const filteredRows = keyword\r\n    ? allRows.filter((item) =>\r\n      item.code.includes(keyword) ||\r\n      item.name.toLowerCase().includes(keyword) ||\r\n      item.underlyingName.toLowerCase().includes(keyword))\r\n    : allRows;\r\n  const pageSize = 10;\r\n  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));\r\n  warrantFlowPage = Math.min(Math.max(1, warrantFlowPage), pageCount);\r\n  const pageStart = (warrantFlowPage - 1) * pageSize;\r\n  const rows = filteredRows.slice(pageStart, pageStart + pageSize);\r\n  const listLabel = keyword\r\n    ? `搜尋結果 ${filteredRows.length} 筆｜第 ${warrantFlowPage}/${pageCount} 頁`\r\n    : `優先區權證 ${allRows.length} 筆｜第 ${warrantFlowPage}/${pageCount} 頁`;\r\n  const helperText = keyword\r\n    ? \"搜尋只查優先區權證候選；不在優先區的 A 級權證已剔除。\"\r\n    : \"只顯示優先區：A級、認購熱、認售低、價平/價內足夠，且股票未過熱。\";\r\n  const pagination = buildTerminalPagination(\"warrant\", warrantFlowPage, pageCount, filteredRows.length);\r\n  const renderSignature = `${warrantFlowUpdatedAt || 0}:${keyword}:${warrantFlowPage}:${filteredRows.length}:${rows.map((item) => `${item.code}:${item.rank}:${item.priority.score}`).join(\"|\")}`;\r\n  if (renderSignature === warrantFlowLastRenderSignature) return;\r\n  warrantFlowLastRenderSignature = renderSignature;\r\n\r\n  const body = rows.length ? rows.map((item) => {\r\n    const sign = item.stockPercent >= 0 ? \"+\" : \"\";\r\n    const hot = item.score >= 82 ? \"hot\" : item.score >= 68 ? \"mid\" : \"low\";\r\n    return `\r\n      <tr>\r\n        <td><span class=\"swing-score\">${item.rank || \"--\"}</span></td>\r\n        <td><span class=\"code\">${item.code || \"--\"}</span></td>\r\n        <td>${item.name}</td>\r\n        <td class=\"price\">${formatNumber(item.stockClose, item.stockClose >= 100 ? 0 : 2)}</td>\r\n        <td class=\"price\">${formatWarrantMoney(item.callValue)}</td>\r\n        <td>${formatWarrantMoney(item.putValue)}</td>\r\n        <td><b class=\"swing-stage ${hot}\">${item.callPutRatio >= 99 ? \"99+\" : item.callPutRatio}</b></td>\r\n        <td>${item.callCount} / ${item.putCount}</td>\r\n        <td class=\"warrant-reason-cell\">${renderWarrantReasonBadges(item)}</td>\r\n      </tr>\r\n    `;\r\n  }).join(\"\") : `\r\n    <tr><td colspan=\"9\">${keyword ? \"優先區名單內找不到這檔股票；代表目前 A 級權證尚未進優先觀察區。\" : \"權證資金走向讀取中。只顯示優先區權證候選。\"}</td></tr>\r\n  `;\r\n\r\n  panel.innerHTML = `\n    <section class=\"swing-dashboard warrant-flow-dashboard\">\n      <div class=\"swing-topbar\">\n        <div>\n          <h2 data-warrant-refresh title=\"重新整理權證資金走向\">${titleWithSchedule(\"◒\", \"策略6：權證資金走向\", \"warrant\")}</h2>\n          <p>${helperText}</p>\n        </div>\n      </div>\n      ${renderDataFreshnessBarHtml(\"warrant-flow\")}\n      <section class=\"swing-panel warrant-flow-panel\">\n        <div class=\"swing-tabs\">\r\n          <button class=\"active\" type=\"button\" data-warrant-refresh>${listLabel}</button>\r\n          <div class=\"swing-actions warrant-search-box\">\r\n            <small class=\"warrant-search-hint\">🔥 可搜尋全台股票權證熱度</small>\r\n            <div class=\"warrant-search-row\">\r\n              <input id=\"warrant-flow-search\" type=\"search\" placeholder=\"搜尋股票代號/名稱\" value=\"${escapeAttr(warrantFlowKeyword)}\" data-warrant-flow-search>\r\n              <button id=\"warrant-flow-refresh\" type=\"button\" data-warrant-refresh data-mobile-full-load=\"warrant\">完整列表</button>\r\n            </div>\r\n          </div>\r\n        </div>\r\n        <table class=\"swing-table\">\r\n          <thead>\r\n            <tr>\r\n              <th>排名</th><th>股票代號</th><th>標的名稱</th><th>收盤價</th><th>認購金額</th><th>認售金額</th><th>購/售比</th><th>購/售檔數</th><th>原因</th>\r\n            </tr>\r\n          </thead>\r\n          <tbody>${body}</tbody>\r\n        </table>\r\n        ${pagination}\r\n      </section>\r\n    </section>\r\n  `;\r\n}\r\n\r\nasync function loadWarrantFlow(force = false) {\r\n  if (!isViewActive(\"warrant-flow\")) return;\r\n  warrantFlowHasOpened = true;\r\n  if (warrantFlowLoading) return;\n  if (!warrantFlowData.length) {\n    loadWarrantFlowLocalCache();\n    loadWarrantFlowSummary().then(() => {\n      const panel = viewPanels[\"warrant-flow\"];\n      if (!panel || warrantFlowData.length || !isViewActive(\"warrant-flow\")) return;\n      const count = warrantFlowSummary?.count ?? warrantFlowSummary?.priorityCount ?? 0;\n      panel.innerHTML = `<div class=\"empty-state\">權證摘要已載入：${count} 筆。正在讀取完整權證資金走向...</div>`;\n    });\n  }\n  if (!force && warrantFlowData.length) {\r\n    renderWarrantFlow();\r\n    return;\r\n  }\r\n  warrantFlowLoading = true;\r\n  const panel = viewPanels[\"warrant-flow\"];\r\n  if (panel && !warrantFlowData.length) {\r\n    panel.innerHTML = `<div class=\"empty-state\">正在讀取權證資金走向...</div>`;\r\n  }\r\n  try {\r\n    if (!latestStocks.length) loadStrategyStocks();\r\n    let payload = await fetchVersionedJson(isMobileViewport() && !force && !warrantFlowPreferFull && endpoints.warrantFlowMobileTop ? endpoints.warrantFlowMobileTop : endpoints.warrantFlowSlim, 7000, warrantFlowSummary?.updatedAt || \"\", force);\n    if (!normalizeArray(payload?.matches).length) {\n      payload = await fetchVersionedJson(endpoints.warrantFlowCache, 10000, warrantFlowSummary?.updatedAt || \"\", force);\n    }\n    if (!normalizeArray(payload?.matches).length) {\n      payload = await fetchVersionedJson(endpoints.warrantFlowBackup, 10000, warrantFlowSummary?.updatedAt || \"\", force);\n    }\n    warrantFlowData = normalizeArray(payload.matches);\r\n    warrantFlowPrioritySignature = \"\";\r\n    warrantFlowLastRenderSignature = \"\";\r\n    warrantFlowPage = 1;\r\n    const updatedAt = Date.parse(payload?.updatedAt || \"\");\r\n    warrantFlowUpdatedAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();\r\n    saveWarrantFlowLocalCache();\r\n    applyStaticTitleIcons();\r\n    renderWarrantFlow();\r\n  } catch (error) {\r\n    if (panel && !warrantFlowData.length) {\r\n      panel.innerHTML = `<div class=\"empty-state\">權證資料暫時讀取失敗，請稍後再試。</div>`;\r\n    }\r\n  } finally {\r\n    warrantFlowLoading = false;\r\n  }\r\n}\r\n\r\n";
  source = source.replace("\n\nfunction renderWarrantFlow() {", `

function getWarrantHistoryRows() {
  return warrantFlowData
    .map(hydrateWarrantFlowItem)
    .map((item) => ({
      ...item,
      priority: getWarrantPriority(item),
    }))
    .sort((a, b) => {
      const dateA = Date.parse(a.tradeDate || a.date || a.updatedAt || "");
      const dateB = Date.parse(b.tradeDate || b.date || b.updatedAt || "");
      const safeDateA = Number.isFinite(dateA) ? dateA : 0;
      const safeDateB = Number.isFinite(dateB) ? dateB : 0;
      return safeDateB - safeDateA || b.score - a.score || b.callValue - a.callValue;
    })
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function renderWarrantFlow() {`);

  source = source.replace("\n\nfunction renderWarrantReasonBadges(item) {", `

function getWarrantDailyRows(item) {
  const rows = normalizeArray(strategyHistoryData?.[item.code]?.rows)
    .map((row) => ({
      date: row.date || row.tradeDate || row.Date || "",
      open: cleanNumber(row.open ?? row.Open),
      high: cleanNumber(row.high ?? row.High),
      low: cleanNumber(row.low ?? row.Low),
      close: cleanNumber(row.close ?? row.Close),
      volume: cleanNumber(row.volume ?? row.tradeVolume ?? row.Volume),
    }))
    .filter((row) => row.open && row.high && row.low && row.close);
  if (item.stockClose) {
    const last = rows.at(-1);
    const live = {
      date: item.tradeDate || item.quoteDate || item.date || last?.date || "",
      open: cleanNumber(item.open) || last?.close || item.stockClose,
      high: Math.max(cleanNumber(item.high), item.stockClose, last?.close || item.stockClose),
      low: Math.min(cleanNumber(item.low) || item.stockClose, item.stockClose, last?.close || item.stockClose),
      close: item.stockClose,
      volume: cleanNumber(item.tradeVolume || item.volume) || last?.volume || 0,
    };
    if (last?.date && live.date && last.date === live.date) rows[rows.length - 1] = { ...last, ...live };
    else rows.push(live);
  }
  return rows.slice(-24);
}

function renderWarrantKline(item) {
  const rows = getWarrantDailyRows(item);
  if (rows.length < 3) {
    return '<div class="warrant-kline-mini warrant-kline-empty">載入日 K</div>';
  }
  const width = 184;
  const height = 82;
  const top = 8;
  const chartHeight = 52;
  const volumeTop = 62;
  const volumeHeight = 14;
  const highs = rows.map((row) => row.high);
  const lows = rows.map((row) => row.low);
  const volumes = rows.map((row) => row.volume);
  const maxPrice = Math.max(...highs);
  const minPrice = Math.min(...lows);
  const maxVolume = Math.max(...volumes, 1);
  const span = Math.max(maxPrice - minPrice, 0.01);
  const step = width / rows.length;
  const bodyWidth = Math.max(3, Math.min(7, step * 0.55));
  const y = (price) => top + ((maxPrice - price) / span) * chartHeight;
  const buyIndex = rows.length - 1;
  const buyRow = rows[buyIndex];
  const buyY = y(buyRow.close);
  const entryLow = y(buyRow.close * 0.995);
  const entryHigh = y(buyRow.close * 1.005);
  const candles = rows.map((row, index) => {
    const x = step * index + step / 2;
    const isUp = row.close >= row.open;
    const color = isUp ? '#16c784' : '#ff5470';
    const openY = y(row.open);
    const closeY = y(row.close);
    const highY = y(row.high);
    const lowY = y(row.low);
    const rectY = Math.min(openY, closeY);
    const rectHeight = Math.max(2, Math.abs(openY - closeY));
    const volHeight = Math.max(1, (row.volume / maxVolume) * volumeHeight);
    return '<line x1="' + x.toFixed(1) + '" y1="' + highY.toFixed(1) + '" x2="' + x.toFixed(1) + '" y2="' + lowY.toFixed(1) + '" stroke="' + color + '" stroke-width="1"/>' +
      '<rect x="' + (x - bodyWidth / 2).toFixed(1) + '" y="' + rectY.toFixed(1) + '" width="' + bodyWidth.toFixed(1) + '" height="' + rectHeight.toFixed(1) + '" rx="1" fill="' + color + '"/>' +
      '<rect x="' + (x - bodyWidth / 2).toFixed(1) + '" y="' + (volumeTop + volumeHeight - volHeight).toFixed(1) + '" width="' + bodyWidth.toFixed(1) + '" height="' + volHeight.toFixed(1) + '" fill="' + color + '" opacity="0.36"/>';
  }).join('');
  const buyX = step * buyIndex + step / 2;
  return '<div class="warrant-kline-mini">' +
    '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="權證標的日 K 與買點">' +
      '<rect x="0" y="0" width="' + width + '" height="' + height + '" rx="7" fill="rgba(7,12,22,0.72)"/>' +
      '<line x1="0" y1="' + top + '" x2="' + width + '" y2="' + top + '" class="warrant-kline-grid"/>' +
      '<line x1="0" y1="' + (top + chartHeight / 2) + '" x2="' + width + '" y2="' + (top + chartHeight / 2) + '" class="warrant-kline-grid"/>' +
      '<line x1="0" y1="' + (top + chartHeight) + '" x2="' + width + '" y2="' + (top + chartHeight) + '" class="warrant-kline-grid"/>' +
      '<rect x="' + Math.max(0, buyX - 18).toFixed(1) + '" y="' + Math.min(entryLow, entryHigh).toFixed(1) + '" width="36" height="' + Math.max(4, Math.abs(entryHigh - entryLow)).toFixed(1) + '" class="warrant-kline-entry-zone"/>' +
      candles +
      '<line x1="' + buyX.toFixed(1) + '" y1="' + top + '" x2="' + buyX.toFixed(1) + '" y2="' + volumeTop + '" class="warrant-kline-buy-line"/>' +
      '<circle cx="' + buyX.toFixed(1) + '" cy="' + buyY.toFixed(1) + '" r="4" class="warrant-kline-buy-dot"/>' +
      '<text x="' + Math.max(32, buyX - 36).toFixed(1) + '" y="16" class="warrant-kline-label">權證買點</text>' +
    '</svg>' +
    '<span>' + escapeAttr(rows[0].date || '') + ' - ' + escapeAttr(rows.at(-1).date || '') + '</span>' +
  '</div>';
}

function ensureWarrantKlineHistory(rows) {
  const loading = window.FUMAN_WARRANT_KLINE_LOADING || (window.FUMAN_WARRANT_KLINE_LOADING = new Set());
  const failed = window.FUMAN_WARRANT_KLINE_FAILED || (window.FUMAN_WARRANT_KLINE_FAILED = new Set());
  const missing = normalizeArray(rows)
    .map((item) => String(item?.code || "").replace(/\D/g, "").slice(0, 4))
    .filter((code) => /^\d{4}$/.test(code) && !normalizeArray(strategyHistoryData?.[code]?.rows).length && !loading.has(code) && !failed.has(code))
    .slice(0, 3);
  if (!missing.length || !endpoints?.history) return;
  missing.forEach((code) => loading.add(code));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  fetch(endpoints.history + "?codes=" + encodeURIComponent(missing.join(",")) + "&t=" + Date.now(), { cache: "no-store", signal: controller.signal })
    .then((response) => response.ok ? response.json() : null)
    .then((payload) => {
      const histories = normalizeArray(payload?.histories || payload?.results || payload?.data);
      const loaded = new Set(histories.map((item) => String(item?.code || "")));
      histories.forEach((item) => {
        if (!item?.code || !Array.isArray(item.rows)) return;
        strategyHistoryData[item.code] = {
          ...item,
          rows: item.rows
            .map((row) => ({
              date: row.date || row.tradeDate || row.Date || "",
              open: cleanNumber(row.open ?? row.Open),
              high: cleanNumber(row.high ?? row.High),
              low: cleanNumber(row.low ?? row.Low),
              close: cleanNumber(row.close ?? row.Close),
              volume: cleanNumber(row.volume ?? row.tradeVolume ?? row.Volume),
              value: cleanNumber(row.value ?? row.Value),
            }))
            .filter((row) => row.date && row.close)
            .sort((a, b) => a.date.localeCompare(b.date)),
          updatedAt: Date.now(),
        };
      });
      missing.filter((code) => !loaded.has(code)).forEach((code) => failed.add(code));
    })
    .then(() => {
      warrantFlowLastRenderSignature = "";
      if (isViewActive("warrant-flow")) renderWarrantFlow();
    })
    .catch(() => missing.forEach((code) => failed.add(code)))
    .finally(() => {
      clearTimeout(timer);
      missing.forEach((code) => loading.delete(code));
    });
}

function renderWarrantReasonBadges(item) {`);

  source = source.replace(
    `  const allRows = getWarrantPriorityRows();\r\n  const filteredRows = keyword\r\n    ? allRows.filter((item) =>\r\n      item.code.includes(keyword) ||\r\n      item.name.toLowerCase().includes(keyword) ||\r\n      item.underlyingName.toLowerCase().includes(keyword))\r\n    : allRows;`,
    `  const allRows = getWarrantPriorityRows();\r\n  const historyRows = getWarrantHistoryRows();\r\n  const activeRows = warrantFlowMode === "history" ? historyRows : allRows;\r\n  const filteredRows = keyword\r\n    ? activeRows.filter((item) =>\r\n      item.code.includes(keyword) ||\r\n      item.name.toLowerCase().includes(keyword) ||\r\n      String(item.underlyingName || "").toLowerCase().includes(keyword))\r\n    : activeRows;`
  );

  source = source.replace(
    `  const listLabel = keyword\r\n    ? \`搜尋結果 \${filteredRows.length} 筆｜第 \${warrantFlowPage}/\${pageCount} 頁\`\r\n    : \`優先區權證 \${allRows.length} 筆｜第 \${warrantFlowPage}/\${pageCount} 頁\`;\r\n  const helperText = keyword\r\n    ? "搜尋只查優先區權證候選；不在優先區的 A 級權證已剔除。"\r\n    : "只顯示優先區：A級、認購熱、認售低、價平/價內足夠，且股票未過熱。";`,
    `  const listLabel = warrantFlowMode === "history"\r\n    ? \`歷史 \${filteredRows.length} 筆｜第 \${warrantFlowPage}/\${pageCount} 頁\`\r\n    : keyword\r\n      ? \`搜尋結果 \${filteredRows.length} 筆｜第 \${warrantFlowPage}/\${pageCount} 頁\`\r\n      : \`優先區權證 \${allRows.length} 筆｜第 \${warrantFlowPage}/\${pageCount} 頁\`;\r\n  const helperText = warrantFlowMode === "history"\r\n    ? "歷史頁顯示完整權證候選快取，可切回優先區看即時觀察名單。"\r\n    : keyword\r\n      ? "搜尋只查優先區權證候選；不在優先區的 A 級權證已剔除。"\r\n      : "只顯示優先區：A級、認購熱、認售低、價平/價內足夠，且股票未過熱。";`
  );

  source = source.replace(
    `  const renderSignature = \`\${warrantFlowUpdatedAt || 0}:\${keyword}:\${warrantFlowPage}:\${filteredRows.length}:\${rows.map((item) => \`\${item.code}:\${item.rank}:\${item.priority.score}\`).join("|")}\`;`,
    `  const renderSignature = \`\${warrantFlowUpdatedAt || 0}:\${warrantFlowMode}:\${keyword}:\${warrantFlowPage}:\${filteredRows.length}:\${rows.map((item) => \`\${item.code}:\${item.rank}:\${item.priority.score}\`).join("|")}\`;`
  );

  source = source.replace(
    `<button class="active" type="button" data-warrant-refresh>\${listLabel}</button>`,
    `<button class="\${warrantFlowMode === "priority" ? "active" : ""}" type="button" data-warrant-flow-mode="priority">\${listLabel}</button>\r\n          <button class="\${warrantFlowMode === "history" ? "active" : ""}" type="button" data-warrant-flow-mode="history">歷史</button>`
  );

  source = source.replace(
    `<tr><td colspan="9">\${keyword ? "優先區名單內找不到這檔股票；代表目前 A 級權證尚未進優先觀察區。" : "權證資金走向讀取中。只顯示優先區權證候選。"}</td></tr>`,
    `<tr><td colspan="9">\${warrantFlowMode === "history" ? "歷史頁目前沒有可回看的權證候選。" : keyword ? "優先區名單內找不到這檔股票；代表目前 A 級權證尚未進優先觀察區。" : "權證資金走向讀取中。只顯示優先區權證候選。"}</td></tr>`
  );

  source = source.replace(
    `  const rows = filteredRows.slice(pageStart, pageStart + pageSize);`,
    `  const rows = filteredRows.slice(pageStart, pageStart + pageSize);\r\n  ensureWarrantKlineHistory(rows);`
  );

  source = source.replace(
    `<td class="price">\${formatNumber(item.stockClose, item.stockClose >= 100 ? 0 : 2)}</td>`,
    `<td class="price">\${formatNumber(item.stockClose, item.stockClose >= 100 ? 0 : 2)}</td>\r\n        <td class="warrant-kline-cell">\${renderWarrantKline(item)}</td>`
  );

  source = source.replace(
    `<th>排名</th><th>股票代號</th><th>標的名稱</th><th>收盤價</th><th>認購金額</th><th>認售金額</th><th>購/售比</th><th>購/售檔數</th><th>原因</th>`,
    `<th>排名</th><th>股票代號</th><th>標的名稱</th><th>收盤價</th><th>K 線</th><th>認購金額</th><th>認售金額</th><th>購/售比</th><th>購/售檔數</th><th>原因</th>`
  );

  source = source.replaceAll(`colspan="9"`, `colspan="10"`);

  window.FUMAN_WARRANT_FLOW_MODULE = {
    install(context) {
      return Function("scope", "with (scope) {\n" + source + "\nreturn { renderWarrantFlow, loadWarrantFlow };\n}")(context.scope);
    },
  };
})();
