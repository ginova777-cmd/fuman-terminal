(function () {
  "use strict";
  if (window.__fumanRouteFirstPaintReady) return;
  window.__fumanRouteFirstPaintReady = true;
  const LAST_ROUTE_KEY = window.FUMAN_RUNTIME_CONFIG?.lastRouteKey || "fuman-terminal-last-route-v1";
  const ROUTES = {
    strategy3: { view: "strategy", route: "strategy3", panel: "strategy-view", title: "隔日沖" },
    swing_radar: { view: "strategy", route: "strategy4", panel: "strategy-view", title: "波段" },
    strategy5: { view: "strategy", route: "strategy5", panel: "strategy-view", title: "綜合策略" },
    "chip-trade": { view: "chip-trade", route: "institution", panel: "chip-trade-view", title: "買賣超" },
  };
  const saved = (() => { try { return JSON.parse(localStorage.getItem(LAST_ROUTE_KEY) || "null"); } catch { return null; } })();
  const key = saved?.viewName === "chip-trade" ? "chip-trade" : saved?.strategyRoute;
  const config = ROUTES[key];
  if (!config) return;
  const panel = document.getElementById(config.panel);
  if (!panel) return;
  document.querySelectorAll("main .view-panel").forEach((node) => { node.hidden = node !== panel; });
  panel.hidden = false;
  panel.dataset.routeFirstPaint = "loading";
  const esc = (value) => String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
  const rowsFrom = (payload) => {
    const list = [payload?.rows, payload?.results, payload?.matches, payload?.items, payload?.displayCandidates].find(Array.isArray);
    if (list) return list;
    return payload?.data && typeof payload.data === "object" ? Object.values(payload.data) : [];
  };
  const render = (payload) => {
    const rows = rowsFrom(payload);
    const runId = esc(payload?.runId || payload?.latestRunId || "");
    const date = esc(payload?.tradeDate || payload?.scanDate || payload?.dataDate || "");
    panel.querySelector('[data-route-first-paint-shell]')?.remove();
    panel.insertAdjacentHTML("afterbegin", `<section class="route-first-paint" data-route-first-paint-shell="${esc(config.route)}" aria-label="${esc(config.title)}快速首屏"><style>.route-first-paint{padding:18px 20px}.route-first-paint header{display:flex;justify-content:space-between;align-items:end;gap:12px;margin-bottom:12px}.route-first-paint h1{margin:0;font-size:24px}.route-first-paint small{opacity:.7}.route-first-paint-list{display:grid;gap:8px}.route-first-paint-row{display:grid;grid-template-columns:58px minmax(150px,1fr) minmax(110px,.5fr);gap:12px;padding:11px 13px;border:1px solid rgba(148,163,184,.3);border-radius:9px;background:rgba(15,23,42,.35)}@media(max-width:720px){.route-first-paint-row{grid-template-columns:44px 1fr}.route-first-paint-metric{grid-column:2}}</style><header><div><h1>${esc(config.title)}</h1><small>${date}｜run=${runId}</small></div><strong>${rows.length} 檔</strong></header><div class="route-first-paint-list">${rows.slice(0,60).map((row,index)=>{const code=esc(row.code||row.symbol||row.stock_id||"");const name=esc(row.name||row.stockName||code);const score=esc(row.score??row.rankScore??row.swingScore??row.rank??"--");return `<div class="route-first-paint-row"><span>#${index+1}</span><b>${code} ${name}</b><span class="route-first-paint-metric">分數 ${score}</span></div>`;}).join("") || '<div class="route-first-paint-row"><b>完整快照目前 0 檔</b></div>'}</div></section>`);
    panel.dataset.routeFirstPaint = "complete";
    window.__fumanRouteFirstPaintPayloads = window.__fumanRouteFirstPaintPayloads || {};
    window.__fumanRouteFirstPaintPayloads[config.route] = payload;
    window.dispatchEvent(new CustomEvent("fuman:route-first-paint", { detail: { route: config.route, runId, count: rows.length } }));
    window.addEventListener("fuman:desktop-route", () => window.setTimeout(() => panel.querySelector('[data-route-first-paint-shell]')?.remove(), 80), { once: true });
  };
  fetch(`/api/terminal-route-first-paint?route=${encodeURIComponent(config.route)}&t=${Date.now()}`, { cache: "no-store", priority: "high" })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
    .then(render)
    .catch(() => { panel.dataset.routeFirstPaint = "failed"; });
})();
