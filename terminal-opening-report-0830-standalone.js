(() => {
  "use strict";
  const ID = "terminal-opening-report-0830-standalone";
  const ENDPOINT = "/api/market-ai-live?canvas=1&compact=1&shell=1&limit=40";
  let report = null;
  let observer = null;

  const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (char) => char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : "&quot;");
  const arr = (value) => Array.isArray(value) ? value : [];
  const stockLabel = (stock) => esc(stock?.name || stock?.symbol || stock?.code || stock || "--");
  const biasLabel = (value) => {
    const text = String(value || "").toLowerCase();
    if (text.includes("negative") || text.includes("偏弱")) return "偏弱";
    if (text.includes("neutral") || text.includes("分歧")) return "分歧";
    return "偏多";
  };
  const pct = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? (n > 0 ? "+" : "") + n.toFixed(2) + "%" : "--";
  };

  function findPanel() {
    const market = document.querySelector("#market-view");
    if (!market) return null;
    let panel = market.querySelector("[data-market-api-ai], #market-ai-panel, .market-ai-panel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "market-ai-panel";
      panel.className = "market-ai-panel";
      panel.dataset.marketApiAi = "opening-report-0830-standalone";
      const header = market.querySelector(".page-header");
      header?.insertAdjacentElement("afterend", panel);
    }
    panel.hidden = false;
    return panel;
  }

  function build(data) {
    const priorities = arr(data.priority_industries).slice(0, 3);
    const globals = arr(data.market_snapshot?.items).slice(0, 4);
    const symbols = arr(data.recommended_symbols).slice(0, 18);
    const node = document.createElement("section");
    node.id = ID;
    node.dataset.openingReport0830Briefing = "1";
    node.dataset.fuman0830Standalone = "1";
    node.innerHTML = [
      "<style>",
      "#" + ID + "{display:block!important;box-sizing:border-box;min-height:360px;padding:24px;color:#d8e7ff;background:#090f19;border:1px solid #17c9de;border-radius:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif}",
      "#" + ID + " .or-head{display:flex;justify-content:space-between;gap:16px;padding-bottom:16px;border-bottom:1px solid #294457}",
      "#" + ID + " h2{margin:0;color:#ffd166;font-size:26px;letter-spacing:0}#" + ID + " p{margin:7px 0 0;color:#a9bed6;font-size:14px;line-height:1.55}",
      "#" + ID + " .or-badge{align-self:start;color:#8ee6c4;border:1px solid #2c816d;padding:6px 9px;font-size:12px;white-space:nowrap}",
      "#" + ID + " .or-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:16px}",
      "#" + ID + " .or-card{padding:15px;border:1px solid #2b4560;background:#0c1624;min-width:0}#" + ID + " .or-card b{display:block;color:#dbeafe;font-size:16px}#" + ID + " .or-bias{display:block;margin-top:9px;color:#ff7891;font-weight:700}#" + ID + " .or-stocks{margin-top:10px;color:#a9d0ff;line-height:1.7}",
      "#" + ID + " .or-global{margin-top:16px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid #294457;border-left:1px solid #294457}#" + ID + " .or-global div{padding:10px;border-right:1px solid #294457;border-bottom:1px solid #294457;color:#b7c6da;font-size:13px}#" + ID + " .or-global strong{float:right;color:#7de0b6}",
      "#" + ID + " .or-watch{margin-top:16px;color:#dbeafe;font-weight:700}#" + ID + " .or-symbols{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}#" + ID + " .or-symbols span{padding:5px 8px;border:1px solid #39577b;color:#cde2ff;font-size:13px}",
      "@media(max-width:850px){#" + ID + "{padding:16px}#" + ID + " .or-head{display:block}#" + ID + " .or-badge{display:inline-block;margin-top:10px}#" + ID + " .or-grid{grid-template-columns:1fr}#" + ID + " .or-global{grid-template-columns:1fr 1fr}}",
      "</style>",
      "<header class=\"or-head\"><div><h2>" + esc(data.date || "") + " 晨報｜今日優先觀察</h2><p>資料截點 08:20；僅供暖機與掃描排序，不構成正式進場訊號。</p></div><span class=\"or-badge\">priority_scan_only</span></header>",
      "<section class=\"or-grid\">" + (priorities.length ? priorities.map((item, index) => "<article class=\"or-card\"><b>" + (index + 1) + ". " + esc(item.display_name || item.industry || "觀察族群") + "</b><span class=\"or-bias\">" + biasLabel(item.bias) + "</span><div class=\"or-stocks\">" + arr(item.a_symbols).slice(0, 8).map(stockLabel).join("、") + "</div></article>").join("") : "<article class=\"or-card\"><b>今日觀察</b><div class=\"or-stocks\">晨報來源暫無可顯示產業。</div></article>") + "</section>",
      "<section class=\"or-global\">" + (globals.length ? globals.map((item) => "<div><span>" + esc(item.label || item.name || "全球市場") + "</span><strong>" + pct(item.percent) + "</strong></div>").join("") : "<div>全球速覽等待來源</div>") + "</section>",
      "<section class=\"or-watch\">今日觀察<div class=\"or-symbols\">" + (symbols.length ? symbols.map((item) => "<span>" + stockLabel(item) + "</span>").join("") : "<span>暫無映射標的</span>") + "</div></section>"
    ].join("");
    return node;
  }

  function mount() {
    if (!report || report.ok !== true) return false;
    const panel = findPanel();
    if (!panel) return false;
    const existing = document.getElementById(ID);
    if (existing && existing.parentElement === panel) return true;
    const node = existing || build(report);
    panel.replaceChildren(node);
    panel.dataset.marketApiAi = "opening-report-0830-standalone";
    panel.dataset.marketAiRenderer = "opening-report-0830-standalone";
    document.documentElement.dataset.fumanOpeningReport0830 = "mounted";
    return true;
  }

  function watch() {
    const market = document.querySelector("#market-view");
    if (!market || observer) return;
    observer = new MutationObserver(() => { mount(); });
    observer.observe(market, { childList: true, subtree: true });
  }

  async function refresh() {
    try {
      const payload = await fetch(ENDPOINT, { cache: "no-store", credentials: "same-origin" }).then((response) => response.json());
      report = payload?.openingMorningReport || null;
      if (mount()) watch();
      else document.documentElement.dataset.fumanOpeningReport0830 = "missing";
    } catch (error) {
      document.documentElement.dataset.fumanOpeningReport0830 = "error";
    }
  }

  window.__fumanOpeningReport0830Standalone = { refresh, mount };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refresh, { once: true });
  else refresh();
})();
