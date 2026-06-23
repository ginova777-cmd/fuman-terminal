(function () {
  "use strict";

  const WORKER_VERSION = "20260623-09";
  const rowsByRoute = new Map();
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

  function setRows(route, rows) {
    if (!route) return;
    rowsByRoute.set(route, Array.isArray(rows) ? rows : []);
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

  function draw(payload) {
    if (!ctx || !canvas) return;
    const width = Math.max(520, Number(payload.width || 920));
    const height = Math.max(380, Number(payload.height || 520));
    const dpr = Math.max(1, Math.min(2, Number(payload.dpr || 1)));
    const rowHeight = Number(payload.rowHeight || 46);
    const headerHeight = Number(payload.headerHeight || 128);
    const rows = rowsByRoute.get(payload.route) || [];
    const capacity = Math.max(5, Math.floor((height - headerHeight - 16) / rowHeight));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
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

    const meta = payload.meta || {};
    ctx.fillStyle = "#ff8a3d";
    ctx.font = "700 28px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(meta.icon || "◆", 28, 48);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "800 22px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(meta.title || "策略模組", 70, 42);
    ctx.fillStyle = "#9fb0cb";
    ctx.font = "14px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(compactText(meta.summary || "", 84), 70, 68);
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffb27b";
    ctx.font = "800 13px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(`${rows.length} 筆`, width - 32, 42);
    ctx.fillStyle = "#9fb0cb";
    ctx.font = "12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(compactText(payload.source || `worker-${gpuProbe}`, 28), width - 32, 66);
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

    if (rows.length) {
      drawRows(ctx, rows, { ...payload, width, height, rowHeight, headerHeight }, capacity);
      drawScrollbar(ctx, rows, { ...payload, width, height, headerHeight }, capacity);
    } else {
      drawEmpty(ctx, width, height, payload.source || "", headerHeight, rowHeight);
    }

    postMessage({ type: "drawn", route: payload.route, count: rows.length, mode: `worker-offscreen-${gpuProbe}` });
  }

  self.onmessage = (event) => {
    const data = event.data || {};
    if (data.type === "attach") attach(data.canvas);
    else if (data.type === "rows") setRows(data.route, data.rows);
    else if (data.type === "draw") draw(data);
  };
})();
