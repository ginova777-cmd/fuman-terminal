(function () {
  window.FUMAN_CHIP_FLOW_MODULE = {
    install(context) {
      const scope = context?.scope || {};
      const required = [
        "isViewActive",
        "canRunViewWork",
        "isMobileViewport",
        "cleanNumber",
        "formatNumber",
        "paginateTerminalRows",
        "buildTerminalPagination",
        "loadInstitutionSummary",
        "fetchVersionedJson",
        "normalizeArray",
        "valueOf",
        "normalizeTradeVolumeLots",
        "stockChange",
        "applyStaticTitleIcons",
      ];
      const missing = required.filter((name) => typeof scope[name] !== "function");

      function renderModuleError(message) {
        const body = document.querySelector("#chip-trade-body");
        if (body) body.innerHTML = `<tr><td colspan="14">${escapeText(message)}</td></tr>`;
      }

      if (missing.length) {
        return {
          renderChipTradeTable: () => renderModuleError(`買賣超模組缺少依賴：${missing.join(", ")}。請重新部署前端模組。`),
          loadChipTradeData: () => renderModuleError(`買賣超模組缺少依賴：${missing.join(", ")}。請重新部署前端模組。`),
        };
      }

      let tdccBreakoutPayload = null;
      let tdccBreakoutLoadedAt = 0;
      let tdccBreakoutLoading = null;
      let chipExclusionsPayload = null;
      let chipExclusionsLoadedAt = 0;
      let chipExclusionsLoading = null;
      const TDCC_CACHE_MS = 10 * 60 * 1000;

      const cleanNumber = scope.cleanNumber;
      const formatNumber = scope.formatNumber;
      const normalizeTradeVolumeLots = scope.normalizeTradeVolumeLots;

      function escapeText(value) {
        return String(value ?? "").replace(/[&<>"']/g, (char) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "\"": "&quot;",
          "'": "&#39;",
        })[char]);
      }

      function formatChipDate(dateStr) {
        if (!dateStr || String(dateStr).length !== 8) return "等待盤後資料";
        const text = String(dateStr);
        return `法人資料: ${text.slice(0, 4)}/${text.slice(4, 6)}/${text.slice(6, 8)}`;
      }

      function normalizeChipDateKey(value) {
        return String(value || "").replace(/\D/g, "").slice(0, 8);
      }

      function getChipQuoteDate() {
        const row = (scope.latestStocks || []).find((stock) => stock.quoteDate || stock.tradeDate || stock.date);
        return normalizeChipDateKey(row?.quoteDate || row?.tradeDate || row?.date || "");
      }

      function chipErrorText(error) {
        return String(error?.message || error || "未知錯誤").replace(/[<>&]/g, "").slice(0, 120);
      }

      function reportChipFlowError(stage, error) {
        try {
          const payload = JSON.stringify({
            kind: "chip-flow:" + stage,
            message: String(error?.message || error || "unknown").slice(0, 240),
            view: "chip-trade",
            at: Date.now(),
          });
          if (navigator.sendBeacon) {
            navigator.sendBeacon("/api/frontend-error", new Blob([payload], { type: "application/json" }));
          } else {
            fetch("/api/frontend-error", { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
          }
        } catch {}
      }

      function formatChipSignedLots(value) {
        const n = cleanNumber(value);
        if (!Number.isFinite(n)) return "--";
        const lots = Math.trunc(n / 1000);
        const sign = lots >= 0 ? "+" : "";
        return `${sign}${lots.toLocaleString("zh-TW")}`;
      }

      function formatChipLots(value) {
        const n = cleanNumber(value);
        if (!Number.isFinite(n) || n <= 0) return "--";
        return Math.round(normalizeTradeVolumeLots(n)).toLocaleString("zh-TW");
      }

      function formatChipSignedPercent(value) {
        const n = cleanNumber(value);
        if (!Number.isFinite(n)) return "--";
        const sign = n > 0 ? "+" : "";
        return `${sign}${formatNumber(n, 2)}`;
      }

      function formatRatio(value) {
        const n = cleanNumber(value);
        return Number.isFinite(n) ? `${formatNumber(n, 2)}%` : "--";
      }

      function isTdccMode(mode = scope.chipFilter) {
        return mode === "tdcc1000" || mode === "foreignTrustVolumePct";
      }

      function isFocusColumn(columnKey) {
        if (scope.chipFilter === "foreignTrustVolumePct") return columnKey === "foreignTrustVolumePct";
        if (scope.chipFilter === "foreignStreak") return columnKey === "foreignStreak";
        if (scope.chipFilter === "trustStreak") return columnKey === "trustStreak";
        if (scope.chipFilter === "jointStreak") return columnKey === "jointStreak";
        if (scope.chipFilter === "tdcc1000") return ["foreignStreak", "ratio1", "ratio2", "ratio3", "ratioIncrease"].includes(columnKey);
        return false;
      }

      function focusColumnClass(columnKey) {
        return isFocusColumn(columnKey) ? " chip-focus-column" : "";
      }

      function chipVolumeLots(value, key = "") {
        const n = cleanNumber(value);
        if (!Number.isFinite(n) || n <= 0) return 0;
        const field = String(key || "").toLowerCase();
        const shareBasedField = /tradevolume|fivedayavgvolume|avg_volume_5|avgvolume5|avg5volume|innerouter|insideoutside|accumulated|cumulative/.test(field);
        if (shareBasedField) return n / 1000;
        return n >= 100000 ? n / 1000 : n;
      }

      function firstChipVolumeLots(row, keys) {
        for (const key of keys) {
          const value = row?.[key];
          if (value !== undefined && value !== null && String(value).trim() !== "") return chipVolumeLots(value, key);
        }
        return 0;
      }

      function isChipOpportunityCandidate(row) {
        const code = String(row?.code || row?.Code || "").trim();
        const name = String(row?.name || row?.Name || "").trim();
        const industry = String(row?.industry || row?.officialIndustry || row?.primaryIndustry || row?.quoteIndustry || "").trim();
        const text = `${code} ${name} ${industry}`;
        if (!/^\d{4}$/.test(code) || /^00/.test(code)) return false;
        if (Array.isArray(chipExclusionsPayload?.blacklistCodes) && chipExclusionsPayload.blacklistCodes.includes(code)) return false;
        if (/(ETF|ETN|DR|指數|台灣50|高股息|正2|反1|期貨|債|權證|認購|認售|牛證|熊證|CB|可轉債)/i.test(text)) return false;
        if (/水泥|軍工|國防|航太|漢翔|雷虎|龍德|駐龍|晟田|寶一|亞航|千附/i.test(text)) return false;
        const avgVolume5 = firstChipVolumeLots(row, ["fiveDayAvgVolume", "avg_volume_5", "avgVolume5", "avg5Volume"]);
        if (avgVolume5 > 0 && avgVolume5 < 3000) return false;
        const innerOuter = firstChipVolumeLots(row, ["innerOuterVolume", "insideOutsideVolume", "accumulatedBidAskVolume", "cumulative_bid_ask_volume", "cumulativeBidAskVolume"]);
        const bid = firstChipVolumeLots(row, ["cumulative_bid_volume", "cumulativeBidVolume"]);
        const ask = firstChipVolumeLots(row, ["cumulative_ask_volume", "cumulativeAskVolume"]);
        const bidAskTotal = innerOuter || (bid || ask ? bid + ask : 0);
        if (bidAskTotal > 0 && bidAskTotal < 3000) return false;
        if (!bidAskTotal) {
          const tradeVolume = firstChipVolumeLots(row, ["tradeVolume", "volume", "TradeVolume"]);
          if (tradeVolume > 0 && tradeVolume < 3000) return false;
        }
        return true;
      }

      function setChipHeaders(mode) {
        const table = document.querySelector("#chip-trade-body")?.closest("table");
        const headRow = table?.querySelector("thead tr");
        if (!headRow) return;
        const headers = isTdccMode(mode)
          ? [
              { label: "股票代號" }, { label: "股票名稱" }, { label: "現價/收盤" }, { label: "漲幅(%)" },
              { label: "外資連買", key: "foreignStreak" }, { label: "外資買超(張)" },
              { label: "外資+投信佔均量", key: "foreignTrustVolumePct" },
              { label: "1000張比例 W1", key: "ratio1" }, { label: "1000張比例 W2", key: "ratio2" }, { label: "1000張比例 W3", key: "ratio3" },
              { label: "比例增幅", key: "ratioIncrease" }, { label: "起漲分" }, { label: "買點型態" }, { label: "過熱警示" },
            ]
          : [
              { label: "股票代號" }, { label: "股票名稱" }, { label: "現價/收盤" }, { label: "漲跌" }, { label: "漲幅(%)" },
              { label: "成交量(張)" }, { label: "近5日漲幅累計" }, { label: "近5日累計均量" },
              { label: "外資買賣超(張)" }, { label: "投信買賣超(張)" },
              { label: "外資連買", key: "foreignStreak" }, { label: "投信連買", key: "trustStreak" }, { label: "同買", key: "jointStreak" },
              { label: "法人合計(張)" },
            ];
        headRow.innerHTML = headers.map((header) => `<th class="${focusColumnClass(header.key).trim()}">${header.label}</th>`).join("");
      }

      function setTdLabels(row, labels) {
        [...row.children].forEach((td, index) => {
          if (labels[index]) td.setAttribute("data-label", labels[index]);
        });
      }

      async function loadTdccBreakout(force = false) {
        if (!force && tdccBreakoutPayload && Date.now() - tdccBreakoutLoadedAt < TDCC_CACHE_MS) return tdccBreakoutPayload;
        if (tdccBreakoutLoading) return tdccBreakoutLoading;
        const endpoint = scope.endpoints?.institutionTdccBreakout || "/data/institution-tdcc-breakout-top.json";
        tdccBreakoutLoading = scope.fetchVersionedJson(endpoint, 10000, "", force)
          .then((payload) => {
            tdccBreakoutPayload = payload?.ok ? payload : null;
            tdccBreakoutLoadedAt = Date.now();
            return tdccBreakoutPayload;
          })
          .finally(() => {
            tdccBreakoutLoading = null;
          });
        return tdccBreakoutLoading;
      }

      async function loadChipExclusions(force = false) {
        if (!force && chipExclusionsPayload && Date.now() - chipExclusionsLoadedAt < TDCC_CACHE_MS) return chipExclusionsPayload;
        if (chipExclusionsLoading) return chipExclusionsLoading;
        const endpoint = scope.endpoints?.chipTradeExclusions || "/data/chip-trade-exclusions.json";
        chipExclusionsLoading = scope.fetchVersionedJson(endpoint, 7000, "", force)
          .then((payload) => {
            chipExclusionsPayload = payload?.ok ? payload : { ok: false, blacklistCodes: [] };
            chipExclusionsLoadedAt = Date.now();
            return chipExclusionsPayload;
          })
          .catch(() => {
            chipExclusionsPayload = { ok: false, blacklistCodes: [] };
            chipExclusionsLoadedAt = Date.now();
            return chipExclusionsPayload;
          })
          .finally(() => {
            chipExclusionsLoading = null;
          });
        return chipExclusionsLoading;
      }

      function tdccRows() {
        return (Array.isArray(tdccBreakoutPayload?.matches) ? tdccBreakoutPayload.matches : []).filter(isChipOpportunityCandidate);
      }

      function updateDateLine() {
        const dateEl = document.querySelector("#chip-trade-date");
        if (!dateEl) return;
        const now = new Date();
        const time = now.toLocaleTimeString("zh-TW", { hour12: false });
        const quoteDate = getChipQuoteDate();
        const institutionKey = normalizeChipDateKey(scope.institutionDate);
        const quoteLabel = quoteDate ? `${quoteDate.slice(0, 4)}/${quoteDate.slice(4, 6)}/${quoteDate.slice(6, 8)}` : "待確認";
        const dateWarning = institutionKey && quoteDate && institutionKey !== quoteDate ? `｜日期不同步：報價 ${quoteLabel}` : "";
        if (isTdccMode()) {
          const dates = Array.isArray(tdccBreakoutPayload?.dates) ? tdccBreakoutPayload.dates.join(" / ") : "等待TDCC";
          dateEl.textContent = `${formatChipDate(scope.institutionDate)}｜TDCC ${dates}｜更新 ${time}${dateWarning}`;
          return;
        }
        dateEl.textContent = `${formatChipDate(scope.institutionDate)}｜報價 ${quoteLabel}｜盤後收盤　更新 ${time}${dateWarning}`;
      }

      function baseRows() {
        const rows = (scope.latestStocks || [])
          .map((stock) => {
            const code = String(stock.code || stock.Code || "");
            const inst = scope.institutionData?.[code];
            if (!inst) return null;
            return buildBaseRow(code, inst, stock);
          })
          .filter(Boolean)
          .filter(isChipOpportunityCandidate)
          .filter((row) => matchesChipFilter(row));

        if (!rows.length && Object.keys(scope.institutionData || {}).length) {
          Object.entries(scope.institutionData || {}).forEach(([code, inst]) => {
            const row = buildBaseRow(code, inst, {});
            if (isChipOpportunityCandidate(row) && matchesChipFilter(row)) rows.push(row);
          });
        }
        return rows;
      }

      function buildBaseRow(code, inst, stock) {
        const foreign = Number(inst.foreign) || 0;
        const trust = Number(inst.trust) || 0;
        const total = Number(inst.total) || foreign + trust + (Number(inst.dealer) || 0);
        return {
          code,
          name: inst.name || stock.name || code,
          price: cleanNumber(inst.close) || cleanNumber(stock.close),
          change: Number.isFinite(Number(inst.change)) ? Number(inst.change) : cleanNumber(stock.change),
          percent: Number.isFinite(Number(inst.percent)) ? Number(inst.percent) : cleanNumber(stock.percent),
          volume: normalizeTradeVolumeLots(inst.tradeVolume) || cleanNumber(stock.tradeVolume),
          value: cleanNumber(inst.value) || cleanNumber(stock.value),
          fiveDayPctSum: cleanNumber(inst.fiveDayPctSum) || cleanNumber(stock.fiveDayPctSum),
          fiveDayAvgVolume: cleanNumber(inst.fiveDayAvgVolume) || cleanNumber(stock.fiveDayAvgVolume),
          foreign,
          trust,
          total,
          foreignStreak: Number(inst.foreignStreak) || 0,
          trustStreak: Number(inst.trustStreak) || 0,
          jointStreak: Number(inst.jointStreak) || 0,
        };
      }

      function matchesChipFilter(row) {
        if (scope.chipFilter === "joint") return row.foreign > 0 && row.trust > 0;
        if (scope.chipFilter === "trust") return row.trust > 0;
        if (scope.chipFilter === "foreignStreak") return row.foreignStreak > 0;
        if (scope.chipFilter === "trustStreak") return row.trustStreak > 0;
        if (scope.chipFilter === "jointStreak") return row.jointStreak > 0;
        if (scope.chipFilter === "foreign") return row.foreign > 0;
        if (scope.chipFilter === "legal") return row.total > 0;
        return true;
      }

      function sortByStreak(rows, key, flowKey) {
        rows.sort((a, b) => {
          const streakDiff = cleanNumber(b[key]) - cleanNumber(a[key]);
          if (streakDiff) return streakDiff;
          const flowDiff = cleanNumber(b[flowKey]) - cleanNumber(a[flowKey]);
          if (flowDiff) return flowDiff;
          return cleanNumber(b.value) - cleanNumber(a.value);
        });
      }

      function renderNormalRows(body, shown, pagination) {
        const labels = ["代號", "名稱", "現價", "漲跌", "漲幅", "成交量(張)", "近5日漲幅累計", "近5日累計均量", "外資買賣超(張)", "投信買賣超(張)", "外資連", "投信連", "同買", "法人合計(張)"];
        body.innerHTML = shown.map((row, index) => {
          const up = row.change >= 0;
          const hasQuote = row.price > 0;
          return `
            <tr class="${index === 0 ? "highlight" : ""}" data-chip-row="${escapeText(row.code)}">
              <td class="chip-cell-code"><a href="#" data-chip-code="${escapeText(row.code)}">${escapeText(row.code)}</a></td>
              <td class="chip-cell-name">${escapeText(row.name)}</td>
              <td class="chip-cell-number" data-chip-price>${hasQuote ? formatNumber(row.price, row.price >= 100 ? 0 : 2) : "載入..."}</td>
              <td data-chip-change class="chip-cell-number ${up ? "red" : "green"}">${hasQuote ? `${up ? "+" : ""}${formatNumber(row.change, 2)}` : "--"}</td>
              <td data-chip-percent class="chip-cell-number ${row.percent >= 0 ? "red" : "green"}">${hasQuote ? formatNumber(row.percent, 2) : "--"}</td>
              <td class="chip-cell-number" data-chip-volume>${hasQuote ? Math.round(row.volume).toLocaleString("zh-TW") : "--"}</td>
              <td class="chip-cell-number ${row.fiveDayPctSum >= 0 ? "red" : "green"}">${formatChipSignedPercent(row.fiveDayPctSum)}</td>
              <td class="chip-cell-number">${formatChipLots(row.fiveDayAvgVolume)}</td>
              <td class="chip-cell-flow ${row.foreign >= 0 ? "red" : "green"}">${formatChipSignedLots(row.foreign)}</td>
              <td class="chip-cell-flow ${row.trust >= 0 ? "red" : "green"}">${formatChipSignedLots(row.trust)}</td>
              <td class="chip-cell-streak${focusColumnClass("foreignStreak")}">${row.foreignStreak} 日</td>
              <td class="chip-cell-streak${focusColumnClass("trustStreak")}">${row.trustStreak} 日</td>
              <td class="chip-cell-streak${focusColumnClass("jointStreak")}">${row.jointStreak} 日</td>
              <td class="chip-cell-flow ${row.total >= 0 ? "red" : "green"}">${formatChipSignedLots(row.total)}</td>
            </tr>
          `;
        }).join("");
        [...body.querySelectorAll("tr")].forEach((tr) => setTdLabels(tr, labels));
        if (pagination) pagination.hidden = false;
      }

      function renderTdccRows(body, shown, pagination) {
        const labels = ["代號", "名稱", "現價", "漲幅", "外資連", "外資買超(張)", "外資+投信佔均量", "1000張W1", "1000張W2", "1000張W3", "增幅", "起漲分", "買點", "過熱"];
        body.innerHTML = shown.map((row, index) => `
          <tr class="${index === 0 ? "highlight" : ""}" data-chip-row="${escapeText(row.code)}">
            <td class="chip-cell-code"><a href="#" data-chip-code="${escapeText(row.code)}">${escapeText(row.code)}</a></td>
            <td class="chip-cell-name">${escapeText(row.name)}</td>
            <td class="chip-cell-number">${formatNumber(cleanNumber(row.close), cleanNumber(row.close) >= 100 ? 0 : 2)}</td>
            <td class="chip-cell-number ${cleanNumber(row.changePct) >= 0 ? "red" : "green"}">${formatChipSignedPercent(row.changePct)}</td>
            <td class="chip-cell-streak${focusColumnClass("foreignStreak")}">${cleanNumber(row.foreignStreak)} 日</td>
            <td class="chip-cell-flow red">+${Math.round(cleanNumber(row.foreignLots)).toLocaleString("zh-TW")}</td>
            <td class="chip-cell-number red${focusColumnClass("foreignTrustVolumePct")}">+${formatNumber(cleanNumber(row.foreignTrustBuyVolumePct ?? row.institutionBuyVolumePct), 2)}%</td>
            <td class="chip-cell-number${focusColumnClass("ratio1")}">${formatRatio(row.ratio1)}</td>
            <td class="chip-cell-number${focusColumnClass("ratio2")}">${formatRatio(row.ratio2)}</td>
            <td class="chip-cell-number${focusColumnClass("ratio3")}">${formatRatio(row.ratio3)}</td>
            <td class="chip-cell-number red${focusColumnClass("ratioIncrease")}">+${formatNumber(cleanNumber(row.ratioIncrease), 2)}%</td>
            <td class="chip-cell-number">${cleanNumber(row.breakoutScore) || "--"}</td>
            <td class="chip-cell-streak">${escapeText(row.entryType || "--")}</td>
            <td class="chip-cell-name">${escapeText(row.heatWarning || "正常")}</td>
          </tr>
        `).join("");
        [...body.querySelectorAll("tr")].forEach((tr) => setTdLabels(tr, labels));
        if (pagination) pagination.hidden = false;
      }

      function renderChipTradeTable() {
        if (!scope.isViewActive("chip-trade")) return;
        const body = document.querySelector("#chip-trade-body");
        const sortEl = document.querySelector("#chip-sort");
        if (!body) return;

        const isTdcc = isTdccMode();
        setChipHeaders(scope.chipFilter);
        updateDateLine();

        if (isTdcc && !tdccBreakoutPayload) {
          body.innerHTML = `<tr><td colspan="14">正在載入「外資連3買 + 1000張比例連3週增加」名單...</td></tr>`;
          loadTdccBreakout(false).then(() => renderChipTradeTable()).catch((error) => {
            body.innerHTML = `<tr><td colspan="14">TDCC 起漲名單讀取失敗：${chipErrorText(error)}</td></tr>`;
          });
          return;
        }

        const rows = isTdcc ? tdccRows() : baseRows();
        const sortBy = sortEl?.value || "trustForeign";
        if (isTdcc) {
          if (scope.chipFilter === "foreignTrustVolumePct" || sortBy === "foreignTrustVolumePct") {
            rows.sort((a, b) => cleanNumber(b.foreignTrustBuyVolumePct ?? b.institutionBuyVolumePct) - cleanNumber(a.foreignTrustBuyVolumePct ?? a.institutionBuyVolumePct) || cleanNumber(b.breakoutScore) - cleanNumber(a.breakoutScore) || cleanNumber(b.foreignLots) - cleanNumber(a.foreignLots));
          } else {
            rows.sort((a, b) => cleanNumber(b.ratioIncrease) - cleanNumber(a.ratioIncrease) || cleanNumber(b.breakoutScore) - cleanNumber(a.breakoutScore) || cleanNumber(b.foreignLots) - cleanNumber(a.foreignLots));
          }
        } else {
          if (scope.chipFilter === "foreignStreak") sortByStreak(rows, "foreignStreak", "foreign");
          else if (scope.chipFilter === "trustStreak") sortByStreak(rows, "trustStreak", "trust");
          else if (scope.chipFilter === "jointStreak") sortByStreak(rows, "jointStreak", "total");
          else {
            rows.sort((a, b) => {
              if (sortBy === "trust") return b.trust - a.trust;
              if (sortBy === "foreign") return b.foreign - a.foreign;
              if (sortBy === "pct") return b.percent - a.percent;
              if (sortBy === "value") return b.value - a.value;
              return (b.jointStreak - a.jointStreak) || ((b.foreign + b.trust) - (a.foreign + a.trust));
            });
          }
        }

        const visibleRows = rows.slice(0, 80);
        const chipPaged = scope.paginateTerminalRows(visibleRows, scope.chipTradePage, "chip");
        scope.chipTradePage = chipPaged.page;
        const shown = chipPaged.rows;
        const table = body.closest("table");
        let pagination = document.querySelector("#chip-trade-pagination");
        if (!pagination && table) {
          pagination = document.createElement("div");
          pagination.id = "chip-trade-pagination";
          table.insertAdjacentElement("afterend", pagination);
        }
        if (pagination) pagination.innerHTML = scope.buildTerminalPagination("chip", scope.chipTradePage, chipPaged.totalPages, visibleRows.length);

        const renderSignature = `${scope.institutionUpdatedAt || 0}:${scope.chipFilter}:${sortBy}:${scope.chipTradePage}:${rows.length}:${shown.map((row) => `${row.code}:${row.close || row.price}:${row.ratioIncrease || row.percent}:${row.foreignLots || row.foreign}:${row.trust || ""}`).join("|")}`;
        if (renderSignature === scope.chipTradeLastRenderSignature) return;
        scope.chipTradeLastRenderSignature = renderSignature;

        if (!shown.length) {
          const emptyText = {
            joint: "目前沒有符合「外資 + 投信同買」的資料，盤後資料更新後會自動刷新。",
            tdcc1000: "目前沒有符合「外資連3買 + 1000張比例連3週增加」的資料。",
            foreignTrustVolumePct: "目前沒有符合「外資+投信佔5日均量」的資料。",
            trust: "目前沒有符合「投信買超」的資料，盤後資料更新後會自動刷新。",
            foreignStreak: "目前沒有符合「外資連買日」的資料，盤後資料更新後會自動刷新。",
            trustStreak: "目前沒有符合「投信連買日」的資料，盤後資料更新後會自動刷新。",
            jointStreak: "目前沒有符合「同買日」的資料，盤後資料更新後會自動刷新。",
            foreign: "目前沒有符合「外資買超」的資料，盤後資料更新後會自動刷新。",
            legal: "目前沒有符合「法人同買」的資料，盤後資料更新後會自動刷新。",
          }[scope.chipFilter] || "目前沒有符合條件的資料。";
          body.innerHTML = `<tr><td colspan="${isTdcc ? 14 : 14}">${emptyText}</td></tr>`;
          if (pagination) pagination.innerHTML = "";
          return;
        }

        if (isTdcc) renderTdccRows(body, shown, pagination);
        else renderNormalRows(body, shown, pagination);
      }

      function parseStocksForLatest(stocks) {
        return stocks.map((stock) => {
          const code = scope.valueOf(stock, ["證券代號", "Code", "code"]);
          const name = scope.valueOf(stock, ["證券名稱", "Name", "name"]);
          const value = cleanNumber(scope.valueOf(stock, ["成交金額", "TradeValue", "value"]));
          const tradeVolume = normalizeTradeVolumeLots(scope.valueOf(stock, ["成交股數", "TradeVolume", "tradeVolume", "volume"]));
          const volumeRatio = cleanNumber(scope.valueOf(stock, ["量比", "VolumeRatio", "volumeRatio", "volume_ratio"]));
          const quoteDate = scope.valueOf(stock, ["quoteDate", "QuoteDate", "tradeDate", "TradeDate", "date", "Date", "資料日期", "交易日期"]);
          const market = scope.valueOf(stock, ["market", "Market", "市場"]);
          return { code, name, value, tradeVolume, volumeRatio, quoteDate, market, ...scope.stockChange(stock) };
        }).filter((stock) => stock.code && stock.name && stock.close);
      }

      async function loadChipTradeData(force = false) {
        if (!scope.isViewActive("chip-trade") || !scope.canRunViewWork("chip-trade")) return;
        if (!force && scope.chipTradeLoadedAt && Date.now() - scope.chipTradeLoadedAt < scope.CHIP_TRADE_CACHE_MS) {
          await loadChipExclusions(false);
          if (isTdccMode()) await loadTdccBreakout(false);
          renderChipTradeTable();
          return;
        }
        if (scope.chipTradeLoading) return;
        scope.chipTradeLoading = true;
        const body = document.querySelector("#chip-trade-body");
        if (body) {
          scope.loadInstitutionSummary().then(() => {
            if (!scope.chipTradeLoading || !scope.institutionSummary || scope.institutionData && Object.keys(scope.institutionData).length) return;
            body.innerHTML = `<tr><td colspan="14">法人摘要已載入：${scope.institutionSummary.count || 0} 檔。正在讀取完整買賣超資料...</td></tr>`;
          });
          body.innerHTML = `<tr><td colspan="14">正在載入盤後法人資料...</td></tr>`;
        }

        try {
          const [stockResult, instResult, tdccResult] = await Promise.allSettled([
            scope.fetchVersionedJson(scope.endpoints.strategyStocks, 20000, "", force),
            scope.fetchVersionedJson(scope.isMobileViewport() && !force && !scope.chipTradePreferFull && scope.endpoints.institutionMobileTop ? scope.endpoints.institutionMobileTop : scope.endpoints.institutionSlim, 7000, scope.institutionSummary?.updatedAt || "", force),
            loadTdccBreakout(force),
            loadChipExclusions(force),
          ]);

          if (stockResult.status === "fulfilled") {
            const stocks = scope.normalizeArray(stockResult.value?.stocks || stockResult.value);
            const parsed = parseStocksForLatest(stocks);
            if (parsed.length) scope.latestStocks = parsed;
          }

          let instPayload = instResult.status === "fulfilled" ? instResult.value : null;
          if (instPayload?.rows && !instPayload.data) {
            instPayload = { ...instPayload, ok: instPayload.ok ?? true, data: Object.fromEntries(instPayload.rows.map((row) => [String(row.code || ""), row])) };
          }
          if (!instPayload?.ok || !instPayload?.data || !Object.keys(instPayload.data).length) {
            instPayload = await scope.fetchVersionedJson(scope.endpoints.institutionCache, 10000, scope.institutionSummary?.updatedAt || "", force);
          }
          if (!instPayload?.ok || !instPayload?.data || !Object.keys(instPayload.data).length) {
            instPayload = await scope.fetchVersionedJson(scope.endpoints.institutionBackup, 10000, scope.institutionSummary?.updatedAt || "", force);
          }
          if (instPayload?.ok && instPayload?.data) {
            scope.institutionData = instPayload.data;
            scope.institutionDate = instPayload.usedDate || "";
            const updatedAt = Date.parse(instPayload.updatedAt || "");
            scope.institutionUpdatedAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
          }
          if (tdccResult.status === "rejected") {
            console.warn("[FUMAN] TDCC breakout load skipped", tdccResult.reason);
          }

          scope.chipTradeLoadedAt = Date.now();
          scope.applyStaticTitleIcons();
          renderChipTradeTable();
        } catch (error) {
          reportChipFlowError("load", error);
          if (body) body.innerHTML = `<tr><td colspan="14">買賣超資料檔讀取失敗：${chipErrorText(error)}。已回報 frontend-error，請重新整理或稍後再試。</td></tr>`;
        } finally {
          scope.chipTradeLoading = false;
        }
      }

      return { renderChipTradeTable, loadChipTradeData };
    },
  };
})();
