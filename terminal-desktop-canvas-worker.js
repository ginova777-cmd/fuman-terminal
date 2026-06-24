(function () {
  "use strict";

  const WORKER_VERSION = "20260623-09";
  const rowsByRoute = new Map();
  const rowVersionsByRoute = new Map();
  const buffers = new Map();
  const MAX_BUFFERS = 14;
  let canvas = null;
  let ctx = null;
  let gpuProbe = "none";

  function compactText(value, limit = 96) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  }

  function roundRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function palette(theme) {
    if (theme === "light") {
      return {
        bg: "#f6f9fc",
        frameA: "rgba(255,247,237,0.96)",
        frameB: "rgba(235,244,255,0.92)",
        frameC: "rgba(255,255,255,0.98)",
        stroke: "rgba(249,115,22,0.28)",
        accent: "#f97316",
        accentSoft: "rgba(249,115,22,0.12)",
        accentHover: "rgba(249,115,22,0.08)",
        title: "#172033",
        text: "#25334a",
        muted: "#64748b",
        header: "rgba(226,236,248,0.86)",
        row: "rgba(255,255,255,0.88)",
        rowAlt: "rgba(246,250,255,0.9)",
        blue: "#2563eb",
        up: "#dc2626",
        down: "#059669",
        skeleton: "rgba(100,116,139,",
        scrollTrack: "rgba(100,116,139,0.16)",
        scrollThumb: "rgba(249,115,22,0.62)",
      };
    }
    return {
      bg: "#090f1c",
      frameA: "rgba(255,112,55,0.20)",
      frameB: "rgba(30,41,59,0.45)",
      frameC: "rgba(59,130,246,0.10)",
      stroke: "rgba(255,112,55,0.38)",
      accent: "#ff8a3d",
      accentSoft: "rgba(255,112,55,0.22)",
      accentHover: "rgba(255,112,55,0.13)",
      title: "#f8fafc",
      text: "#e8eefc",
      muted: "#9fb0cb",
      header: "rgba(15,23,42,0.86)",
      row: "rgba(30,41,59,0.46)",
      rowAlt: "rgba(15,23,42,0.58)",
      blue: "#9bc4ff",
      up: "#fb7185",
      down: "#34d399",
      skeleton: "rgba(148,163,184,",
      scrollTrack: "rgba(148,163,184,0.12)",
      scrollThumb: "rgba(255,112,55,0.58)",
    };
  }

  function probeGpuMode() {
    try {
      if (typeof OffscreenCanvas === "undefined") return "none";
      const probe = new OffscreenCanvas(1, 1);
      const gl2 = probe.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false });
      if (gl2) return "webgl2-ready";
      const gl = probe.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false });
      return gl ? "webgl-ready" : "2d-only";
    } catch (error) {
      return "2d-only";
    }
  }

  function attach(nextCanvas) {
    canvas = nextCanvas;
    gpuProbe = probeGpuMode();
    try {
      ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
      postMessage({ type: "ready", ok: true, mode: `worker-offscreen-${gpuProbe}`, version: WORKER_VERSION });
    } catch (error) {
      ctx = null;
      postMessage({ type: "ready", ok: false, mode: "worker-offscreen-failed", version: WORKER_VERSION });
    }
  }

  function clearRouteBuffers(route) {
    for (const [key, item] of buffers) {
      if (item.route === route) buffers.delete(key);
    }
  }

  function setRows(route, rows, version) {
    if (!route) return;
    const nextVersion = String(version ?? Date.now());
    const previousVersion = rowVersionsByRoute.get(route);
    rowsByRoute.set(route, Array.isArray(rows) ? rows : []);
    rowVersionsByRoute.set(route, nextVersion);
    if (previousVersion !== nextVersion) clearRouteBuffers(route);
  }

  function drawEmpty(context, width, height, source, headerHeight, rowHeight, colors) {
    for (let i = 0; i < 5; i += 1) {
      const y = headerHeight + 18 + i * rowHeight;
      const alpha = 0.16 - i * 0.014;
      context.fillStyle = `${colors.skeleton}${alpha})`;
      roundRect(context, 42, y, width - 84 - i * 28, 18, 9);
      context.fill();
    }
    context.fillStyle = colors.muted;
    context.font = "700 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    context.fillText(String(source || "").includes("canvas") ? "讀取快照中" : "已切換，背景同步資料", 44, height - 28);
  }

  function drawRows(context, rows, payload, capacity, colors) {
    const {
      width,
      headerHeight,
      rowHeight,
      offset,
      hoverIndex,
      selectedIndex,
    } = payload;
    const rowsToDraw = rows.slice(offset, offset + capacity);
    rowsToDraw.forEach((row, index) => {
      const globalIndex = offset + index;
      const y = headerHeight + index * rowHeight + 28;
      const active = globalIndex === selectedIndex;
      const hover = globalIndex === hoverIndex;
      context.fillStyle = active
        ? colors.accentSoft
        : hover
          ? colors.accentHover
          : index % 2
            ? colors.rowAlt
            : colors.row;
      roundRect(context, 24, y - 29, width - 48, 42, 10);
      context.fill();
      if (active || hover) {
        context.strokeStyle = active ? colors.accent : colors.stroke;
        context.lineWidth = 1;
        roundRect(context, 24.5, y - 28.5, width - 49, 41, 10);
        context.stroke();
      }

      context.fillStyle = colors.accent;
      context.font = "800 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      context.fillText(String(row.rank || index + 1), 48, y);
      context.fillStyle = colors.blue;
      context.font = "800 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      context.fillText(row.code || "--", 106, y);
      context.fillStyle = colors.text;
      context.font = "700 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      const isSubStrategyRoute = String(payload.route || "") === "strategy|策略4" || String(payload.route || "") === "strategy|策略5";
      const mainText = isSubStrategyRoute && row.subStrategy
        ? `${row.title || row.code || ""} · ${row.subStrategy}`
        : row.title || row.line || "";
      context.fillText(compactText(mainText, 46), 184, y - 6);
      context.fillStyle = colors.muted;
      context.font = "12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      context.fillText(compactText(isSubStrategyRoute ? row.signalLine || row.reason || row.line || "" : row.reason || row.line || "", 74), 184, y + 11);
      context.fillStyle = colors.text;
      context.textAlign = "right";
      context.fillText(row.score || "--", width - 130, y);
      context.fillStyle = String(row.pct || "").includes("-") ? colors.down : colors.up;
      context.fillText(row.pct || "--", width - 38, y);
      context.textAlign = "left";
    });
  }

  function drawScrollbar(context, rows, payload, capacity, colors) {
    if (rows.length <= capacity) return;
    const { width, height, headerHeight, offset } = payload;
    const trackTop = headerHeight;
    const trackHeight = height - headerHeight - 18;
    const thumbHeight = Math.max(34, trackHeight * (capacity / rows.length));
    const thumbTop = trackTop + (trackHeight - thumbHeight) * (offset / Math.max(1, rows.length - capacity));
    context.fillStyle = colors.scrollTrack;
    roundRect(context, width - 14, trackTop, 5, trackHeight, 4);
    context.fill();
    context.fillStyle = colors.scrollThumb;
    roundRect(context, width - 14, thumbTop, 5, thumbHeight, 4);
    context.fill();
  }

  function normalizePayload(payload) {
    const width = Math.max(520, Number(payload.width || 920));
    const height = Math.max(380, Number(payload.height || 520));
    const dpr = Math.max(1, Math.min(2, Number(payload.dpr || 1)));
    const rowHeight = Number(payload.rowHeight || 46);
    const headerHeight = Number(payload.headerHeight || 128);
    return {
      ...payload,
      width,
      height,
      dpr,
      rowHeight,
      headerHeight,
      offset: Math.max(0, Number(payload.offset || 0)),
      hoverIndex: Number.isFinite(Number(payload.hoverIndex)) ? Number(payload.hoverIndex) : -1,
      selectedIndex: Number.isFinite(Number(payload.selectedIndex)) ? Number(payload.selectedIndex) : -1,
      theme: payload.theme === "light" ? "light" : "dark",
    };
  }

  function bufferKey(payload) {
    const route = payload.route || "";
    const version = rowVersionsByRoute.get(route) || "0";
    const meta = payload.meta || {};
    return JSON.stringify([
      route,
      version,
      payload.width,
      payload.height,
      payload.dpr,
      payload.rowHeight,
      payload.headerHeight,
      payload.offset,
      payload.theme,
      compactText(meta.title || "", 48),
    ]);
  }

  function trimBuffers() {
    while (buffers.size > MAX_BUFFERS) {
      let oldestKey = "";
      let oldestAt = Infinity;
      for (const [key, item] of buffers) {
        if (item.at < oldestAt) {
          oldestAt = item.at;
          oldestKey = key;
        }
      }
      if (!oldestKey) return;
      buffers.delete(oldestKey);
    }
  }

  function renderFrame(targetCanvas, context, payload, rows) {
    const {
      width,
      height,
      dpr,
      rowHeight,
      headerHeight,
    } = payload;
    const capacity = Math.max(5, Math.floor((height - headerHeight - 16) / rowHeight));
    const colors = palette(payload.theme);
    targetCanvas.width = Math.floor(width * dpr);
    targetCanvas.height = Math.floor(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = colors.bg;
    context.fillRect(0, 0, width, height);

    const gradient = context.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, colors.frameA);
    gradient.addColorStop(0.55, colors.frameB);
    gradient.addColorStop(1, colors.frameC);
    context.fillStyle = gradient;
    roundRect(context, 0.5, 0.5, width - 1, height - 1, 18);
    context.fill();
    context.strokeStyle = colors.stroke;
    context.lineWidth = 1;
    roundRect(context, 0.5, 0.5, width - 1, height - 1, 18);
    context.stroke();

    const meta = payload.meta || {};
    context.fillStyle = colors.accent;
    context.font = "700 28px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    context.fillText(meta.icon || "◆", 28, 48);
    context.fillStyle = colors.title;
    context.font = "800 22px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    context.fillText(meta.title || "策略模組", 70, 42);
    context.fillStyle = colors.muted;
    context.font = "14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    context.fillText(compactText(meta.summary || "", 84), 70, 68);
    context.textAlign = "right";
    context.fillStyle = colors.accent;
    context.font = "800 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    context.fillText(`${rows.length} 筆`, width - 32, 42);
    context.fillStyle = colors.muted;
    context.font = "12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    context.fillText(compactText(payload.source || `worker-${gpuProbe}`, 28), width - 32, 66);
    context.textAlign = "left";

    context.fillStyle = colors.header;
    roundRect(context, 24, 88, width - 48, 38, 12);
    context.fill();
    context.fillStyle = colors.muted;
    context.font = "700 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    context.fillText("Rank", 46, 112);
    context.fillText("Code", 106, 112);
    context.fillText(String(payload.route || "") === "strategy|策略4" ? "細分策略" : "Signal", 184, 112);
    context.fillText("Score", width - 176, 112);
    context.fillText("Change", width - 92, 112);

    if (rows.length) {
      drawRows(context, rows, payload, capacity, colors);
      drawScrollbar(context, rows, payload, capacity, colors);
    } else {
      drawEmpty(context, width, height, payload.source || "", headerHeight, rowHeight, colors);
    }
  }

  function preRender(payload) {
    const next = normalizePayload(payload || {});
    const rows = rowsByRoute.get(next.route) || [];
    if (!next.route || !rows.length || typeof OffscreenCanvas === "undefined") return;
    const key = bufferKey(next);
    if (buffers.has(key)) {
      postMessage({ type: "preRendered", route: next.route, count: rows.length, cached: true, mode: `worker-buffer-${gpuProbe}` });
      return;
    }
    try {
      const offscreen = new OffscreenCanvas(Math.floor(next.width * next.dpr), Math.floor(next.height * next.dpr));
      const bctx = offscreen.getContext("2d", { alpha: false, desynchronized: true });
      if (!bctx) return;
      renderFrame(offscreen, bctx, next, rows);
      buffers.set(key, { route: next.route, canvas: offscreen, at: Date.now() });
      trimBuffers();
      postMessage({ type: "preRendered", route: next.route, count: rows.length, cached: false, mode: `worker-buffer-${gpuProbe}` });
    } catch (error) {}
  }

  function draw(payload) {
    if (!ctx || !canvas) return;
    const next = normalizePayload(payload || {});
    const rows = rowsByRoute.get(next.route) || [];
    const key = bufferKey(next);
    const canUseBuffer = !!next.preferBuffer && next.hoverIndex < 0 && next.selectedIndex < 0;
    const cached = canUseBuffer ? buffers.get(key) : null;
    if (cached?.canvas) {
      canvas.width = Math.floor(next.width * next.dpr);
      canvas.height = Math.floor(next.height * next.dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(cached.canvas, 0, 0);
      cached.at = Date.now();
      postMessage({ type: "drawn", route: next.route, count: rows.length, buffered: true, mode: `worker-buffer-${gpuProbe}` });
      return;
    }

    renderFrame(canvas, ctx, next, rows);

    postMessage({ type: "drawn", route: next.route, count: rows.length, buffered: false, mode: `worker-offscreen-${gpuProbe}` });
  }

  self.onmessage = (event) => {
    const data = event.data || {};
    if (data.type === "attach") attach(data.canvas);
    else if (data.type === "rows") setRows(data.route, data.rows, data.version);
    else if (data.type === "preRender") preRender(data);
    else if (data.type === "draw") draw(data);
  };
})();
