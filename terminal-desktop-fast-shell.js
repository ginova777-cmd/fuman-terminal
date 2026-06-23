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
  let pendingTimer = 0;
  let snapshotTimer = 0;
  let snapshotDbPromise = null;
  let lastRoute = "";
  let lastAt = 0;
  let fastClickRoute = "";
  let fastClickAt = 0;
  let activeSnapshotRoute = "";
  const routeSnapshots = new Map();

  installStyle();
  installRouteSnapshots();
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
      if (!item?.html || Date.now() - Number(item.at || 0) > SNAPSHOT_MAX_AGE_MS) return null;
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
          resolve(item?.html && Date.now() - Number(item.at || 0) <= SNAPSHOT_MAX_AGE_MS ? item : null);
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
    if (!key || !item?.html || !panel) return false;
    if (Date.now() - Number(item.at || 0) > SNAPSHOT_MAX_AGE_MS) return false;
    if (Array.isArray(item.rows) && item.rows.length) {
      renderStrategyRouteShell(key, `canvas-${source}`, item.rows);
      return true;
    }
    panel.dataset.fumanRouteSnapshotRestoring = "1";
    panel.innerHTML = item.html;
    panel.scrollTop = Number(item.scrollTop || 0);
    panel.dataset.fumanRouteSnapshotKey = key;
    panel.dataset.fumanRouteSnapshotSource = source || "";
    window.setTimeout(() => delete panel.dataset.fumanRouteSnapshotRestoring, 0);
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
    const rowHeight = 46;
    const rowsToDraw = rows.length ? rows.slice(0, 28) : [];
    const height = Math.max(260, 116 + Math.max(rowsToDraw.length, 4) * rowHeight);
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

    ctx.fillStyle = "rgba(15,23,42,0.86)";
    roundRect(ctx, 24, 88, width - 48, 42, 12);
    ctx.fill();
    ctx.fillStyle = "#9fb0cb";
    ctx.font = "700 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText("Rank", 46, 114);
    ctx.fillText("Code", 106, 114);
    ctx.fillText("Signal", 184, 114);
    ctx.fillText("Score", width - 176, 114);
    ctx.fillText("Change", width - 92, 114);

    if (!rowsToDraw.length) {
      for (let i = 0; i < 5; i += 1) {
        const y = 146 + i * rowHeight;
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
      const y = 142 + index * rowHeight;
      ctx.fillStyle = index % 2 ? "rgba(15,23,42,0.58)" : "rgba(30,41,59,0.46)";
      roundRect(ctx, 24, y - 24, width - 48, 38, 10);
      ctx.fill();
      ctx.fillStyle = "#ff8a3d";
      ctx.font = "800 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(String(row.rank || index + 1), 48, y);
      ctx.fillStyle = "#9bc4ff";
      ctx.font = "800 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(row.code || "--", 106, y);
      ctx.fillStyle = "#e8eefc";
      ctx.font = "700 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.fillText(compactText(row.title || row.line || "", 54), 184, y);
      ctx.fillStyle = "#e8eefc";
      ctx.textAlign = "right";
      ctx.fillText(row.score || "--", width - 130, y);
      ctx.fillStyle = String(row.pct || "").includes("-") ? "#34d399" : "#fb7185";
      ctx.fillText(row.pct || "--", width - 38, y);
      ctx.textAlign = "left";
    });
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
    if (summary) summary.textContent = `${meta.title}｜畫面已切換，正在同步最新資料。`;
    if (count) count.textContent = "--";
    if (avg) avg.textContent = "--";
    if (top) top.textContent = "--";
    if (table) {
      table.innerHTML = `
        <section class="desktop-route-shell" data-route-shell="${escapeHtml(strategyRouteKey(link))}" data-route-source="${escapeHtml(source || "")}">
          <div class="desktop-route-shell-head">
            <span>${escapeHtml(meta.icon)}</span>
            <div>
              <h2>${escapeHtml(meta.title)}</h2>
              <p>${escapeHtml(meta.summary)}</p>
            </div>
          </div>
          <div class="desktop-route-shell-grid">
            <article><span>切換狀態</span><strong>已同步</strong></article>
            <article><span>資料狀態</span><strong>${rows.length ? "快照命中" : "背景更新"}</strong></article>
            <article><span>手感模式</span><strong>Canvas</strong></article>
          </div>
          <canvas class="desktop-route-canvas" aria-label="${escapeHtml(meta.title)} Canvas 快速列表"></canvas>
        </section>
      `;
      const canvas = table.querySelector(".desktop-route-canvas");
      requestAnimationFrame(() => drawRouteCanvas(canvas, meta, rows, source));
    }
    window.setTimeout(() => delete panel.dataset.fumanRouteSnapshotRestoring, 0);
    return true;
  }

  function activateStrategyRoute(link, source) {
    switchStrategyViewNow(link);
    if (!restoreStrategySnapshot(link)) {
      renderStrategyRouteShell(link, source);
    }
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
      if (item) routeSnapshots.set(key, item);
      readIndexedSnapshot(key).then((dbItem) => {
        if (dbItem) routeSnapshots.set(key, dbItem);
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
    const task = window.FUMAN_TERMINAL_APP_READY
      ? Promise.resolve(true)
      : window.FUMAN_TERMINAL_LOAD_APP?.("desktop-strategy-fast-click");
    Promise.resolve(task).then(() => {
      if (link.isConnected) dispatchOfficialClick(link, sourceEvent);
    }).catch(() => undefined);
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
