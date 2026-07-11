(function () {
  "use strict";

  const VERSION = "watchlist-rich-shell-20260711-02";
  const WATCHLIST_KEY = "fuman_watchlist";
  const MOBILE_WATCHLIST_KEY = "fuman_mobile_watchlist_v1";
  const WATCHLIST_MAX_ITEMS = 10;
  const FEATURE_STATUS = [
    ["新增股票", "已開通"],
    ["全台上市上櫃", "已開通"],
    ["右側個股分析", "已開通"],
    ["技術分析", "已開通"],
    ["籌碼判讀", "已開通"],
    ["提醒功能", "已開通"],
  ];

  let installed = false;
  let selectedCode = "";
  let metaPromise = null;
  let memoryRows = [];
  const metaMap = new Map();
  const quoteMap = new Map();
  const metaHydratedCodes = new Set();
  const metaHydratingCodes = new Set();
  const pendingAddCodes = new Set();
  let storedValidationPromise = null;
  let matchIndexPromise = null;
  let matchIndexLoaded = false;
  const matchIndexByCode = new Map();

  function normalizeCode(value) {
    return String(value ?? "").trim().match(/\d{4}/)?.[0] || "";
  }

  function number(value) {
    const n = Number(String(value ?? "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function escapeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function normalizeMarket(value) {
    const text = String(value ?? "").trim().toUpperCase();
    if (["TPEX", "OTC", "TWO", "上櫃"].some((key) => text.includes(key))) return "TPEX";
    if (["TWSE", "TSE", "上市"].some((key) => text.includes(key))) return "TWSE";
    return text || "";
  }

  function marketLabel(value) {
    const market = normalizeMarket(value);
    if (market === "TPEX") return "上櫃";
    if (market === "TWSE") return "上市";
    return "台股";
  }

  function uniqueRows(rows, limit = WATCHLIST_MAX_ITEMS) {
    const seen = new Set();
    const output = [];
    for (const raw of Array.isArray(rows) ? rows : []) {
      const code = normalizeCode(raw?.code || raw?.symbol || raw?.Code || raw);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      const meta = findMetaSync(code);
      output.push({
        ...raw,
        code,
        name: String(raw?.name || raw?.Name || raw?.stockName || meta?.name || code).trim(),
        market: normalizeMarket(raw?.market || raw?.Market || meta?.market || "台股"),
        addedAt: raw?.addedAt || Date.now(),
      });
      if (output.length >= limit) break;
    }
    return output;
  }

  function parseStoredRows(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "[]");
    } catch {
      return [];
    }
  }

  function readRows() {
    const raw = parseStoredRows(WATCHLIST_KEY);
    const stored = raw.length ? raw : parseStoredRows(MOBILE_WATCHLIST_KEY);
    const merged = memoryRows.length ? [...memoryRows, ...stored] : stored;
    const normalized = uniqueRows(merged);
    memoryRows = normalized;
    if (stored.length !== normalized.length || stored.length > WATCHLIST_MAX_ITEMS) writeRows(normalized);
    return normalized;
  }

  function writeRows(rows) {
    const normalized = uniqueRows(rows);
    memoryRows = normalized;
    const value = JSON.stringify(normalized);
    try {
      localStorage.setItem(WATCHLIST_KEY, value);
      localStorage.setItem(MOBILE_WATCHLIST_KEY, value);
    } catch {}
    return normalized;
  }

  function extractRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    return [payload.stocks, payload.rows, payload.data, payload.items, payload.quotes].find(Array.isArray) || [];
  }

  function normalizeMeta(row) {
    const code = normalizeCode(row?.code || row?.Code || row?.symbol || row?.Symbol || row?.stock_id || row?.stockNo);
    if (!code) return null;
    return {
      code,
      name: String(row?.name || row?.Name || row?.stockName || row?.stock_name || row?.["證券名稱"] || row?.["名稱"] || code).trim(),
      market: normalizeMarket(row?.market || row?.Market || row?.exchange || row?.type || row?.["市場"] || row?.["上市櫃"]),
      close: number(row?.close ?? row?.Close ?? row?.price ?? row?.z),
      change: number(row?.change ?? row?.Change),
      percent: number(row?.percent ?? row?.pct ?? row?.changePercent ?? row?.漲跌幅),
      tradeVolume: number(row?.tradeVolume ?? row?.volume ?? row?.total_volume),
    };
  }

  function findMetaSync(code) {
    const target = normalizeCode(code);
    if (!target) return null;
    if (metaMap.has(target)) return metaMap.get(target);
    for (const row of extractRows(window.FUMAN_STOCKS_PAYLOAD || window.FUMAN_MARKET_STOCKS || window.__FUMAN_STOCKS__)) {
      const meta = normalizeMeta(row);
      if (meta) metaMap.set(meta.code, meta);
    }
    return metaMap.get(target) || null;
  }

  function isValidStockMeta(meta, code) {
    const target = normalizeCode(code || meta?.code);
    if (!target || !meta || normalizeCode(meta.code) !== target) return false;
    const name = String(meta.name || "").trim();
    return Boolean(name && name !== target && normalizeMarket(meta.market));
  }

  async function resolveStockMeta(code) {
    const target = normalizeCode(code);
    if (!target) return null;
    const cached = findMetaSync(target);
    if (isValidStockMeta(cached, target)) return cached;
    await loadMeta();
    const meta = metaMap.get(target) || findMetaSync(target);
    return isValidStockMeta(meta, target) ? meta : null;
  }

  async function validateStoredRows() {
    if (storedValidationPromise) return storedValidationPromise;
    storedValidationPromise = (async () => {
      await loadMeta();
      const rows = readRows();
      const kept = rows.filter((row) => isValidStockMeta(metaMap.get(row.code), row.code));
      if (kept.length !== rows.length) {
        const removed = rows.filter((row) => !kept.some((item) => item.code === row.code)).map((row) => row.code);
        const normalized = writeRows(kept);
        if (!normalized.some((row) => row.code === selectedCode)) selectedCode = normalized[0]?.code || "";
        showStatus(`${removed.join("、")} 不是有效上市/上櫃台股代號，已從自選股移除。`, "warn");
        render();
      }
      return kept;
    })().finally(() => {
      storedValidationPromise = null;
    });
    return storedValidationPromise;
  }

  async function loadMeta() {
    if (metaPromise) return metaPromise;
    metaPromise = (async () => {
      for (const url of [`/data/stocks-slim.json?t=${Date.now()}`, `/api/stocks?watchlist=1&t=${Date.now()}`]) {
        try {
          const response = await fetch(url, { cache: "no-store" });
          if (!response.ok) continue;
          const payload = await response.json();
          for (const row of extractRows(payload)) {
            const meta = normalizeMeta(row);
            if (meta) metaMap.set(meta.code, { ...(metaMap.get(meta.code) || {}), ...meta });
          }
          if (metaMap.size > 1000) break;
        } catch {}
      }
      return metaMap;
    })();
    return metaPromise;
  }

  function formatPrice(value) {
    const n = number(value);
    return n ? n.toLocaleString("zh-TW", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "--";
  }

  function formatPct(value) {
    const n = number(value);
    return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  }
  function normalizeMatchLabel(match) {
    if (!match) return "";
    if (typeof match === "string") return match.trim();
    return String(match.label || match.name || match.title || match.short || match.reason || match.id || "").trim();
  }

  function fallbackStrategyLabels(score, pct) {
    const labels = [];
    if (score >= 70 || pct >= 3) labels.push("強勢整理");
    else if (score >= 58 || pct >= 1) labels.push("偏多整理");
    if (score >= 58) labels.push("籌碼待確認");
    return labels;
  }

  function strategyMatchSummary(row, score, pct) {
    const code = normalizeCode(row?.code);
    const matches = code ? (matchIndexByCode.get(code) || []) : [];
    const labels = [...new Set(matches.map(normalizeMatchLabel).filter(Boolean))].slice(0, 4);
    const fallback = fallbackStrategyLabels(score, pct);
    const displayLabels = labels.length ? labels : fallback;
    return {
      labels: displayLabels,
      detail: labels.length ? `${labels.length} 項命中` : (matchIndexLoaded ? "目前未在策略/籌碼名單" : "讀取策略/籌碼名單中"),
    };
  }

  async function loadMatchIndex() {
    if (matchIndexPromise) return matchIndexPromise;
    matchIndexPromise = (async () => {
      try {
        const response = await fetch(`/api/watchlist-match-index?compact=1&t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`watchlist-match-index ${response.status}`);
        const payload = await response.json();
        matchIndexByCode.clear();
        const byCode = payload?.byCode && typeof payload.byCode === "object" ? payload.byCode : {};
        for (const [code, matches] of Object.entries(byCode)) {
          matchIndexByCode.set(normalizeCode(code), Array.isArray(matches) ? matches : []);
        }
        matchIndexLoaded = true;
        return matchIndexByCode;
      } catch {
        matchIndexLoaded = true;
        return matchIndexByCode;
      } finally {
        matchIndexPromise = null;
      }
    })();
    return matchIndexPromise;
  }

  function ensureMatchIndexForAnalysis(code) {
    if (matchIndexLoaded || matchIndexPromise) return;
    loadMatchIndex().then(() => {
      if (normalizeCode(code) === selectedCode) renderAnalysis(readRows().find((row) => row.code === selectedCode) || readRows()[0]);
    });
  }

  function fallbackRow(code) {
    const target = normalizeCode(code);
    const meta = findMetaSync(target);
    return {
      code: target,
      name: meta?.name || target,
      market: meta?.market || "台股",
      close: meta?.close || 0,
      change: meta?.change || 0,
      percent: meta?.percent || 0,
      addedAt: Date.now(),
      source: "watchlist-redesign",
    };
  }

  function mergeQuote(row) {
    return { ...row, ...(quoteMap.get(row.code) || {}), ...(findMetaSync(row.code) || {}) };
  }

  function metaChanged(row, meta) {
    if (!row || !meta) return false;
    return String(row.name || "") !== String(meta.name || "")
      || normalizeMarket(row.market) !== normalizeMarket(meta.market)
      || number(row.close) !== number(meta.close)
      || number(row.change) !== number(meta.change)
      || number(row.percent) !== number(meta.percent)
      || number(row.tradeVolume) !== number(meta.tradeVolume);
  }

  function showStatus(message, kind = "info") {
    const status = document.querySelector("#watchlist-entry-status");
    if (!status) return;
    status.textContent = message || "";
    status.dataset.statusKind = kind;
  }

  function ensureSkeleton() {
    const root = document.querySelector("#watchlist-view");
    if (!root) return null;
    root.classList.add("watchlist-view-rich");
    root.dataset.watchlistShellReady = "1";
    if (root.dataset.watchlistRedesignVersion === VERSION && root.querySelector("#watchlist-stocks") && root.querySelector("#watchlist-analysis")) return root;
    root.dataset.watchlistRedesignVersion = VERSION;
    root.innerHTML = `
      <header class="watchlist-rich-header">
        <div>
          <h1>自選股分析</h1>
          <p id="watchlist-refresh" class="watchlist-refresh-line">-- 最新收盤 ｜ 更新 --</p>
        </div>
      </header>
      <section class="watchlist-rich-shell" aria-label="自選股個股分析">
        <header class="watchlist-rich-shell-head">
          <h2>自選股 / 個股分析</h2>
          <p>左側管理追蹤清單，右側查看選中股票的 AI 個股判讀。</p>
        </header>
        <div class="watchlist-layout">
          <aside class="watchlist-list-pane">
            <section class="watchlist-list-card">
              <div class="watchlist-list-title">
                <div>
                  <h3>自選股</h3>
                  <p>點選股票後同步載入右側分析</p>
                </div>
                <span id="watchlist-count">0/10</span>
              </div>
              <div class="watchlist-entry-form">
                <input id="watchlist-search-input" class="watchlist-entry-input" type="text" placeholder="股票代碼" autocomplete="off" inputmode="numeric">
                <button id="watchlist-add-btn" class="watchlist-entry-add" type="button" aria-label="新增自選股">+</button>
              </div>
              <div id="watchlist-entry-status" class="watchlist-entry-status" role="status" aria-live="polite"></div>
              <div id="watchlist-stocks" class="watchlist-stock-list"></div>
            </section>
          </aside>
          <section id="watchlist-analysis" class="watchlist-analysis-pane"></section>
        </div>
      </section>
    `;
    bindRootEvents(root);
    return root;
  }

  function bindRootEvents(root) {
    if (root.dataset.watchlistEventsBound === VERSION) return;
    root.dataset.watchlistEventsBound = VERSION;
    root.addEventListener("click", (event) => {
      const add = event.target.closest("#watchlist-add-btn");
      if (add) {
        event.preventDefault();
        addFromInput(add);
        return;
      }
      const remove = event.target.closest("[data-watch-remove]");
      if (remove) {
        event.preventDefault();
        removeCode(remove.dataset.watchRemove || "");
        return;
      }
      const refresh = event.target.closest("[data-watchlist-refresh]");
      if (refresh) {
        event.preventDefault();
        refreshSelected();
        return;
      }
      const card = event.target.closest(".watchlist-card[data-code]");
      if (card) {
        event.preventDefault();
        selectCode(card.dataset.code || "");
      }
    });
    root.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.target?.id !== "watchlist-search-input") return;
      event.preventDefault();
      addFromInput(event.target);
    });
  }

  function updateLimitState(rows) {
    const input = document.querySelector("#watchlist-search-input");
    const add = document.querySelector("#watchlist-add-btn");
    const atLimit = rows.length >= WATCHLIST_MAX_ITEMS;
    if (input) {
      input.disabled = atLimit;
      input.placeholder = atLimit ? `已達 ${WATCHLIST_MAX_ITEMS} 檔上限` : "股票代碼";
    }
    if (add) {
      add.disabled = atLimit;
      add.setAttribute("aria-disabled", atLimit ? "true" : "false");
      add.title = atLimit ? `自選股已達 ${WATCHLIST_MAX_ITEMS} 檔上限` : "新增自選股";
    }
  }

  async function addCode(value, source = "manual") {
    ensureSkeleton();
    const code = normalizeCode(value);
    if (!code) {
      showStatus("請輸入四碼股票代號", "warn");
      return false;
    }
    let rows = readRows();
    const existed = rows.some((row) => row.code === code);
    if (!existed && rows.length >= WATCHLIST_MAX_ITEMS) {
      showStatus(`已達 ${WATCHLIST_MAX_ITEMS} 檔上限，請先移除一檔再新增。`, "warn");
      updateLimitState(rows);
      return false;
    }
    if (!existed) {
      if (pendingAddCodes.has(code)) {
        showStatus(`${code} 正在確認台股代號`, "info");
        return false;
      }
      pendingAddCodes.add(code);
      showStatus(`${code} 正在確認台股代號`, "info");
      try {
        const meta = await resolveStockMeta(code);
        if (!meta) {
          showStatus(`${code} 不是有效上市/上櫃台股代號，請確認後再新增。`, "warn");
          render();
          return false;
        }
        rows = readRows();
        if (rows.some((row) => row.code === code)) {
          selectedCode = code;
          showStatus(`${code} 已在自選股，已幫你選中`, "exists");
          render();
          scrollCardIntoView(code);
          hydrateQuote(code);
          return true;
        }
        if (rows.length >= WATCHLIST_MAX_ITEMS) {
          showStatus(`已達 ${WATCHLIST_MAX_ITEMS} 檔上限，請先移除一檔再新增。`, "warn");
          updateLimitState(rows);
          return false;
        }
        rows = writeRows([...rows, { ...fallbackRow(code), ...meta, source, addedAt: Date.now() }]);
        showStatus(`${code} ${meta.name} 已新增到下方清單`, "added");
      } finally {
        pendingAddCodes.delete(code);
      }
    } else {
      showStatus(`${code} 已在自選股，已幫你選中`, "exists");
    }
    selectedCode = code;
    render();
    scrollCardIntoView(code);
    hydrateMeta(code);
    hydrateQuote(code);
    return true;
  }

  async function addFromInput(anchor) {
    const input = anchor?.matches?.("#watchlist-search-input") ? anchor : document.querySelector("#watchlist-search-input");
    const ok = await addCode(input?.value || "", "input");
    if (ok && input && !input.disabled) {
      input.value = "";
      input.focus?.();
    }
    return ok;
  }

  function removeCode(value) {
    const code = normalizeCode(value);
    const rows = writeRows(readRows().filter((row) => row.code !== code));
    if (selectedCode === code) selectedCode = rows[0]?.code || "";
    showStatus(code ? `${code} 已移除` : "", "info");
    render();
    return true;
  }

  function ensureCode(code, seed = {}) {
    const target = normalizeCode(code);
    if (!target) return false;
    const rows = readRows();
    if (!rows.some((row) => row.code === target)) {
      if (rows.length >= WATCHLIST_MAX_ITEMS) {
        showStatus(`已達 ${WATCHLIST_MAX_ITEMS} 檔上限，請先移除一檔再新增。`, "warn");
        return false;
      }
      const meta = normalizeMeta(seed) || findMetaSync(target);
      if (!isValidStockMeta(meta, target)) {
        resolveStockMeta(target).then((resolved) => {
          if (resolved) ensureCode(target, { ...seed, ...resolved, code: target });
          else showStatus(`${target} 不是有效上市/上櫃台股代號，請確認後再新增。`, "warn");
        }).catch(() => showStatus(`${target} 不是有效上市/上櫃台股代號，請確認後再新增。`, "warn"));
        return false;
      }
      writeRows([...rows, { ...fallbackRow(target), ...seed, ...meta, code: target }]);
    }
    selectedCode = target;
    render();
    scrollCardIntoView(target);
    return Boolean(document.querySelector(`.watchlist-card[data-code="${target}"]`));
  }

  function selectCode(code) {
    selectedCode = normalizeCode(code) || selectedCode;
    render();
    hydrateQuote(selectedCode);
  }

  function refreshSelected() {
    const rows = readRows();
    rows.forEach((row) => {
      hydrateMeta(row.code);
      hydrateQuote(row.code);
    });
    render();
  }

  function render() {
    ensureSkeleton();
    const rows = readRows().map(mergeQuote);
    if (!selectedCode || !rows.some((row) => row.code === selectedCode)) selectedCode = rows[0]?.code || "";
    const count = document.querySelector("#watchlist-count");
    if (count) count.textContent = `${rows.length}/${WATCHLIST_MAX_ITEMS}`;
    const refresh = document.querySelector("#watchlist-refresh");
    if (refresh) {
      const now = new Date();
      refresh.textContent = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} 最新收盤 ｜ 更新 ${now.toLocaleTimeString("zh-TW", { hour12: false })}`;
    }
    updateLimitState(rows);
    const list = document.querySelector("#watchlist-stocks");
    if (list) {
      list.innerHTML = rows.length ? rows.map(cardHtml).join("") : '<div class="watch-mobile-empty">尚未新增自選股，請輸入股票代號後點新增</div>';
    }
    const active = rows.find((row) => row.code === selectedCode) || rows[0];
    renderAnalysis(active);
    rows.slice(0, 10).forEach((row) => {
      if (!metaHydratedCodes.has(row.code) && !metaHydratingCodes.has(row.code)) hydrateMeta(row.code);
    });
  }

  function scrollCardIntoView(code) {
    const target = normalizeCode(code);
    if (!target) return;
    requestAnimationFrame(() => {
      document.querySelector(`.watchlist-card[data-code="${target}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    });
  }

  function cardHtml(row) {
    const pct = number(row.percent);
    const up = pct >= 0;
    return `
      <article class="watchlist-card ${row.code === selectedCode ? "selected" : ""}" data-code="${escapeText(row.code)}" data-name="${escapeText(row.name || row.code)}">
        <div class="watch-card-main">
          <div class="watch-card-title">
            <span class="watch-code">${escapeText(row.code)}</span>
            <span class="watch-name">${escapeText(row.name || row.code)}</span>
            <span class="watch-market-badge">${escapeText(marketLabel(row.market))}</span>
          </div>
          <div class="watch-card-flow">
            <span>外 ${escapeText(row.foreignText || "--")}</span>
            <span>投 ${escapeText(row.trustText || "--")}</span>
          </div>
        </div>
        <div class="watch-card-price">
          <strong>${formatPrice(row.close)}</strong>
          <small class="${up ? "watch-up" : "watch-down"}">${formatPct(pct)}</small>
        </div>
        <button class="watch-alert" type="button" aria-label="提醒 ${escapeText(row.code)}">♧</button>
        <button class="watch-remove" type="button" data-watch-remove="${escapeText(row.code)}" aria-label="移除 ${escapeText(row.code)}">×</button>
      </article>
    `;
  }

  function featureStatusHtml() {
    return FEATURE_STATUS.map(([name, status]) => `<span class="watch-feature-pill"><b>${escapeText(name)}</b><em>${escapeText(status)}</em></span>`).join("");
  }

  function renderAnalysis(row) {
    const panel = document.querySelector("#watchlist-analysis");
    if (!panel) return;
    if (!row) {
      panel.innerHTML = `<div class="watch-mobile-empty"><p>點選股票查看 AI 個股判讀</p></div>`;
      return;
    }
    const close = number(row.close);
    const pct = number(row.percent);
    const prev = close && pct !== -100 ? close / (1 + pct / 100) : number(row.prevClose);
    const support = close ? close * 0.997 : 0;
    const pressure1 = close ? close * 1.012 : 0;
    const pressure2 = close ? close * 1.026 : 0;
    const pressure3 = close ? close * 1.04 : 0;
    const trend = pct >= 3 ? "強勢整理" : pct >= 0 ? "偏多整理" : "弱勢整理";
    const action = pct >= 3 ? "等待拉回" : "等待轉強";
    const score = Math.max(0, Math.min(100, Math.round(50 + pct * 8)));
    const matchSummary = strategyMatchSummary(row, score, pct);
    ensureMatchIndexForAnalysis(row.code);
    panel.innerHTML = `
      <div class="watch-analysis-panel ta-dashboard blackbean-stock-detail">
        <section class="watch-summary-grid">
          <article class="watch-metric"><span>標的</span><strong>${escapeText(row.code)} ${escapeText(row.name || row.code)}</strong></article>
          <article class="watch-metric"><span>趨勢判讀</span><strong>${trend}</strong></article>
          <article class="watch-metric"><span>漲跌幅</span><strong class="${pct >= 0 ? "watch-up" : "watch-down"}">${formatPct(pct)}</strong><em>前收 ${formatPrice(prev)} → 現價 ${formatPrice(close)}</em></article>
          <article class="watch-metric watch-match-metric"><span>符合策略</span><strong>${matchSummary.labels.length ? matchSummary.labels.map((label) => `<b>${escapeText(label)}</b>`).join("") : "無"}</strong><em>${escapeText(matchSummary.detail)}</em></article>
        </section>
        <section class="watch-detail-sections">
          <article class="watch-detail-section-card trend"><span>趨勢</span><strong>${trend}</strong><b>${formatPct(pct)}</b><em>收盤位於日內區間參考。</em></article>
          <article class="watch-detail-section-card price"><span>價位</span><strong>現價 ${formatPrice(close)}</strong><b>${formatPrice(support)} / ${formatPrice(pressure1)}</b><em>支撐觀察：${formatPrice(support)}；壓力觀察：${formatPrice(pressure1)}、${formatPrice(pressure2)}、${formatPrice(pressure3)}。</em></article>
          <article class="watch-detail-section-card chip"><span>籌碼</span><strong>籌碼待確認</strong><b>籌碼 ${Math.max(0, score - 37)} / 主力 ${Math.max(0, score - 41)}</b><em>法人 10 日淨買賣需搭配盤後資料確認。</em></article>
          <article class="watch-detail-section-card risk"><span>風險</span><strong>風險可控</strong><b>0 則</b><em>目前沒有明顯短線風險旗標，仍需搭配大盤與成交量確認。</em></article>
          <article class="watch-detail-section-card action"><span>操作提醒</span><strong>${action}</strong><b>支撐 ${formatPrice(support)}</b><em>先等待量價或籌碼轉強，再把它放進主觀察清單。</em></article>
        </section>
        <section class="watch-note-row">
          <article><b>1</b><small>${escapeText(row.code)} ${escapeText(row.name || row.code)}：${trend}，漲跌幅 ${formatPct(pct)}。</small></article>
          <article><b>2</b><small>支撐觀察：${formatPrice(support)}；壓力觀察：${formatPrice(pressure1)}、${formatPrice(pressure2)}、${formatPrice(pressure3)}。</small></article>
        </section>
      </div>
    `;
  }

  async function hydrateMeta(code) {
    const target = normalizeCode(code);
    if (!target) return null;
    if (metaHydratedCodes.has(target) || metaHydratingCodes.has(target)) return metaMap.get(target) || null;
    metaHydratingCodes.add(target);
    try {
      await loadMeta();
      const meta = metaMap.get(target);
      metaHydratedCodes.add(target);
      if (!meta) return null;
      let changed = false;
      const rows = readRows().map((row) => {
        if (row.code !== target) return row;
        changed = changed || metaChanged(row, meta);
        return changed ? { ...row, ...meta, code: target } : row;
      });
      if (changed) {
        writeRows(rows);
        render();
      }
      return meta;
    } finally {
      metaHydratingCodes.delete(target);
    }
  }

  async function hydrateQuote(code) {
    const target = normalizeCode(code);
    if (!target) return null;
    const cached = quoteMap.get(target);
    if (cached && Date.now() - number(cached.quoteAt) < 30000) return cached;
    try {
      const response = await fetch(`/api/proxy?code=${encodeURIComponent(target)}&t=${Date.now()}`, { cache: "no-store" });
      const data = await response.json();
      const item = data?.msgArray?.[0] || {};
      const close = parsePrice(item.z, item.pz, item.a, item.b, item.o);
      const prev = parsePrice(item.y, item.o, item.z);
      const quote = {
        code: target,
        name: item.n || findMetaSync(target)?.name || target,
        market: findMetaSync(target)?.market || "",
        close,
        prevClose: prev,
        change: close && prev ? close - prev : 0,
        percent: prev ? ((close - prev) / prev) * 100 : 0,
        quoteAt: Date.now(),
      };
      quoteMap.set(target, quote);
      const rows = readRows().map((row) => row.code === target ? { ...row, name: quote.name || row.name, market: quote.market || row.market } : row);
      writeRows(rows);
      render();
      return quote;
    } catch {
      return null;
    }
  }

  function parsePrice(...values) {
    for (const value of values) {
      const text = String(value ?? "").split("_").find(Boolean) || "";
      const parsed = number(text);
      if (parsed > 0) return parsed;
    }
    return 0;
  }

  function installStyle() {
    if (document.querySelector("#fuman-watchlist-rich-shell-style")) return;
    const style = document.createElement("style");
    style.id = "fuman-watchlist-rich-shell-style";
    style.textContent = `
      #watchlist-view.watchlist-view-rich { padding: 20px; }
      #watchlist-view .watchlist-rich-header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:22px; }
      #watchlist-view .watchlist-rich-header h1 { margin:0; color:#f7f7f8; font-size:24px; font-weight:950; }
      #watchlist-view .watchlist-refresh-line { margin:6px 0 0; color:#36a9ff; font-size:12px; font-weight:800; }
      #watchlist-view .watchlist-rich-shell { border:1px solid rgba(226,178,87,.28); border-radius:8px; background:linear-gradient(115deg,rgba(32,17,17,.92),rgba(8,22,39,.96)); overflow:hidden; }
      #watchlist-view .watchlist-rich-shell-head { padding:18px 20px; border-bottom:1px solid rgba(226,178,87,.18); }
      #watchlist-view .watchlist-rich-shell-head h2 { margin:0 0 8px; color:#f7f7f8; font-size:18px; }
      #watchlist-view .watchlist-rich-shell-head p, #watchlist-view .watchlist-list-card p { margin:0; color:#91a0bb; font-size:13px; }
      #watchlist-view .watchlist-layout { display:grid; grid-template-columns:396px minmax(0,1fr); gap:16px; padding:16px 18px 18px; min-height:620px; background:rgba(6,13,22,.55); }
      #watchlist-view .watchlist-list-card { border:1px solid rgba(226,178,87,.35); border-radius:8px; padding:14px; background:rgba(10,20,30,.78); }
      #watchlist-view .watchlist-list-title { display:flex; align-items:center; justify-content:space-between; margin-bottom:4px; }
      #watchlist-view .watchlist-list-title h3 { margin:0; color:#f7f7f8; font-size:16px; }
      #watchlist-view #watchlist-count { display:inline-flex; align-items:center; justify-content:center; min-width:32px; height:20px; border-radius:999px; background:rgba(239,83,41,.18); color:#f6b56a; font-size:13px; font-weight:950; }
      #watchlist-view .watchlist-entry-form { display:grid; grid-template-columns:minmax(0,1fr)52px; gap:10px; margin:14px 0; }
      #watchlist-view .watchlist-entry-input { height:54px; border:1px solid rgba(119,146,184,.36); border-radius:8px; background:rgba(8,19,31,.92); color:#eef6ff; padding:0 14px; font-size:16px; font-weight:900; }
      #watchlist-view .watchlist-entry-input:focus { border-color:#f27a1f; box-shadow:0 0 0 1px rgba(242,122,31,.6); outline:0; }
      #watchlist-view .watchlist-entry-add { width:52px; height:54px; border:0; border-radius:9px; background:linear-gradient(135deg,#f1b544,#f39a2f); color:#6d4212; font-size:28px; font-weight:950; cursor:pointer; }
      #watchlist-view .watchlist-entry-input:disabled, #watchlist-view .watchlist-entry-add:disabled { opacity:.55; cursor:not-allowed; }
      #watchlist-view .watchlist-entry-status { min-height:18px; margin:-6px 0 10px; color:#92a3bb; font-size:12px; font-weight:900; }
      #watchlist-view .watchlist-entry-status[data-status-kind="added"] { color:#24e58c; }
      #watchlist-view .watchlist-entry-status[data-status-kind="exists"] { color:#f7c767; }
      #watchlist-view .watchlist-entry-status[data-status-kind="warn"] { color:#ff815f; }
      #watchlist-view .watchlist-stock-list { display:grid; gap:8px; max-height:560px; overflow:auto; padding-right:4px; }
      #watchlist-view .watchlist-card { position:relative; display:grid; grid-template-columns:minmax(0,1fr)96px 22px 18px; align-items:center; gap:8px; border:1px solid rgba(226,178,87,.28); border-radius:8px; background:rgba(15,26,36,.92); color:#eaf1ff; padding:12px; cursor:pointer; }
      #watchlist-view .watchlist-card.selected { border-color:#ef6a23; box-shadow:inset 0 0 0 1px rgba(239,106,35,.4); }
      #watchlist-view .watch-card-title { display:flex; align-items:center; gap:7px; margin-bottom:8px; min-width:0; }
      #watchlist-view .watch-code { font-weight:950; color:#fff; font-size:15px; }
      #watchlist-view .watch-name { color:#96a6c0; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      #watchlist-view .watch-market-badge { border:1px solid rgba(239,106,35,.35); border-radius:4px; color:#ff8f4c; background:rgba(239,106,35,.12); padding:1px 5px; font-size:11px; font-weight:900; white-space:nowrap; }
      #watchlist-view .watch-card-flow { display:flex; gap:10px; color:#7ce9b4; font-size:12px; font-weight:900; }
      #watchlist-view .watch-card-price { text-align:right; }
      #watchlist-view .watch-card-price strong { display:block; color:#1ee887; font-size:17px; }
      #watchlist-view .watch-card-price small, #watchlist-view .watch-down { color:#21e390; }
      #watchlist-view .watch-up { color:#ff4f5f; }
      #watchlist-view .watch-alert, #watchlist-view .watch-remove { border:0; background:transparent; color:#b7a27d; cursor:pointer; font-size:18px; }
      #watchlist-view .watch-summary-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:18px; margin-bottom:18px; }
      #watchlist-view .watch-metric, #watchlist-view .watch-detail-section-card, #watchlist-view .watch-note-row article { border:1px solid rgba(226,178,87,.28); border-radius:8px; background:rgba(11,22,34,.92); padding:18px; }
      #watchlist-view .watch-metric span, #watchlist-view .watch-detail-section-card span { display:block; color:#9aa8bd; font-size:12px; margin-bottom:10px; }
      #watchlist-view .watch-metric strong { display:block; color:#f7f7f8; font-size:25px; line-height:1.1; }
      #watchlist-view .watch-match-metric strong { display:flex; flex-wrap:wrap; gap:6px; align-items:center; font-size:14px; line-height:1.25; }
      #watchlist-view .watch-match-metric strong b { display:inline-flex; align-items:center; min-height:24px; border:1px solid rgba(48,211,162,.35); border-radius:999px; padding:3px 8px; background:rgba(48,211,162,.12); color:#e8fff7; font-size:12px; line-height:1.2; white-space:normal; }
      #watchlist-view .watch-metric em, #watchlist-view .watch-detail-section-card em { display:block; margin-top:8px; color:#91a0bb; font-size:12px; line-height:1.6; font-style:normal; }
      #watchlist-view .watch-detail-sections { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:14px; margin-bottom:18px; }
      #watchlist-view .watch-detail-section-card { min-height:160px; border-top:4px solid #f24b62; }
      #watchlist-view .watch-detail-section-card.price { border-top-color:#727888; }
      #watchlist-view .watch-detail-section-card.chip { border-top-color:#d6a537; }
      #watchlist-view .watch-detail-section-card strong { display:block; color:#f7f7f8; font-size:25px; line-height:1.15; }
      #watchlist-view .watch-detail-section-card b { display:block; margin-top:12px; color:#ffc64a; font-size:14px; }
      #watchlist-view .watch-note-row { display:grid; gap:10px; margin-bottom:16px; }
      #watchlist-view .watch-note-row article { display:flex; align-items:center; gap:14px; padding:12px 14px; }
      #watchlist-view .watch-note-row b { display:inline-grid; place-items:center; width:28px; height:28px; border-radius:9px; background:rgba(239,106,35,.16); color:#f5a64d; }
      #watchlist-view .watch-note-row small { color:#b6c3d7; font-size:13px; }
      #watchlist-view .ta-timeframes { display:flex; gap:8px; }
      #watchlist-view .ta-timeframe { border:1px solid rgba(226,178,87,.35); border-radius:999px; background:rgba(9,18,29,.92); color:#ffd456; padding:8px 14px; font-weight:900; }
      #watchlist-view .watch-mobile-empty { display:grid; place-items:center; min-height:220px; color:#91a0bb; font-weight:900; text-align:center; }
      @media (max-width: 980px) {
        #watchlist-view .watchlist-layout { grid-template-columns:1fr; }
        #watchlist-view .watch-summary-grid, #watchlist-view .watch-detail-sections { grid-template-columns:1fr; }
      }
    `;
    document.head.appendChild(style);
  }

  function clickAddFromEvent(event) {
    install();
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    return addFromInput(document.querySelector("#watchlist-add-btn")) ? false : false;
  }

  function enterAddFromEvent(event) {
    if (event?.key && event.key !== "Enter") return true;
    install();
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    return addFromInput(document.querySelector("#watchlist-search-input")) ? false : false;
  }

  function install() {
    if (installed) return window.FUMAN_WATCHLIST_SHELL_INSTANCE;
    installed = true;
    installStyle();
    const instance = {
      version: VERSION,
      mode: "watchlist-redesign",
      render,
      addFromInput,
      addCode,
      forceAddCode: addCode,
      ensureCode,
      removeCode,
      removeFromWatchlist: removeCode,
      selectCode,
      refreshSelected,
      enrichStockMeta: hydrateMeta,
      validateTaiwanStockCode: resolveStockMeta,
    };
    window.FUMAN_WATCHLIST_SHELL_INSTANCE = instance;
    document.documentElement.dataset.fumanWatchlistModule = instance.mode;
    ensureSkeleton();
    render();
    validateStoredRows().catch(() => {});
    return instance;
  }

  window.FUMAN_WATCHLIST_SHELL_MODULE = { version: VERSION, install };
  window.FUMAN_WATCHLIST_VALIDATE_CODE = (code) => resolveStockMeta(code);
  window.FUMAN_WATCHLIST_FORCE_ADD_CODE = (code) => {
    install();
    return addCode(code, "force");
  };
  window.FUMAN_WATCHLIST_CLICK_ADD = clickAddFromEvent;
  window.FUMAN_WATCHLIST_ENTER_ADD = enterAddFromEvent;
  window.FUMAN_WATCHLIST_SHELL_FORCE_ADD = () => {
    install();
    return addFromInput(document.querySelector("#watchlist-search-input"));
  };
  window.FUMAN_WATCHLIST_FORCE_ADD = window.FUMAN_WATCHLIST_SHELL_FORCE_ADD;
  window.FUMAN_WATCHLIST_DEBUG_STATE = () => ({
    version: VERSION,
    selectedCode,
    storage: readRows().map((row) => row.code),
    input: document.querySelector("#watchlist-search-input")?.value || "",
    status: document.querySelector("#watchlist-entry-status")?.textContent || "",
    cards: [...document.querySelectorAll(".watchlist-card[data-code]")].map((el) => el.dataset.code),
    ready: Boolean(document.querySelector("#watchlist-stocks") && document.querySelector("#watchlist-analysis")),
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => install(), { once: true });
  } else {
    install();
  }
  window.FUMAN_TERMINAL_MODULES?.markLoaded?.("watchlist");
})();
