(function () {
  if (window.__fumanDesktopFastShell === "20260623-09") return;
  window.__fumanDesktopFastShell = "20260623-09";

  const NAV_SELECTOR = "[data-view]:not([data-member-tab])";
  const SNAPSHOT_DB = "fuman-desktop-route-snapshots";
  const SNAPSHOT_STORE = "snapshots";
  const SNAPSHOT_PREFIX = "FUMAN_DESKTOP_ROUTE_SNAPSHOT:";
  const SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
  const SNAPSHOT_MAX_CHARS = 850000;
  const SNAPSHOT_ROUTES = ["strategy|策略1", "strategy|策略2", "strategy|策略3", "strategy|策略4", "strategy|策略5"];
  const CANVAS_REFRESH_TTL_MS = 8000;
  const CANVAS_ROW_HEIGHT = 46;
  const CANVAS_HEADER_HEIGHT = 128;
  const CANVAS_ENDPOINTS = {
    "strategy|策略1": "/api/open-buy-latest",
    "strategy|策略2": "/api/strategy2-latest",
    "strategy|策略3": "/api/strategy3-latest",
    "strategy|策略4": "/api/strategy4-latest",
    "strategy|策略5": "/api/strategy5-latest",
  };
  const CANVAS_WORKER_URL = "/terminal-desktop-canvas-worker.js";
  let pendingTimer = 0;
  let snapshotTimer = 0;
  let snapshotDbPromise = null;
  let canvasFrame = 0;
  let canvasRowsVersion = 0;
  let canvasWorker = null;
  let canvasWorkerReady = false;
  let canvasWorkerFailed = false;
  let canvasWorkerMode = "main-canvas";
  let canvasWorkerRowsVersion = -1;
  let canvasWorkerRoute = "";
  let canvasWorkerAttachedCanvas = null;
  let lastRoute = "";
  let lastAt = 0;
  let fastClickRoute = "";
  let fastClickAt = 0;
  let activeSnapshotRoute = "";
  const routeSnapshots = new Map();
  const canvasStore = new Map();
  const canvasInflight = new Map();
  const canvasState = {
    route: "",
    source: "",
    query: "",
    offset: 0,
    hoverIndex: -1,
    selectedIndex: -1,
    rows: [],
    filtered: [],
  };

  installStyle();
  installRouteSnapshots();
  installCanvasHandlers();
  installRouteFeedback();

  function routeKey(link) {
    return `${link?.dataset?.view || ""}|${(link?.textContent || "").replace(/\s+/g, " ").trim()}`;
  }

  function isPrimaryPointer(event) {
    return !event.button && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  }

  function warm(link, source) {
    if (!link) return;
    window.FUMAN_TERMINAL_LOAD_APP?.(`desktop-fast-shell-${source}`);
    window.FUMAN_HOTFIX_WARM_ROUTE?.(link, `desktop-fast-shell-${source}`);
  }

  function isStrategyLink(link) {
    return link?.dataset?.view === "strategy";
  }

  function strategyRouteKey(link) {
    const text = (typeof link === "string" ? link : link?.textContent || "").replace(/\s+/g, " ").trim();
    if (typeof link !== "string" && !isStrategyLink(link)) return "";
    if (text.includes("策略1")) return "strategy|策略1";
    if (text.includes("策略2")) return "strategy|策略2";
    if (text.includes("策略3")) return "strategy|策略3";
    if (text.includes("策略4")) return "strategy|策略4";
    if (text.includes("策略5")) return "strategy|策略5";
    return "strategy|unknown";
  }

  function strategyMeta(linkOrKey) {
    const text = typeof linkOrKey === "string"
      ? linkOrKey
      : (linkOrKey?.textContent || "").replace(/\s+/g, " ").trim();
    if (text.includes("策略1")) {
      return {
        icon: "⚡",
        title: "策略1-明日開盤入",
        badge: "FMN://strategy.open-buy",
        summary: "21:30 產生明日候選，08:55 最終確認，09:00 只執行 BUY 名單。",
      };
    }
    if (text.includes("策略2")) {
      return {
        icon: "◔",
        title: "策略2-當沖雷達",
        badge: "FMN://strategy.intraday",
        summary: "08:45-13:30 即時偵測，先切畫面，資料背景刷新。",
      };
    }
    if (text.includes("策略3")) {
      return {
        icon: "◐",
        title: "策略3-隔日沖",
        badge: "FMN://strategy.overnight",
        summary: "盤後籌碼與量價候選，先顯示快照，再同步最新資料。",
      };
    }
    if (text.includes("策略4")) {
      return {
        icon: "└",
        title: "策略4-波段",
        badge: "FMN://strategy.swing",
        summary: "波段區間與訊號分層，切頁不等待資料整理完成。",
      };
    }
    if (text.includes("策略5")) {
      return {
        icon: "▰",
        title: "策略5-綜合策略",
        badge: "FMN://strategy.composite",
        summary: "策略5 多分頁結果，固定殼先顯示，完整內容背景補齊。",
      };
    }
    return {
      icon: "◆",
      title: "策略模組",
      badge: "FMN://strategy.api",
      summary: "正在切換策略畫面。",
    };
  }

  function compactText(value, limit = 96) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  }

  function extractLiteRows(panel) {
    if (!panel) return [];
    const selectors = [
      ".strategy5-stock-card",
      ".swing-card",
      ".terminal-table tbody tr",
      ".strategy-table tbody tr",
      ".strategy-table tr",
      "[data-stock-code]",
      "article",
    ];
    const seen = new Set();
    const rows = [];
    for (const selector of selectors) {
      panel.querySelectorAll(selector).forEach((node) => {
        if (rows.length >= 90 || seen.has(node)) return;
        seen.add(node);
        const text = compactText(node.textContent, 120);
        if (!text || /正在|loading|背景更新|切換狀態|資料狀態|手感模式/i.test(text)) return;
        const code = node.dataset?.stockCode || text.match(/\b\d{4}\b/)?.[0] || "";
        if (!code && text.length < 8) return;
        const pct = text.match(/[+-]?\d+(?:\.\d+)?%/)?.[0] || "";
        const score = text.match(/(?:分數|score|命中|訊號)\s*[:：]?\s*([+-]?\d+(?:\.\d+)?)/i)?.[1] || "";
        const title = code ? compactText(text.replace(code, "").trim(), 54) : compactText(text, 54);
        rows.push({
          rank: rows.length + 1,
          code,
          title: title || code || `訊號 ${rows.length + 1}`,
          pct,
          score,
          line: text,
        });
      });
      if (rows.length >= 12) break;
    }
    return rows.slice(0, 90);
  }

  function cleanNumber(value) {
    const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
    return Number.isFinite(number) ? number : 0;
  }

  function endpointForRoute(route) {
    return CANVAS_ENDPOINTS[route] || "";
  }

  function flattenApiArrays(payload, depth = 0, out = []) {
    if (!payload || depth > 3 || out.length > 12) return out;
    if (Array.isArray(payload)) {
      if (payload.some((item) => item && typeof item === "object")) out.push(payload);
      return out;
    }
    if (typeof payload !== "object") return out;
    ["matches", "events", "records", "rows", "signals", "items", "results", "stocks", "data"].forEach((key) => {
      const value = payload[key];
      if (Array.isArray(value) && value.some((item) => item && typeof item === "object")) out.push(value);
    });
    Object.keys(payload).slice(0, 18).forEach((key) => {
      const value = payload[key];
      if (value && typeof value === "object" && !Array.isArray(value)) flattenApiArrays(value, depth + 1, out);
    });
    return out;
  }

  function normalizeCanvasRow(row, index) {
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    const active = row?.activeMatch || payload.activeMatch || (Array.isArray(row?.matches) ? row.matches[0] : null) || (Array.isArray(payload.matches) ? payload.matches[0] : null) || {};
    const merged = { ...payload, ...row };
    const rawCode = merged.code || merged.stockNo || merged.stock_no || merged.symbol || merged.ticker || merged.stockId || merged.stock_id || "";
    const code = String(rawCode).match(/\d{4}/)?.[0] || String(rawCode || "").trim();
    const name = String(merged.name || merged.stockName || merged.stock_name || merged.companyName || merged.company_name || code || "").trim();
    const pct = merged.percent ?? merged.changePercent ?? merged.change_percent ?? merged.change ?? merged.pct ?? "";
    const score = merged.score ?? merged.rankScore ?? merged.swingScore ?? active.score ?? merged.signalScore ?? "";
    const reason = String(merged.reason || active.reason || merged.message || merged.note || "").trim();
    const state = String(merged.state || merged.status || active.name || active.id || "").trim();
    const price = merged.price ?? merged.close ?? merged.lastPrice ?? merged.entryPrice ?? "";
    const volume = merged.volume ?? merged.tradeVolume ?? merged.volumeLots ?? merged.trade_volume ?? "";
    const line = compactText([
      code,
      name,
      state,
      reason,
      price !== "" ? `價 ${price}` : "",
      volume !== "" ? `量 ${volume}` : "",
    ].filter(Boolean).join(" ｜ "), 160);
    return {
      rank: cleanNumber(merged.rank) || index + 1,
      code,
      title: compactText(name || reason || state || code || `訊號 ${index + 1}`, 64),
      pct: pct === "" || pct == null ? "" : String(pct).includes("%") ? String(pct) : `${cleanNumber(pct).toFixed(2)}%`,
      score: score === "" || score == null ? "" : String(Math.round(cleanNumber(score) * 100) / 100),
      reason: compactText(reason || state || line, 180),
      price: price === "" || price == null ? "" : String(price),
      volume: volume === "" || volume == null ? "" : String(volume),
      line,
    };
  }

  function normalizeCanvasRowsFromPayload(payload) {
    const arrays = flattenApiArrays(payload);
    const best = arrays
      .map((rows) => rows.map(normalizeCanvasRow).filter((row) => row.code || row.title))
      .sort((a, b) => b.length - a.length)[0] || [];
    return best
      .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || cleanNumber(b.score) - cleanNumber(a.score) || String(a.code).localeCompare(String(b.code), "zh-Hant"))
      .slice(0, 200);
  }

  function setCanvasRows(route, rows, source = "memory", at = Date.now()) {
    const cleanRows = (Array.isArray(rows) ? rows : []).filter((row) => row && (row.code || row.title || row.line));
    if (!route || !cleanRows.length) return false;
    canvasStore.set(route, { rows: cleanRows, source, at });
    if (canvasState.route === route) {
      canvasState.rows = cleanRows;
      canvasState.source = source;
      applyCanvasFilter();
      scheduleCanvasDraw();
    }
    return true;
  }

  function rowsForRoute(route) {
    const memory = canvasStore.get(route);
    if (memory?.rows?.length) return memory.rows;
    const snapshot = routeSnapshots.get(route);
    if (snapshot?.rows?.length) {
      setCanvasRows(route, snapshot.rows, "snapshot", snapshot.at || Date.now());
      return snapshot.rows;
    }
    return [];
  }

  function applyCanvasFilter() {
    const query = compactText(canvasState.query, 80).toLowerCase();
    canvasState.filtered = query
      ? canvasState.rows.filter((row) => [row.code, row.title, row.reason, row.line].join(" ").toLowerCase().includes(query))
      : canvasState.rows.slice();
    const maxOffset = Math.max(0, canvasState.filtered.length - 1);
    canvasState.offset = Math.max(0, Math.min(canvasState.offset, maxOffset));
    canvasRowsVersion += 1;
  }

  function fetchCanvasRows(route, force = false) {
    const endpoint = endpointForRoute(route);
    if (!endpoint) return Promise.resolve([]);
    const cached = canvasStore.get(route);
    if (!force && cached?.rows?.length && Date.now() - Number(cached.at || 0) < CANVAS_REFRESH_TTL_MS) {
      return Promise.resolve(cached.rows);
    }
    if (canvasInflight.has(route)) return canvasInflight.get(route);
    const url = `${endpoint}${endpoint.includes("?") ? "&" : "?"}canvas=1&t=${Date.now()}`;
    const task = fetch(url, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((payload) => {
        const rows = normalizeCanvasRowsFromPayload(payload);
        if (rows.length) {
          setCanvasRows(route, rows, "api", Date.now());
          routeSnapshots.set(route, { ...(routeSnapshots.get(route) || {}), at: Date.now(), rows });
          writeSessionSnapshot(route, { ...(routeSnapshots.get(route) || {}), at: Date.now(), rows, html: "" });
          writeIndexedSnapshot(route, { ...(routeSnapshots.get(route) || {}), at: Date.now(), rows, html: "" });
        }
        return rows;
      })
      .catch(() => rowsForRoute(route))
      .finally(() => canvasInflight.delete(route));
    canvasInflight.set(route, task);
    return task;
  }

  function currentCanvasShell() {
    return document.querySelector(".desktop-route-shell.desktop-canvas-app");
  }

  function visibleCanvasCapacity(canvas) {
    const rect = canvas?.getBoundingClientRect?.();
    const height = Math.max(360, Math.min(760, Math.floor(rect?.height || (window.innerHeight || 900) * 0.62)));
    return Math.max(5, Math.floor((height - CANVAS_HEADER_HEIGHT - 16) / CANVAS_ROW_HEIGHT));
  }

  function clampCanvasOffset(canvas) {
    const capacity = visibleCanvasCapacity(canvas);
    const maxOffset = Math.max(0, canvasState.filtered.length - capacity);
    canvasState.offset = Math.max(0, Math.min(canvasState.offset, maxOffset));
  }

  function setCanvasStatus(text) {
    const shell = currentCanvasShell();
    if (!shell) return;
    const status = shell.querySelector(".desktop-canvas-status");
    const count = shell.querySelector(".desktop-canvas-count");
    const visible = canvasState.filtered.length;
    const total = canvasState.rows.length;
    const source = canvasState.source ? String(canvasState.source).replace(/^canvas-/, "") : "shell";
    if (count) count.textContent = `${visible}/${total}`;
    const mode = canvasWorkerReady ? canvasWorkerMode : source;
    if (status) status.textContent = text || `${mode} · ${new Date().toLocaleTimeString("zh-TW", { hour12: false })}`;
  }

  function scheduleCanvasDraw() {
    window.cancelAnimationFrame(canvasFrame);
    canvasFrame = window.requestAnimationFrame(drawCurrentCanvas);
  }

  function drawCurrentCanvas() {
    const shell = currentCanvasShell();
    const canvas = shell?.querySelector(".desktop-route-canvas");
    if (!canvas) return;
    clampCanvasOffset(canvas);
    if (drawCanvasWithWorker(canvas)) {
      setCanvasStatus();
      return;
    }
    drawRouteCanvas(canvas, strategyMeta(canvasState.route || activeSnapshotRoute), canvasState.filtered, canvasState.source);
    setCanvasStatus();
  }

  function workerCanvasSupported() {
    return !canvasWorkerFailed &&
      "Worker" in window &&
      "OffscreenCanvas" in window &&
      typeof HTMLCanvasElement !== "undefined" &&
      typeof HTMLCanvasElement.prototype.transferControlToOffscreen === "function";
  }

  function getCanvasWorker() {
    if (!workerCanvasSupported()) return null;
    if (canvasWorker) return canvasWorker;
    try {
      const url = `${CANVAS_WORKER_URL}?runtime=${encodeURIComponent(window.__fumanDesktopFastShell || "20260623-09")}&t=${Date.now()}`;
      canvasWorker = new Worker(url);
      canvasWorker.onmessage = (event) => {
        const data = event.data || {};
        if (data.type === "ready") {
          canvasWorkerReady = !!data.ok;
          canvasWorkerMode = data.mode || "worker-offscreen";
          setCanvasStatus(canvasWorkerReady ? canvasWorkerMode : "Canvas fallback");
          scheduleCanvasDraw();
        } else if (data.type === "drawn") {
          canvasWorkerMode = data.mode || canvasWorkerMode;
        }
      };
      canvasWorker.onerror = () => {
        canvasWorkerFailed = true;
        canvasWorkerReady = false;
        canvasWorkerMode = "main-canvas";
        try {
          canvasWorker?.terminate?.();
        } catch (error) {}
        canvasWorker = null;
      };
      return canvasWorker;
    } catch (error) {
      canvasWorkerFailed = true;
      return null;
    }
  }

  function canvasDrawMetrics(canvas) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(520, Math.floor(rect.width || canvas.parentElement?.clientWidth || 920));
    const height = Math.max(380, Math.min(760, Math.floor((window.innerHeight || 900) * 0.68)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.style.height = `${height}px`;
    return { width, height, dpr };
  }

  function attachWorkerCanvas(canvas) {
    const worker = getCanvasWorker();
    if (!worker) return false;
    if (canvas.dataset.fumanWorkerCanvas === "1") return true;
    try {
      const offscreen = canvas.transferControlToOffscreen();
      canvas.dataset.fumanWorkerCanvas = "1";
      canvasWorkerAttachedCanvas = canvas;
      canvasWorkerRowsVersion = -1;
      worker.postMessage({ type: "attach", canvas: offscreen }, [offscreen]);
      return true;
    } catch (error) {
      canvasWorkerFailed = true;
      return false;
    }
  }

  function syncCanvasWorkerRows(worker) {
    if (!worker) return;
    if (canvasWorkerRowsVersion === canvasRowsVersion && canvasWorkerRoute === canvasState.route) return;
    canvasWorkerRowsVersion = canvasRowsVersion;
    canvasWorkerRoute = canvasState.route;
    worker.postMessage({
      type: "rows",
      route: canvasState.route,
      rows: canvasState.filtered,
    });
  }

  function drawCanvasWithWorker(canvas) {
    if (!workerCanvasSupported() || !attachWorkerCanvas(canvas)) return false;
    const worker = getCanvasWorker();
    if (!worker) return false;
    const metrics = canvasDrawMetrics(canvas);
    syncCanvasWorkerRows(worker);
    worker.postMessage({
      type: "draw",
      route: canvasState.route,
      meta: strategyMeta(canvasState.route || activeSnapshotRoute),
      source: canvasState.source,
      offset: canvasState.offset,
      hoverIndex: canvasState.hoverIndex,
      selectedIndex: canvasState.selectedIndex,
      width: metrics.width,
      height: metrics.height,
      dpr: metrics.dpr,
      rowHeight: CANVAS_ROW_HEIGHT,
      headerHeight: CANVAS_HEADER_HEIGHT,
    });
    return true;
  }

  function canvasHitIndex(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    const y = event.clientY - rect.top;
    if (y < CANVAS_HEADER_HEIGHT) return -1;
    const localIndex = Math.floor((y - CANVAS_HEADER_HEIGHT) / CANVAS_ROW_HEIGHT);
    const index = canvasState.offset + localIndex;
    return index >= 0 && index < canvasState.filtered.length ? index : -1;
  }

  function hideCanvasDetail() {
    const detail = currentCanvasShell()?.querySelector(".desktop-canvas-detail");
    if (detail) {
      detail.hidden = true;
      detail.innerHTML = "";
    }
  }

  function showCanvasDetail(row, index) {
    const detail = currentCanvasShell()?.querySelector(".desktop-canvas-detail");
    if (!detail || !row) return;
    detail.hidden = false;
    detail.innerHTML = `
      <div class="desktop-canvas-detail-panel">
        <button type="button" class="desktop-canvas-detail-close" data-canvas-detail-close aria-label="關閉">×</button>
        <div class="desktop-canvas-detail-kicker">#${escapeHtml(row.rank || index + 1)} · ${escapeHtml(canvasState.route.replace("strategy|", ""))}</div>
        <h3>${escapeHtml(row.code || "--")} ${escapeHtml(row.title || "")}</h3>
        <p>${escapeHtml(row.reason || row.line || "目前沒有更多說明。")}</p>
        <div class="desktop-canvas-detail-grid">
          <span>分數 <strong>${escapeHtml(row.score || "--")}</strong></span>
          <span>漲幅 <strong>${escapeHtml(row.pct || "--")}</strong></span>
          <span>價格 <strong>${escapeHtml(row.price || "--")}</strong></span>
          <span>量能 <strong>${escapeHtml(row.volume || "--")}</strong></span>
        </div>
      </div>
    `;
  }

  function installCanvasHandlers() {
    if (document.documentElement.dataset.fumanCanvasHandlersReady === "1") return;
    document.documentElement.dataset.fumanCanvasHandlersReady = "1";

    document.addEventListener("input", (event) => {
      const input = event.target.closest?.(".desktop-canvas-search");
      if (!input) return;
      canvasState.query = input.value || "";
      canvasState.offset = 0;
      canvasState.hoverIndex = -1;
      applyCanvasFilter();
      setCanvasStatus("搜尋套用");
      scheduleCanvasDraw();
    }, true);

    document.addEventListener("click", (event) => {
      const close = event.target.closest?.("[data-canvas-detail-close]");
      if (close) {
        event.preventDefault();
        hideCanvasDetail();
        return;
      }
      const refresh = event.target.closest?.("[data-canvas-refresh]");
      if (refresh) {
        event.preventDefault();
        const route = canvasState.route || activeSnapshotRoute;
        setCanvasStatus("更新中");
        fetchCanvasRows(route, true).then(() => {
          if (canvasState.route === route) {
            applyCanvasFilter();
            scheduleCanvasDraw();
          }
        }).catch(() => setCanvasStatus("沿用快照"));
        return;
      }
      const canvas = event.target.closest?.(".desktop-route-canvas");
      if (!canvas) return;
      const index = canvasHitIndex(canvas, event);
      if (index < 0) return;
      canvasState.selectedIndex = index;
      showCanvasDetail(canvasState.filtered[index], index);
      scheduleCanvasDraw();
      event.preventDefault();
    }, true);

    document.addEventListener("pointermove", (event) => {
      const canvas = event.target.closest?.(".desktop-route-canvas");
      if (!canvas) return;
      const index = canvasHitIndex(canvas, event);
      if (index === canvasState.hoverIndex) return;
      canvasState.hoverIndex = index;
      scheduleCanvasDraw();
    }, true);

    document.addEventListener("pointerout", (event) => {
      const canvas = event.target.closest?.(".desktop-route-canvas");
      if (!canvas || canvas.contains(event.relatedTarget)) return;
      if (canvasState.hoverIndex === -1) return;
      canvasState.hoverIndex = -1;
      scheduleCanvasDraw();
    }, true);

    document.addEventListener("wheel", (event) => {
      const canvas = event.target.closest?.(".desktop-route-canvas");
      if (!canvas) return;
      const direction = event.deltaY > 0 ? 1 : -1;
      const step = Math.max(1, Math.min(8, Math.round(Math.abs(event.deltaY) / 42)));
      const oldOffset = canvasState.offset;
      canvasState.offset += direction * step;
      clampCanvasOffset(canvas);
      if (canvasState.offset !== oldOffset) {
        event.preventDefault();
        hideCanvasDetail();
        scheduleCanvasDraw();
      }
    }, { capture: true, passive: false });

    document.addEventListener("keydown", (event) => {
      const canvas = event.target.closest?.(".desktop-route-canvas");
      if (!canvas) return;
      const capacity = visibleCanvasCapacity(canvas);
      const oldOffset = canvasState.offset;
      if (event.key === "ArrowDown") canvasState.offset += 1;
      else if (event.key === "ArrowUp") canvasState.offset -= 1;
      else if (event.key === "PageDown") canvasState.offset += capacity;
      else if (event.key === "PageUp") canvasState.offset -= capacity;
      else if (event.key === "Home") canvasState.offset = 0;
      else if (event.key === "End") canvasState.offset = canvasState.filtered.length;
      else if (event.key === "Enter" && canvasState.hoverIndex >= 0) {
        showCanvasDetail(canvasState.filtered[canvasState.hoverIndex], canvasState.hoverIndex);
        event.preventDefault();
        return;
      } else {
        return;
      }
      clampCanvasOffset(canvas);
      if (canvasState.offset !== oldOffset) {
        event.preventDefault();
        hideCanvasDetail();
        scheduleCanvasDraw();
      }
    }, true);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function activeStrategyRouteKey() {
    const active = document.querySelector('[data-view="strategy"].active');
    return strategyRouteKey(active) || activeSnapshotRoute;
  }

  function openSnapshotDb() {
    if (!("indexedDB" in window)) return Promise.resolve(null);
    if (snapshotDbPromise) return snapshotDbPromise;
    snapshotDbPromise = new Promise((resolve) => {
      const request = indexedDB.open(SNAPSHOT_DB, 1);
      request.onupgradeneeded = () => {
        try {
          request.result.createObjectStore(SNAPSHOT_STORE, { keyPath: "key" });
        } catch (error) {}
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return snapshotDbPromise;
  }

  function readSessionSnapshot(key) {
    try {
      const raw = sessionStorage.getItem(SNAPSHOT_PREFIX + key);
      if (!raw) return null;
      const item = JSON.parse(raw);
      if ((!item?.html && !item?.rows?.length) || Date.now() - Number(item.at || 0) > SNAPSHOT_MAX_AGE_MS) return null;
      return item;
    } catch (error) {
      return null;
    }
  }

  function writeSessionSnapshot(key, item) {
    try {
      sessionStorage.setItem(SNAPSHOT_PREFIX + key, JSON.stringify(item));
    } catch (error) {}
  }

  async function readIndexedSnapshot(key) {
    const db = await openSnapshotDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(SNAPSHOT_STORE, "readonly");
        const request = tx.objectStore(SNAPSHOT_STORE).get(key);
        request.onsuccess = () => {
          const item = request.result;
          const hasContent = item?.html || item?.rows?.length;
          resolve(hasContent && Date.now() - Number(item.at || 0) <= SNAPSHOT_MAX_AGE_MS ? item : null);
        };
        request.onerror = () => resolve(null);
      } catch (error) {
        resolve(null);
      }
    });
  }

  async function writeIndexedSnapshot(key, item) {
    const db = await openSnapshotDb();
    if (!db) return;
    try {
      const tx = db.transaction(SNAPSHOT_STORE, "readwrite");
      tx.objectStore(SNAPSHOT_STORE).put({ key, ...item });
    } catch (error) {}
  }

  function isWorthSavingSnapshot(panel) {
    const html = panel?.innerHTML || "";
    if (panel?.querySelector?.(".desktop-route-shell")) return false;
    if (!html || html.length > SNAPSHOT_MAX_CHARS) return false;
    const text = panel.textContent || "";
    if (/正在載入|loading/i.test(text) && html.length < 18000) return false;
    return html.length > 6000 ||
      /strategy5-shell|swing-dashboard|terminal-table|strategy-table|stock-card|<tr|<article/i.test(html);
  }

  function saveStrategySnapshotNow() {
    const panel = document.querySelector("#strategy-view");
    const key = activeStrategyRouteKey();
    if (!key || !panel?.classList?.contains("active") || !isWorthSavingSnapshot(panel)) return;
    const item = {
      at: Date.now(),
      scrollTop: panel.scrollTop || 0,
      html: panel.innerHTML,
      rows: extractLiteRows(panel),
    };
    routeSnapshots.set(key, item);
    if (item.rows.length) setCanvasRows(key, item.rows, "dom-snapshot", item.at);
    writeSessionSnapshot(key, item);
    writeIndexedSnapshot(key, item);
  }

  function scheduleStrategySnapshotSave() {
    window.clearTimeout(snapshotTimer);
    snapshotTimer = window.setTimeout(() => {
      if ("requestIdleCallback" in window) {
        requestIdleCallback(saveStrategySnapshotNow, { timeout: 600 });
      } else {
        saveStrategySnapshotNow();
      }
    }, 420);
  }

  function applySnapshot(key, item, source) {
    const panel = document.querySelector("#strategy-view");
    if (!key || (!item?.html && !item?.rows?.length) || !panel) return false;
    if (Date.now() - Number(item.at || 0) > SNAPSHOT_MAX_AGE_MS) return false;
    if (Array.isArray(item.rows) && item.rows.length) {
      setCanvasRows(key, item.rows, `canvas-${source}`, item.at || Date.now());
      renderStrategyRouteShell(key, `canvas-${source}`, item.rows);
      return true;
    }
    const template = document.createElement("template");
    template.innerHTML = item.html || "";
    const rows = extractLiteRows(template.content);
    if (rows.length) setCanvasRows(key, rows, `html-${source}`, item.at || Date.now());
    renderStrategyRouteShell(key, `html-${source}`, rows);
    return true;
  }

  function restoreStrategySnapshot(link) {
    const key = strategyRouteKey(link);
    if (!key) return false;
    activeSnapshotRoute = key;
    const memoryItem = routeSnapshots.get(key);
    if (applySnapshot(key, memoryItem, "memory")) return true;
    const sessionItem = readSessionSnapshot(key);
    if (sessionItem) {
      routeSnapshots.set(key, sessionItem);
      return applySnapshot(key, sessionItem, "session");
    }
    readIndexedSnapshot(key).then((item) => {
      if (!item || activeSnapshotRoute !== key) return;
      routeSnapshots.set(key, item);
      writeSessionSnapshot(key, item);
      applySnapshot(key, item, "indexeddb");
    }).catch(() => undefined);
    return false;
  }

  function drawRouteCanvas(canvas, meta, rows = [], source = "") {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(520, Math.floor(rect.width || canvas.parentElement?.clientWidth || 920));
    const height = Math.max(380, Math.min(760, Math.floor((window.innerHeight || 900) * 0.68)));
    const capacity = Math.max(5, Math.floor((height - CANVAS_HEADER_HEIGHT - 16) / CANVAS_ROW_HEIGHT));
    const rowsToDraw = rows.length ? rows.slice(canvasState.offset, canvasState.offset + capacity) : [];
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#090f1c";
    ctx.fillRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, "rgba(255,112,55,0.20)");
    gradient.addColorStop(0.55, "rgba(30,41,59,0.45)");
    gradient.addColorStop(1, "rgba(59,130,246,0.10)");
    ctx.fillStyle = gradient;
    roundRect(ctx, 0.5, 0.5, width - 1, height - 1, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,112,55,0.38)";
    ctx.lineWidth = 1;
    roundRect(ctx, 0.5, 0.5, width - 1, height - 1, 18);
    ctx.stroke();

    ctx.fillStyle = "#ff8a3d";
    ctx.font = "700 28px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(meta.icon, 28, 48);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "800 22px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(meta.title, 70, 42);
    ctx.fillStyle = "#9fb0cb";
    ctx.font = "14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(compactText(meta.summary, 84), 70, 68);
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffb27b";
    ctx.font = "800 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(`${rows.length} 筆`, width - 32, 42);
    ctx.fillStyle = "#9fb0cb";
    ctx.font = "12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(compactText(source || "shell", 28), width - 32, 66);
    ctx.textAlign = "left";

    ctx.fillStyle = "rgba(15,23,42,0.86)";
    roundRect(ctx, 24, 88, width - 48, 38, 12);
    ctx.fill();
    ctx.fillStyle = "#9fb0cb";
    ctx.font = "700 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText("Rank", 46, 112);
    ctx.fillText("Code", 106, 112);
    ctx.fillText("Signal", 184, 112);
    ctx.fillText("Score", width - 176, 112);
    ctx.fillText("Change", width - 92, 112);

    if (!rowsToDraw.length) {
      for (let i = 0; i < 5; i += 1) {
        const y = CANVAS_HEADER_HEIGHT + 18 + i * CANVAS_ROW_HEIGHT;
        const alpha = 0.16 - i * 0.014;
        ctx.fillStyle = `rgba(148,163,184,${alpha})`;
        roundRect(ctx, 42, y, width - 84 - i * 28, 18, 9);
        ctx.fill();
      }
      ctx.fillStyle = "#9fb0cb";
      ctx.font = "700 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(source.includes("canvas") ? "讀取快照中" : "已切換，背景同步資料", 44, height - 28);
      return;
    }

    rowsToDraw.forEach((row, index) => {
      const globalIndex = canvasState.offset + index;
      const y = CANVAS_HEADER_HEIGHT + index * CANVAS_ROW_HEIGHT + 28;
      const active = globalIndex === canvasState.selectedIndex;
      const hover = globalIndex === canvasState.hoverIndex;
      ctx.fillStyle = active
        ? "rgba(255,112,55,0.22)"
        : hover
          ? "rgba(255,112,55,0.13)"
          : index % 2
            ? "rgba(15,23,42,0.58)"
            : "rgba(30,41,59,0.46)";
      roundRect(ctx, 24, y - 29, width - 48, 42, 10);
      ctx.fill();
      if (active || hover) {
        ctx.strokeStyle = active ? "rgba(255,112,55,0.95)" : "rgba(255,112,55,0.42)";
        ctx.lineWidth = 1;
        roundRect(ctx, 24.5, y - 28.5, width - 49, 41, 10);
        ctx.stroke();
      }
      ctx.fillStyle = "#ff8a3d";
      ctx.font = "800 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(String(row.rank || index + 1), 48, y);
      ctx.fillStyle = "#9bc4ff";
      ctx.font = "800 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(row.code || "--", 106, y);
      ctx.fillStyle = "#e8eefc";
      ctx.font = "700 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(compactText(row.title || row.line || "", 42), 184, y - 6);
      ctx.fillStyle = "#8391aa";
      ctx.font = "12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(compactText(row.reason || row.line || "", 70), 184, y + 11);
      ctx.fillStyle = "#e8eefc";
      ctx.textAlign = "right";
      ctx.fillText(row.score || "--", width - 130, y);
      ctx.fillStyle = String(row.pct || "").includes("-") ? "#34d399" : "#fb7185";
      ctx.fillText(row.pct || "--", width - 38, y);
      ctx.textAlign = "left";
    });

    if (rows.length > capacity) {
      const trackTop = CANVAS_HEADER_HEIGHT;
      const trackHeight = height - CANVAS_HEADER_HEIGHT - 18;
      const thumbHeight = Math.max(34, trackHeight * (capacity / rows.length));
      const thumbTop = trackTop + (trackHeight - thumbHeight) * (canvasState.offset / Math.max(1, rows.length - capacity));
      ctx.fillStyle = "rgba(148,163,184,0.12)";
      roundRect(ctx, width - 14, trackTop, 5, trackHeight, 4);
      ctx.fill();
      ctx.fillStyle = "rgba(255,112,55,0.58)";
      roundRect(ctx, width - 14, thumbTop, 5, thumbHeight, 4);
      ctx.fill();
    }
  }

  function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function renderStrategyRouteShell(link, source, rows = []) {
    const panel = document.querySelector("#strategy-view");
    if (!panel) return false;
    const key = strategyRouteKey(link);
    const previousRoute = canvasState.route;
    const stored = canvasStore.get(key);
    const incomingRows = rows.length ? rows : rowsForRoute(key);
    activeSnapshotRoute = key;
    canvasState.route = key;
    canvasState.source = source || stored?.source || "shell";
    canvasState.rows = incomingRows;
    if (previousRoute !== key) {
      canvasState.offset = 0;
      canvasState.hoverIndex = -1;
      canvasState.selectedIndex = -1;
      hideCanvasDetail();
    }
    applyCanvasFilter();
    const meta = strategyMeta(link);
    panel.dataset.fumanRouteSnapshotRestoring = "1";
    panel.classList.remove("strategy5-only", "strategy3-only", "swing-only", "open-buy-only");
    const headerTitle = panel.querySelector(".strategy-header h1");
    const headerText = panel.querySelector(".strategy-header p");
    const headerBadge = panel.querySelector(".strategy-header .console-badge");
    const toolbarTitle = panel.querySelector(".strategy-toolbar h2");
    const toolbarBadge = panel.querySelector(".strategy-toolbar .console-badge");
    const summary = panel.querySelector("#strategy-summary");
    const count = panel.querySelector("#strategy-match-count");
    const avg = panel.querySelector("#strategy-avg-score");
    const top = panel.querySelector("#strategy-top-hit");
    const table = panel.querySelector("#strategy-table");

    if (headerTitle) headerTitle.textContent = `${meta.icon} ${meta.title}`;
    if (headerText) headerText.textContent = meta.summary;
    if (headerBadge) headerBadge.textContent = meta.badge;
    if (toolbarTitle) toolbarTitle.textContent = meta.title;
    if (toolbarBadge) toolbarBadge.textContent = meta.badge;
    const scoreValues = canvasState.filtered.map((row) => cleanNumber(row.score)).filter((value) => value);
    const avgScore = scoreValues.length ? Math.round(scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length) : 0;
    if (summary) summary.textContent = `${meta.title}｜Canvas 常駐列表，資料背景同步。`;
    if (count) count.textContent = String(canvasState.filtered.length || "--");
    if (avg) avg.textContent = avgScore ? String(avgScore) : "--";
    if (top) top.textContent = canvasState.filtered[0]?.code || "--";
    if (table) {
      table.innerHTML = `
        <section class="desktop-route-shell desktop-canvas-app" data-route-shell="${escapeHtml(key)}" data-route-source="${escapeHtml(canvasState.source || "")}">
          <div class="desktop-route-shell-head">
            <span>${escapeHtml(meta.icon)}</span>
            <div>
              <h2>${escapeHtml(meta.title)}</h2>
              <p>${escapeHtml(meta.summary)}</p>
            </div>
          </div>
          <div class="desktop-route-shell-grid">
            <article><span>切換狀態</span><strong>立即</strong></article>
            <article><span>資料狀態</span><strong>${canvasState.rows.length ? "快照命中" : "背景更新"}</strong></article>
            <article><span>手感模式</span><strong>Canvas</strong></article>
          </div>
          <div class="desktop-canvas-toolbar">
            <label class="desktop-canvas-search-wrap">
              <span>搜尋</span>
              <input class="desktop-canvas-search" value="${escapeHtml(canvasState.query || "")}" placeholder="代號 / 名稱 / 訊號" autocomplete="off" spellcheck="false">
            </label>
            <button type="button" class="desktop-canvas-refresh" data-canvas-refresh>刷新</button>
            <span class="desktop-canvas-count">${escapeHtml(`${canvasState.filtered.length}/${canvasState.rows.length}`)}</span>
            <span class="desktop-canvas-status">${escapeHtml(canvasState.source || "shell")}</span>
          </div>
          <canvas class="desktop-route-canvas" tabindex="0" aria-label="${escapeHtml(meta.title)} Canvas 快速列表"></canvas>
          <div class="desktop-canvas-detail" hidden></div>
        </section>
      `;
      const canvas = table.querySelector(".desktop-route-canvas");
      requestAnimationFrame(() => {
        if (!drawCanvasWithWorker(canvas)) {
          drawRouteCanvas(canvas, meta, canvasState.filtered, canvasState.source);
        }
        setCanvasStatus();
      });
    }
    window.setTimeout(() => delete panel.dataset.fumanRouteSnapshotRestoring, 0);
    return true;
  }

  function activateStrategyRoute(link, source) {
    switchStrategyViewNow(link);
    const key = strategyRouteKey(link);
    const rows = rowsForRoute(key);
    renderStrategyRouteShell(link, source, rows);
    restoreStrategySnapshot(link);
    fetchCanvasRows(key, false).then((apiRows) => {
      if (activeSnapshotRoute !== key || canvasState.route !== key) return;
      if (apiRows?.length) renderStrategyRouteShell(key, "api", apiRows);
      else scheduleCanvasDraw();
    }).catch(() => setCanvasStatus("沿用快照"));
  }

  function switchStrategyViewNow(link) {
    activeSnapshotRoute = strategyRouteKey(link) || activeSnapshotRoute;
    if (window.FUMAN_HOTFIX_SWITCH_VIEW_NOW?.(link)) return true;
    const panel = document.querySelector("#strategy-view");
    if (!panel) return false;
    document.querySelectorAll(".view-panel").forEach((item) => {
      const active = item === panel;
      item.classList.toggle("active", active);
      item.hidden = !active;
      item.setAttribute("aria-hidden", active ? "false" : "true");
    });
    document.querySelectorAll("[data-view]").forEach((item) => {
      item.classList.toggle("active", item === link);
      if (item === link) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
    return true;
  }

  function installRouteSnapshots() {
    const panel = document.querySelector("#strategy-view");
    if (!panel) {
      document.addEventListener("DOMContentLoaded", installRouteSnapshots, { once: true });
      return;
    }
    if (!panel || panel.dataset.fumanRouteSnapshotReady === "1") return;
    panel.dataset.fumanRouteSnapshotReady = "1";
    SNAPSHOT_ROUTES.forEach((key) => {
      const item = readSessionSnapshot(key);
      if (item) {
        routeSnapshots.set(key, item);
        if (item.rows?.length) setCanvasRows(key, item.rows, "session", item.at || Date.now());
      }
      readIndexedSnapshot(key).then((dbItem) => {
        if (dbItem) {
          routeSnapshots.set(key, dbItem);
          if (dbItem.rows?.length) setCanvasRows(key, dbItem.rows, "indexeddb", dbItem.at || Date.now());
        }
      }).catch(() => undefined);
    });
    new MutationObserver(() => {
      if (panel.dataset.fumanRouteSnapshotRestoring === "1") return;
      scheduleStrategySnapshotSave();
    }).observe(panel, { childList: true, subtree: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") saveStrategySnapshotNow();
    });
  }

  function dispatchOfficialClick(link, sourceEvent) {
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
      ctrlKey: !!sourceEvent.ctrlKey,
      shiftKey: !!sourceEvent.shiftKey,
      altKey: !!sourceEvent.altKey,
      metaKey: !!sourceEvent.metaKey,
      button: 0,
    });
    try {
      Object.defineProperty(event, "__fumanDesktopFastShellClick", { value: true });
    } catch (error) {
      event.__fumanDesktopFastShellClick = true;
    }
    link.dispatchEvent(event);
  }

  function runStrategyFastClick(link, sourceEvent) {
    const route = routeKey(link);
    const now = Date.now();
    if (route === fastClickRoute && now - fastClickAt < 180) return;
    fastClickRoute = route;
    fastClickAt = now;
    activateStrategyRoute(link, "fast-click");
    warm(link, "strategy-fast-click");
    if (!window.FUMAN_TERMINAL_APP_READY) {
      window.FUMAN_TERMINAL_LOAD_APP?.("desktop-strategy-canvas-background");
    }
  }

  function setPending(link, source) {
    if (!link) return;
    const route = routeKey(link);
    const now = Date.now();
    if (route === lastRoute && now - lastAt < 120) return;
    lastRoute = route;
    lastAt = now;

    document.querySelectorAll(".fuman-shell-pending").forEach((item) => {
      if (item !== link) item.classList.remove("fuman-shell-pending");
    });
    warm(link, source);
    link.classList.add("fuman-shell-pending");

    window.clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(clearPending, 120);
  }

  function clearPending() {
    document.querySelectorAll(".fuman-shell-pending").forEach((item) => {
      item.classList.remove("fuman-shell-pending");
    });
  }

  function installRouteFeedback() {
    document.addEventListener("pointerdown", (event) => {
      const link = event.target.closest?.(NAV_SELECTOR);
      if (!link || !isPrimaryPointer(event)) return;
      if (isStrategyLink(link)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        activateStrategyRoute(link, "pointer");
        setPending(link, "strategy-pointer");
        runStrategyFastClick(link, event);
        return;
      }
      setPending(link, "pointer");
    }, true);

    document.addEventListener("mouseover", (event) => {
      const link = event.target.closest?.(NAV_SELECTOR);
      if (link) warm(link, "hover");
    }, true);

    document.addEventListener("click", (event) => {
      const link = event.target.closest?.(NAV_SELECTOR);
      if (event.__fumanDesktopFastShellClick) return;
      if (!link || event.__fumanDeferredViewClick || event.__fumanFastOfficialClick) return;
      if (isStrategyLink(link) && routeKey(link) === fastClickRoute && Date.now() - fastClickAt < 700) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      setPending(link, "click");
    }, true);
  }

  function installStyle() {
    if (document.querySelector("#fuman-desktop-fast-shell-style")) return;
    const style = document.createElement("style");
    style.id = "fuman-desktop-fast-shell-style";
    style.textContent = `
      html.fuman-desktop-fast-shell,
      html.fuman-desktop-fast-shell body {
        scroll-behavior: auto !important;
      }
      .fuman-shell-pending {
        border-color: rgba(255, 112, 55, 0.9) !important;
        box-shadow: inset 0 0 0 1px rgba(255, 112, 55, 0.55), 0 8px 24px rgba(255, 112, 55, 0.12) !important;
        transform: translate3d(2px, 0, 0);
      }
      [data-view] {
        transition: border-color 70ms ease, background-color 70ms ease, box-shadow 70ms ease, transform 70ms ease !important;
      }
      .desktop-route-shell {
        border: 1px solid rgba(255, 112, 55, 0.35);
        border-radius: 18px;
        padding: 22px;
        background:
          linear-gradient(135deg, rgba(255, 112, 55, 0.12), rgba(30, 41, 59, 0.18)),
          rgba(10, 16, 28, 0.82);
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.03), 0 18px 44px rgba(0,0,0,0.22);
        contain: layout paint style;
      }
      .desktop-route-shell-head {
        display: flex;
        align-items: center;
        gap: 16px;
        min-height: 64px;
      }
      .desktop-route-shell-head > span {
        display: grid;
        place-items: center;
        width: 48px;
        height: 48px;
        border: 1px solid rgba(255, 112, 55, 0.5);
        border-radius: 14px;
        color: #ff8a3d;
        font-size: 24px;
        background: rgba(255, 112, 55, 0.1);
      }
      .desktop-route-shell-head h2 {
        margin: 0 0 7px;
        color: #f8fafc;
        font-size: 22px;
      }
      .desktop-route-shell-head p {
        margin: 0;
        color: #9fb0cb;
      }
      .desktop-route-shell-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-top: 20px;
      }
      .desktop-route-shell-grid article {
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 12px;
        padding: 14px;
        background: rgba(15, 23, 42, 0.72);
      }
      .desktop-route-shell-grid span {
        display: block;
        margin-bottom: 8px;
        color: #7f8da8;
        font-size: 13px;
      }
      .desktop-route-shell-grid strong {
        color: #e8eefc;
        font-size: 18px;
      }
      .desktop-route-canvas {
        display: block;
        width: 100%;
        min-height: 300px;
        margin-top: 20px;
        border-radius: 18px;
        background: #090f1c;
        box-shadow: inset 0 0 0 1px rgba(148,163,184,0.16);
        cursor: default;
        touch-action: none;
        user-select: none;
      }
      .desktop-route-canvas:focus {
        outline: 2px solid rgba(255,112,55,0.72);
        outline-offset: 3px;
      }
      .desktop-canvas-toolbar {
        display: grid;
        grid-template-columns: minmax(220px, 1fr) auto auto auto;
        align-items: end;
        gap: 12px;
        margin-top: 18px;
      }
      .desktop-canvas-search-wrap {
        display: grid;
        gap: 7px;
        color: #8796b2;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0;
      }
      .desktop-canvas-search {
        width: 100%;
        min-height: 42px;
        border: 1px solid rgba(148,163,184,0.22);
        border-radius: 12px;
        padding: 0 14px;
        color: #f8fafc;
        background: rgba(8,13,24,0.88);
        font: 800 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        outline: none;
      }
      .desktop-canvas-search:focus {
        border-color: rgba(255,112,55,0.72);
        box-shadow: 0 0 0 3px rgba(255,112,55,0.12);
      }
      .desktop-canvas-refresh {
        min-height: 42px;
        border: 1px solid rgba(255,112,55,0.48);
        border-radius: 12px;
        padding: 0 16px;
        color: #ffd0b5;
        background: rgba(255,112,55,0.12);
        font: 900 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        cursor: pointer;
      }
      .desktop-canvas-count,
      .desktop-canvas-status {
        min-height: 42px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(148,163,184,0.18);
        border-radius: 12px;
        padding: 0 14px;
        color: #b8c5da;
        background: rgba(15,23,42,0.68);
        white-space: nowrap;
        font: 800 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .desktop-canvas-detail {
        position: sticky;
        bottom: 14px;
        z-index: 3;
        margin-top: -8px;
      }
      .desktop-canvas-detail[hidden] {
        display: none !important;
      }
      .desktop-canvas-detail-panel {
        position: relative;
        border: 1px solid rgba(255,112,55,0.58);
        border-radius: 16px;
        padding: 18px;
        background:
          linear-gradient(135deg, rgba(255,112,55,0.18), rgba(15,23,42,0.96)),
          rgba(9,15,28,0.96);
        box-shadow: 0 22px 54px rgba(0,0,0,0.36);
      }
      .desktop-canvas-detail-close {
        position: absolute;
        top: 12px;
        right: 12px;
        width: 32px;
        height: 32px;
        border: 1px solid rgba(148,163,184,0.24);
        border-radius: 10px;
        color: #f8fafc;
        background: rgba(15,23,42,0.82);
        cursor: pointer;
      }
      .desktop-canvas-detail-kicker {
        color: #ffb27b;
        font-size: 12px;
        font-weight: 900;
      }
      .desktop-canvas-detail-panel h3 {
        margin: 8px 42px 8px 0;
        color: #f8fafc;
        font-size: 20px;
      }
      .desktop-canvas-detail-panel p {
        margin: 0;
        color: #b8c5da;
        line-height: 1.65;
      }
      .desktop-canvas-detail-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
        margin-top: 14px;
      }
      .desktop-canvas-detail-grid span {
        border: 1px solid rgba(148,163,184,0.17);
        border-radius: 12px;
        padding: 10px;
        color: #8796b2;
        background: rgba(15,23,42,0.65);
      }
      .desktop-canvas-detail-grid strong {
        display: block;
        margin-top: 5px;
        color: #f8fafc;
      }
      .desktop-route-shell-lines {
        display: grid;
        gap: 10px;
        margin-top: 22px;
      }
      .desktop-route-shell-lines i {
        display: block;
        height: 18px;
        border-radius: 999px;
        background: linear-gradient(90deg, rgba(148,163,184,0.16), rgba(255,112,55,0.18), rgba(148,163,184,0.12));
      }
      .desktop-route-shell-lines i:nth-child(2) { width: 82%; }
      .desktop-route-shell-lines i:nth-child(3) { width: 64%; }
      .desktop-route-shell-lines i:nth-child(4) { width: 74%; }
    `;
    document.head.appendChild(style);
    document.documentElement.classList.add("fuman-desktop-fast-shell");
  }
})();
