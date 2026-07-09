(function () {
  function num(stock, keys) {
    for (const key of keys) {
      const value = cleanNumber(stock?.[key]);
      if (Number.isFinite(value) && value !== 0) return value;
    }
    return 0;
  }

  function volumeText(value) {
    const number = cleanNumber(value);
    return number ? Math.round(number).toLocaleString("zh-TW") : "--";
  }

  function tradeValue(stock) {
    const direct = num(stock, ["value", "tradeValue", "trade_value", "TradeValue"]);
    if (direct) return direct;
    const close = num(stock, ["close", "price", "ClosingPrice"]);
    const volume = num(stock, ["tradeVolume", "volume", "trade_volume", "TradeVolume"]);
    return close && volume ? close * volume * 1000 : 0;
  }

  function moneyText(value) {
    const number = cleanNumber(value);
    return number ? `${(number / 1e8).toLocaleString("zh-TW", { maximumFractionDigits: 2 })}<br>億` : "--";
  }

  function ratio(stock) {
    return num(stock, ["volumeRatio", "projectedRatio", "estimateVolumeRatio", "estimatedVolumeRatio", "VolumeRatio", "volume_ratio"]);
  }

  function legal5d(stock) {
    return num(stock, ["legal5d", "legal5D", "institution5d", "institution5D", "foreign5d", "foreign5D", "foreignTrust5d", "foreignTrust5D", "netBuy5d", "netBuy5D", "totalInst5d", "totalInst5D"]);
  }

  function setupLabel(stock) {
    const tag = String(stock?.reason || "").split("：")[0].trim();
    return tag && tag.length <= 12 ? tag : stock?.status || "通過";
  }

  function reasonText(stock) {
    const reason = String(stock?.reason || stock?.activeMatch?.reason || "量價與籌碼條件通過，列入策略1候選。").trim();
    const parts = reason.split("：");
    return parts.length > 1 ? parts.slice(1).join("：").trim() : reason;
  }

  function chip(label, tone = "") {
    return label ? `<span class="open-buy-reason-tag ${tone}">${escapeAttr(label)}</span>` : "";
  }

  function renderAi(stock) {
    const pct = cleanNumber(stock.percent);
    const volRatio = ratio(stock);
    const value = tradeValue(stock);
    const legal = legal5d(stock);
    const score = cleanNumber(stock.score);
    const volume = num(stock, ["tradeVolume", "volume", "trade_volume", "TradeVolume"]);
    const chips = [
      volRatio ? chip(`量能 +${formatNumber(volRatio, 1)}`, "neutral") : "",
      pct ? chip(`動能 ${pct >= 0 ? "+" : ""}${formatNumber(pct, 1)}`, "hot") : "",
      value ? chip(`成交額 +${(value / 1e8).toLocaleString("zh-TW", { maximumFractionDigits: 1 })}`, "hot") : "",
      legal ? chip(`籌碼 ${legal >= 0 ? "+" : ""}${Math.round(legal).toLocaleString("zh-TW")}`, "hot") : "",
      score ? chip(`風控 +${formatNumber(Math.max(0, score - 75), 1)}`, "neutral") : "",
    ].join("");
    const summary = [
      volRatio ? `推估量比 ${formatNumber(volRatio, 1)}x` : "量能待確認",
      pct ? `漲幅 ${pct >= 0 ? "+" : ""}${formatNumber(pct, 1)}%` : "漲幅待確認",
      value ? `成交額 ${(value / 1e8).toLocaleString("zh-TW", { maximumFractionDigits: 2 })} 億` : "成交額待確認",
      legal ? `法人5D ${legal >= 0 ? "+" : ""}${Math.round(legal).toLocaleString("zh-TW")}張` : "法人5D待確認",
    ].join("，");
    const tags = [
      volRatio >= 3 ? chip("量能啟動", "neutral") : "",
      value >= 1e9 ? chip("高成交額", "hot") : "",
      legal > 0 ? chip("法人5D偏多", "hot") : "",
      volume >= 5000 ? chip("流動性足", "cool") : "",
    ].join("");
    return `<div class="open-buy-tactical-ai"><strong>${escapeAttr(setupLabel(stock))}</strong><div class="open-buy-reason-chips">${chips}</div><p>${escapeAttr(`${summary}。AI判讀量價與籌碼同步偏強，可列入開盤候選名單，盤中仍依流動性與風控執行。`)}</p><div class="open-buy-reason-tags">${tags}</div></div>`;
  }

  function renderTrigger(stock) {
    const pct = cleanNumber(stock.percent);
    const volRatio = ratio(stock);
    const value = tradeValue(stock);
    const legal = legal5d(stock);
    const parts = [
      volRatio ? `推估量比 ${formatNumber(volRatio, 1)}x` : "",
      pct ? `漲幅 ${pct >= 0 ? "+" : ""}${formatNumber(pct, 1)}%` : "",
      value ? `成交額 ${(value / 1e8).toLocaleString("zh-TW", { maximumFractionDigits: 2 })} 億` : "",
      legal ? `法人5D ${legal >= 0 ? "+" : ""}${Math.round(legal).toLocaleString("zh-TW")}張` : "",
    ].filter(Boolean).join(" · ");
    const tags = [
      volRatio >= 3 ? chip("量能啟動", "neutral") : "",
      value >= 1e9 ? chip("高成交額", "hot") : "",
      legal > 0 ? chip("法人5D偏多", "hot") : "",
      chip("流動性足", "cool"),
    ].join("");
    return `<div class="open-buy-tactical-trigger"><p>${escapeAttr(parts || reasonText(stock))}</p><div class="open-buy-reason-tags">${tags}</div></div>`;
  }

function stageNumber(value, digits = 2) {
  const number = cleanNumber(value);
  if (!number) return "--";
  return number.toLocaleString("zh-TW", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function stageVolume(value) {
  const number = cleanNumber(value);
  return number ? Math.round(number).toLocaleString("zh-TW") : "--";
}

function stagePercent(value) {
  const number = cleanNumber(value);
  return number ? `${number >= 0 ? "+" : ""}${stageNumber(number, 2)}%` : "--";
}

function stageName(row) {
  return `${escapeAttr(row?.name || row?.stock_name || row?.code || row?.symbol || "--")} <b>${escapeAttr(row?.code || row?.symbol || "")}</b>`;
}

function renderStageCards() {
  const definitions = [
    ["08:46", "期貨初動", "期貨強勢排序", openBuyFutureInitialMatches.length || cleanNumber(openBuyStageCounts.futureInitial0846)],
    ["08:55", "期現試撮", "主要觀察名單", openBuyPreopenConfirmMatches.length || cleanNumber(openBuyStageCounts.preopenConfirm0855)],
    ["08:58~08:59", "終判", "STAR / 開盤可衝", openBuyFinalMatches.length || cleanNumber(openBuyStageCounts.finalJudgement0858)],
  ];
  return `<div class="open-buy-stage-cards" aria-label="策略1分層狀態">${definitions.map(([time, title, hint, count]) => {
    const ready = cleanNumber(count) > 0;
    return `<div class="open-buy-stage-card ${ready ? "is-ready" : "is-empty"}"><div><strong>${time} ${title}</strong><small>${hint}</small></div><em>${cleanNumber(count).toLocaleString("zh-TW")}</em></div>`;
  }).join("")}</div>`;
}

function renderFutureStageRows(rows) {
  if (!rows.length) return `<div class="open-buy-empty">目前沒有期貨初動名單</div>`;
  return rows.slice(0, 18).map((row, index) => `<article class="open-buy-stage-item">
    <div class="open-buy-stage-item-top"><strong>#${index + 1} ${stageName(row)}</strong><span>${stagePercent(row.futoptChangePercent ?? row.futopt_change_percent)}</span></div>
    <div class="open-buy-stage-metrics"><div>RelTXF <mark>${stagePercent(row.relativeToTxfPercent ?? row.relative_to_txf_percent)}</mark></div><div>期貨量 <mark>${stageVolume(row.futureVolume ?? row.futopt_total_volume)}</mark></div><div>期貨價 <mark>${stageNumber(row.futurePrice ?? row.futopt_last_price, 2)}</mark></div><div>狀態 <mark>${escapeAttr(row.futureSourceStatus || row.source_status || "--")}</mark></div></div>
  </article>`).join("");
}

function renderPreopenStageRows(rows) {
  if (!rows.length) return `<div class="open-buy-empty">目前沒有期現試撮確認名單</div>`;
  return rows.slice(0, 18).map((row, index) => `<article class="open-buy-stage-item">
    <div class="open-buy-stage-item-top"><strong>#${index + 1} ${stageName(row)}</strong><span>${escapeAttr(row.basisState || "")} ${stagePercent(row.basisPct)}</span></div>
    <div class="open-buy-stage-metrics"><div>期貨 <mark>${stagePercent(row.futoptChangePercent ?? row.futopt_change_percent)}</mark></div><div>試撮 <mark>${stagePercent(row.trialPct)}</mark></div><div>委買賣比 <mark>${stageNumber(row.bidAskRatio, 2)}</mark></div><div>買/試 <mark>${stageNumber(row.bestBidPrice, 2)} / ${stageNumber(row.trialPrice, 2)}</mark></div></div>
  </article>`).join("");
}

function renderStagePanel(title, hint, count, body) {
  return `<section class="open-buy-stage-panel"><div class="open-buy-stage-panel-head"><div><strong>${title}</strong><small>${hint}</small></div><em>${cleanNumber(count).toLocaleString("zh-TW")}</em></div><div class="open-buy-stage-list">${body}</div></section>`;
}
  window.renderOpenBuyRadar = function renderOpenBuyRadar() {
  setStrategyChrome("openBuy");
  if (!openBuyCacheLoading && shouldLoadOpenBuyRemote()) {
    loadOpenBuyCache();
  }
  const scannedCount = openBuyScannedCodes.size;
  const totalCount = openBuyScanTotal || latestStocks.filter((stock) => !/^00/.test(stock.code)).length || latestStocks.length;

  const keyword = strategyKeyword.trim().toLowerCase();
  const rows = Object.values(openBuyScanMatches)
    .filter((stock) => !keyword || String(stock.code || "").includes(keyword) || String(stock.name || "").toLowerCase().includes(keyword))
    .sort((a, b) => b.score - a.score || b.percent - a.percent || b.value - a.value)
    .slice(0, 80);
  const scanCount = rows.length;
  const openBuyPaged = paginateTerminalRows(rows, openBuyPage);
  openBuyPage = openBuyPaged.page;
  const pageRows = openBuyPaged.rows;
  const futureRows = (typeof openBuyFutureInitialMatches !== "undefined" ? openBuyFutureInitialMatches : []).slice().sort((a, b) =>
    cleanNumber(b.futoptChangePercent ?? b.futopt_change_percent) - cleanNumber(a.futoptChangePercent ?? a.futopt_change_percent)
    || cleanNumber(b.relativeToTxfPercent ?? b.relative_to_txf_percent) - cleanNumber(a.relativeToTxfPercent ?? a.relative_to_txf_percent)
    || cleanNumber(b.futureVolume ?? b.futopt_total_volume) - cleanNumber(a.futureVolume ?? a.futopt_total_volume)
  );
  const preopenRows = typeof openBuyPreopenConfirmMatches !== "undefined" ? openBuyPreopenConfirmMatches : [];
  const finalRows = typeof openBuyFinalMatches !== "undefined" ? openBuyFinalMatches : [];

  const scanText = openBuyScanLastAt
    ? `已掃描 ${scannedCount}/${totalCount}｜候選 ${scanCount}｜${new Date(openBuyScanLastAt).toLocaleTimeString("zh-TW", { hour12: false })}`
    : `等待後端掃描 0/${totalCount}`;

  if (strategySummary) strategySummary.textContent = `策略1-明日開盤入｜08:46期貨初動｜08:55期現試撮｜08:58終判｜${scanText}`;
  if (strategyMatchCount) strategyMatchCount.textContent = rows.length.toLocaleString("zh-TW");
  if (strategyAvgScore) strategyAvgScore.textContent = rows.length ? Math.round(rows.reduce((sum, stock) => sum + stock.score, 0) / rows.length) : "--";
  if (strategyTopHit) strategyTopHit.textContent = finalRows.length ? finalRows.length.toLocaleString("zh-TW") : "--";

  const getOpenBuyDisplayStatus = (stock) => {
    const reasonTag = String(stock.reason || "").split("：")[0].trim();
    if (reasonTag === "開盤無腦入") return "開盤入";
    if (reasonTag && reasonTag.length <= 8) return reasonTag;
    if (stock.status === "開盤無腦入") return "開盤入";
    return stock.status || "開盤入";
  };

  const tableRows = pageRows.length ? pageRows.map((stock) => {
    const sign = stock.percent >= 0 ? "+" : "";
    const displayStatus = getOpenBuyDisplayStatus(stock);
    return `<tr><td><span class="code">${stock.code}</span></td><td>${stock.name}</td><td><b class="swing-stage mid">${displayStatus}</b></td><td class="price">${formatNumber(stock.close, stock.close >= 100 ? 0 : 2)}</td><td class="pct">${sign}${stock.percent.toFixed(2)}%</td><td>${stock.entry || "09:00 開盤價"}</td><td class="price">${formatNumber(stock.takeProfit, stock.takeProfit >= 100 ? 1 : 2)}</td><td class="price">${formatNumber(stock.stopLoss, stock.stopLoss >= 100 ? 1 : 2)}</td><td><span class="swing-score">${stock.score}</span></td><td>${stock.reason || "昨日強勢，列入開盤入候選。"}</td></tr>`;
  }).join("") : `<tr><td colspan="10">策略1後端掃描中。等待 08:46 期貨初動、08:55 期現試撮與 08:58 終判資料。</td></tr>`;
  const pager = buildTerminalPagination("openBuy", openBuyPage, openBuyPaged.totalPages, rows.length);

  strategyTable.innerHTML = `
    <section class="swing-dashboard open-buy-tactical-dashboard">
      <div class="swing-topbar">
        <div><h2>${titleWithSchedule("⚡", "策略1-明日開盤入", "openBuy")}</h2><p>08:46 看誰先強；08:55 看期貨強是否被試撮確認；08:58~08:59 做終判。${scanText}</p></div>
        ${renderStageCards()}
      </div>
      <div class="open-buy-stage-grid">
        ${renderStagePanel("08:46 期貨初動", "只列期貨強勢排序，不代表可買。", futureRows.length || cleanNumber(openBuyStageCounts.futureInitial0846), renderFutureStageRows(futureRows))}
        ${renderStagePanel("08:55 期現試撮", "列期貨 + 試撮 + 正逆價差，主要觀察名單。", preopenRows.length || cleanNumber(openBuyStageCounts.preopenConfirm0855), renderPreopenStageRows(preopenRows))}
        ${renderStagePanel("08:58~08:59 終判", "最接近 STAR / 開盤可衝，沒過不硬列。", finalRows.length || cleanNumber(openBuyStageCounts.finalJudgement0858), finalRows.length ? renderPreopenStageRows(finalRows) : `<div class="open-buy-empty">目前沒有終判通過名單</div>`)}
      </div>
      <section class="swing-panel open-buy-final-table-wrap"><div class="swing-tabs"><button class="active" type="button">正式名單(${rows.length})</button><div class="swing-actions"><input type="search" placeholder="搜尋代號/名稱" value="${escapeAttr(strategyKeyword)}" autocomplete="off" spellcheck="false" inputmode="search" data-strategy-inline-search><button type="button" data-export-action>匯出</button><button type="button" data-export-settings>設定</button></div></div><table class="swing-table"><thead><tr><th>股票代號</th><th>股票名稱</th><th>狀態</th><th>收盤價</th><th>昨日漲幅</th><th>買入</th><th>停利</th><th>停損</th><th>分數</th><th>原因</th></tr></thead><tbody>${tableRows}</tbody></table>${pager}</section>
    </section>`;
}

  try {
    const activeStrategy = document.querySelector("#strategy-view.active");
    const routeText = String(document.querySelector("[data-view='strategy'].active")?.textContent || "");
    const isOpenBuy = strategyPresetMode === "openBuy" || selectedStrategyIds?.has?.("open_buy") || routeText.includes("策略1");
    if (activeStrategy && isOpenBuy) requestAnimationFrame(() => renderStrategyScanner());
  } catch (error) {}
})();
