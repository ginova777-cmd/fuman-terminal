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

  window.renderOpenBuyRadar = function renderOpenBuyRadar() {
    setStrategyChrome("openBuy");
    if (!openBuyCacheLoading && shouldLoadOpenBuyRemote()) loadOpenBuyCache();
    const scannedCount = openBuyScannedCodes.size;
    const totalCount = openBuyScanTotal || latestStocks.filter((stock) => !/^00/.test(stock.code)).length || latestStocks.length;
    const keyword = strategyKeyword.trim().toLowerCase();
    const rows = Object.values(openBuyScanMatches)
      .filter((stock) => !keyword || String(stock.code || "").includes(keyword) || String(stock.name || "").toLowerCase().includes(keyword))
      .sort((a, b) => cleanNumber(b.score) - cleanNumber(a.score) || cleanNumber(b.percent) - cleanNumber(a.percent) || tradeValue(b) - tradeValue(a))
      .slice(0, 80);
    const scanCount = rows.length;
    const openBuyPaged = paginateTerminalRows(rows, openBuyPage, "openBuy");
    openBuyPage = openBuyPaged.page;
    const pageRows = openBuyPaged.rows;
    const scanText = openBuyScanLastAt
      ? `已掃描 ${scannedCount}/${totalCount}｜候選 ${scanCount}｜${new Date(openBuyScanLastAt).toLocaleTimeString("zh-TW", { hour12: false })}`
      : `等待後端掃描 0/${totalCount}`;
    const freshnessDate = openBuyDataDateKey || marketAiDataDateKey(Object.values(openBuyScanMatches));
    const freshnessToday = marketAiTodayKey();
    const freshnessIsToday = freshnessDate === freshnessToday;
    const freshness = freshnessDate
      ? `<div class="data-freshness-bar open-buy-freshness-bar ${freshnessIsToday ? "is-live" : "is-stale"}" data-open-buy-freshness-bar="1">模式：<strong>策略1｜最新可用收盤資料</strong>｜資料日期：<strong>${escapeAttr(formatMarketAiDateKey(freshnessDate))}</strong>｜今日：<strong>${escapeAttr(formatMarketAiDateKey(freshnessToday))}</strong>${freshnessIsToday ? "" : "｜狀態：<strong>快取/最新可用</strong>"}</div>`
      : renderDataFreshnessLoadingHtml(`open-buy:${freshnessDate}:${freshnessToday}`);
    const stageCards = typeof openBuyStageCards !== "undefined" && Array.isArray(openBuyStageCards) ? openBuyStageCards : [];
    const stageOne = stageCards.find((card) => card.key === "candidate_2130_futopt_0845") || {};
    const stageTwo = stageCards.find((card) => card.key === "auction_0855") || {};
    const buyCount = typeof openBuyBuyCount !== "undefined" ? cleanNumber(openBuyBuyCount) : 0;
    const decisionPending = typeof openBuyDecisionPending !== "undefined" ? Boolean(openBuyDecisionPending) : false;
    const futoptText = stageOne.status === "ready" ? "個股期貨已確認" : stageOne.status === "waiting" ? "等待 08:45 個股期貨" : "盤前資源檢查";
    const stageScanCount = cleanNumber(stageOne.count) || scanCount;
    const readyBuyText = decisionPending && !buyCount ? "待確認" : (cleanNumber(stageTwo.count) || buyCount || 0);

    if (strategySummary) strategySummary.textContent = `策略1-明日開盤入｜21:30初篩+08:45個股期貨｜08:55搓合確認｜${scanText}`;
    if (strategyMatchCount) strategyMatchCount.textContent = rows.length.toLocaleString("zh-TW");
    if (strategyAvgScore) strategyAvgScore.textContent = rows.length ? Math.round(rows.reduce((sum, stock) => sum + cleanNumber(stock.score), 0) / rows.length) : "--";
    if (strategyTopHit) strategyTopHit.textContent = rows.length ? `${Math.max(...rows.map((stock) => cleanNumber(stock.score))).toFixed(0)}` : "--";

    const offset = (openBuyPaged.page - 1) * openBuyPaged.pageSize;
    const tableRows = pageRows.length ? pageRows.map((stock, index) => {
      const rank = offset + index + 1;
      const price = num(stock, ["close", "price", "ClosingPrice"]);
      const pct = cleanNumber(stock.percent);
      const pctClass = pctToneClass(pct);
      const sign = pct >= 0 ? "+" : "";
      const volume = num(stock, ["tradeVolume", "volume", "trade_volume", "TradeVolume"]);
      const volRatio = ratio(stock);
      const value = tradeValue(stock);
      const legal = legal5d(stock);
      const score = cleanNumber(stock.score);
      return `
        <tr class="open-buy-tactical-row">
          <td data-label="排名"><span class="open-buy-rank">#${rank}</span></td>
          <td data-label="股票"><div class="open-buy-stock"><strong>${escapeAttr(stock.name || stock.code)}</strong><small>${escapeAttr(stock.code || "")}</small></div></td>
          <td data-label="多空"><span class="open-buy-side long">多</span></td>
          <td data-label="價格" class="price">${price ? formatNumber(price, 2) : "--"}</td>
          <td data-label="漲幅" class="pct ${pctClass}">${sign}${formatNumber(pct, 2)}%</td>
          <td data-label="量">${volumeText(volume)}</td>
          <td data-label="推估量比"><strong>${volRatio ? formatNumber(volRatio, 1) + "x" : "--"}</strong></td>
          <td data-label="成交額" class="price">${moneyText(value)}</td>
          <td data-label="法人5D">${legal ? formatInstitution(legal) : "--"}</td>
          <td data-label="分數"><span class="swing-score">${score ? formatNumber(score, 1) : "--"}</span></td>
          <td data-label="AI分析" class="open-buy-analysis-cell">${renderAi(stock)}</td>
          <td data-label="觸發原因" class="open-buy-trigger-cell">${renderTrigger(stock)}</td>
        </tr>`;
    }).join("") : '<tr><td colspan="12">策略1後端掃描中。21:30 先篩選符合，08:45 確認個股期貨，08:55 看搓合完美符合。</td></tr>';
    const pager = buildTerminalPagination("openBuy", openBuyPage, openBuyPaged.totalPages, rows.length);
    strategyTable.innerHTML = `
      <section class="swing-dashboard open-buy-tactical-dashboard">
        <div class="swing-topbar">
          <div>
            <h2>${titleWithSchedule("⚡", "策略1-明日開盤入", "openBuy")}</h2>
            <p>21:30 先篩選符合；08:45 看個股期貨；08:55 搓合完美符合才進 BUY。${scanText}</p>
          </div>
        </div>
        ${freshness}
        <div class="swing-signal-grid">
          <button class="swing-card active selected" type="button">
            <div><strong>21:30 初篩 + 08:45 個股期貨</strong><small>先篩符合，再確認個股期貨｜${escapeAttr(futoptText)}</small></div><em>${escapeAttr(stageScanCount)}</em>
          </button>
          <button class="swing-card active" type="button">
            <div><strong>08:55 搓合確認</strong><small>搓合完美符合才列 BUY</small></div><em>${escapeAttr(readyBuyText)}</em>
          </button>
        </div>
        <section class="swing-panel open-buy-tactical-panel">
          <table class="swing-table open-buy-tactical-table">
            <thead><tr><th>排名</th><th>股票</th><th>多空</th><th>價格</th><th>漲幅</th><th>量</th><th>推估量比</th><th>成交額</th><th>法人5D</th><th>分數</th><th>AI分析</th><th>觸發原因</th></tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
          ${pager}
        </section>
      </section>`;
  };

  try {
    const activeStrategy = document.querySelector("#strategy-view.active");
    const routeText = String(document.querySelector("[data-view='strategy'].active")?.textContent || "");
    const isOpenBuy = strategyPresetMode === "openBuy" || selectedStrategyIds?.has?.("open_buy") || routeText.includes("策略1");
    if (activeStrategy && isOpenBuy) requestAnimationFrame(() => renderStrategyScanner());
  } catch (error) {}
})();
