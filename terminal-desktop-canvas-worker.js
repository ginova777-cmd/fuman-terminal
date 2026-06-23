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

  function drawEmpty(context, width, height, source, headerHeight, rowHeight) {
    for (let i = 0; i < 5; i += 1) {
      const y = headerHeight + 18 + i * rowHeight;
      const alpha = 0.16 - i * 0.014;
      context.fillStyle = `rgba(148,163,184,${alpha})`;
      roundRect(context, 42, y, width - 84 - i * 28, 18, 9);
      context.fill();
    }
    context.fillStyle = "#9fb0cb";
    context.font = "700 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    context.fillText(String(source || "").includes("canvas") ? "讀取快照中" : "已切換，背景同步資料", 44, height - 28);
  }

  function drawRows(context, rows, payload, capacity) {
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
        ? "rgba(255,112,55,0.22)"
        : hover
          ? "rgba(255,112,55,0.13)"
          : index % 2
            ? "rgba(15,23,42,0.58)"
            : "rgba(30,41,59,0.46)";
      roundRect(context, 24, y - 29, width - 48, 42, 10);
      context.fill();
      if (active || hover) {
        context.strokeStyle = active ? "rgba(255,112,55,0.95)" : "rgba(255,112,55,0.42)";
        context.lineWidth = 1;
        roundRect(context, 24.5, y - 28.5, width - 49, 41, 10);
        context.stroke();
      }

      context.fillStyle = "#ff8a3d";
      context.font = "800 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      context.fillText(String(row.rank || index + 1), 48, y);
      context.fillStyle = "#9bc4ff";
      context.font = "800 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      context.fillText(row.code || "--", 106, y);
      context.fillStyle = "#e8eefc";
      context.font = "700 14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      context.fillText(compactText(row.title || row.line || "", 42), 184, y - 6);
      context.fillStyle = "#8391aa";
      context.font = "12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      context.fillText(compactText(row.reason || row.line || "", 70), 184, y + 11);
      context.fillStyle = "#e8eefc";
      context.textAlign = "right";
      context.fillText(row.score || "--", width - 130, y);
      context.fillStyle = String(row.pct || "").includes("-") ? "#34d399" : "#fb7185";
      context.fillText(row.pct || "--", width - 38, y);
      context.textAlign = "left";
    });
  }

  function drawScrollbar(context, rows, payload, capacity) {
    if (rows.length <= capacity) return;
    const { width, height, headerHeight, offset } = payload;
    const trackTop = headerHeight;
    const trackHeight = height - headerHeight - 18;
    const thumbHeight = Math.max(34, trackHeight * (capacity / rows.length));
    const thumbTop = trackTop + (trackHeight - thumbHeight) * (offset / Math.max(1, rows.length - capacity));
    context.fillStyle = "rgba(148,163,184,0.12)";
    roundRect(context, width - 14, trackTop, 5, trackHeight, 4);
    context.fill();
    context.fillStyle = "rgba(255,112,55,0.58)";
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
    targetCanvas.width = Math.floor(width * dpr);
    targetCanvas.height = Math.floor(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = "#090f1c";
    context.fillRect(0, 0, width, height);

    const gradient = context.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, "rgba(255,112,55,0.20)");
    gradient.addColorStop(0.55, "rgba(30,41,59,0.45)");
    gradient.addColorStop(1, "rgba(59,130,246,0.10)");
    context.fillStyle = gradient;
    roundRect(context, 0.5, 0.5, width - 1, height - 1, 18);
    context.fill();
    context.strokeStyle = "rgba(255,112,55,0.38)";
    context.lineWidth = 1;
    roundRect(context, 0.5, 0.5, width - 1, height - 1, 18);
    context.stroke();

    const meta = payload.meta || {};
    context.fillStyle = "#ff8a3d";
    context.font = "700 28px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    context.fillText(meta.icon || "◆", 28, 48);
    context.fillStyle = "#f8fafc";
    context.font = "800 22px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    context.fillText(meta.title || "策略模組", 70, 42);
    context.fillStyle = "#9fb0cb";
    context.font = "14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    context.fillText(compactText(meta.summary || "", 84), 70, 68);
    context.textAlign = "right";
    context.fillStyle = "#ffb27b";
    context.font = "800 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    context.fillText(`${rows.length} 筆`, width - 32, 42);
    context.fillStyle = "#9fb0cb";
    context.font = "12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    context.fillText(compactText(payload.source || `worker-${gpuProbe}`, 28), width - 32, 66);
    context.textAlign = "left";

    context.fillStyle = "rgba(15,23,42,0.86)";
    roundRect(context, 24, 88, width - 48, 38, 12);
    context.fill();
    context.fillStyle = "#9fb0cb";
    context.font = "700 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    context.fillText("Rank", 46, 112);
    context.fillText("Code", 106, 112);
    context.fillText("Signal", 184, 112);
    context.fillText("Score", width - 176, 112);
    context.fillText("Change", width - 92, 112);

    if (rows.length) {
      drawRows(context, rows, payload, capacity);
      drawScrollbar(context, rows, payload, capacity);
    } else {
      drawEmpty(context, width, height, payload.source || "", headerHeight, rowHeight);
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
