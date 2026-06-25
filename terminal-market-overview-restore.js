(function restoreMarketOverviewLegacySurface() {
  if (window.__fumanDesktopFastShell === "20260623-09") {
    window.__fumanMarketOverviewRestoreReady = true;
    document.documentElement.dataset.fumanMarketOverviewRestoreSkipped = "desktop-fast-shell";
    [600, 2400, 6800].forEach((delay) => {
      setTimeout(() => {
        if (document.querySelector("#market-view.active:not([hidden])")) {
          window.FUMAN_MARKET_API_HYDRATE?.(true);
        }
      }, delay);
    });
    return;
  }
  if (window.__fumanMarketOverviewRestoreReady) return;
  window.__fumanMarketOverviewRestoreReady = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const marketPanel = $("#market-view");
  const dashboard = $(".dashboard");
  const navList = $(".nav-list");
  if (!marketPanel || !dashboard) return;

  function ensureMarketTabs() {
    let tabs = $("#market-mode-tabs");
    if (!tabs) {
      tabs = document.createElement("section");
      tabs.id = "market-mode-tabs";
      tabs.className = "market-mode-tabs";
      tabs.setAttribute("aria-label", "市場總覽模式");
      tabs.innerHTML = [
        '<button type="button" class="active" data-market-mode="overview">◉ 市場總覽</button>',
        '<button type="button" data-market-mode="ai">♙ AI 判讀</button>'
      ].join("");
      const header = marketPanel.querySelector(".page-header");
      header?.after(tabs);
    }

    let aiPanel = $("#market-ai-panel");
    if (!aiPanel) {
      aiPanel = document.createElement("section");
      aiPanel.id = "market-ai-panel";
      aiPanel.className = "market-ai-panel";
      aiPanel.hidden = true;
      aiPanel.innerHTML = '<div class="empty-state">載入最新 AI 判讀資料中...</div>';
      tabs.after(aiPanel);
    }
  }

  function applyMarketMode(mode) {
    const next = mode === "ai" ? "ai" : "overview";
    const aiPanel = $("#market-ai-panel");
    marketPanel.classList.toggle("market-ai-mode", next === "ai");
    marketPanel.classList.toggle("market-overview-mode", next !== "ai");
    $$("#market-mode-tabs [data-market-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.marketMode === next);
    });
    if (aiPanel) {
      aiPanel.hidden = next !== "ai";
      if (next === "ai") {
        try {
          window.renderMarketAiPanel?.();
        } catch (error) {}
      }
    }
    const title = $("#market-view .page-header h1");
    if (title && !title.querySelector(".page-title-icon")) {
      title.textContent = next === "ai" ? "AI 盤面判讀" : "市場總覽";
    }
  }

  function ensureRealtimeRadarEntry() {
    if (!navList) return;
    const existingLinks = $$('.nav-list [data-view="realtime-radar"]');
    existingLinks.slice(1).forEach((node) => node.remove());
    let link = existingLinks[0] || null;
    if (!link) {
      link = document.createElement("a");
      link.className = "strategy-nav realtime-radar-nav";
      link.href = "#";
      link.dataset.view = "realtime-radar";
      link.dataset.mobileLabel = "即時";
      link.innerHTML = "<span>◎</span>即時雷達";
      const marketLink = $('.nav-list [data-view="market"]');
      const watchLink = $('.nav-list [data-view="watchlist"]');
      if (marketLink && watchLink) marketLink.after(link);
      else navList.prepend(link);
    }
    link.classList.remove("member-locked-link");
    link.removeAttribute("aria-disabled");

    let panel = $("#realtime-radar-view");
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "view-panel radar-view";
      panel.id = "realtime-radar-view";
      panel.hidden = true;
      panel.innerHTML = '<div class="empty-state">即時雷達載入中...</div>';
      marketPanel.after(panel);
    }
  }

  function showView(viewName) {
    $$(".view-panel").forEach((panel) => {
      const active = panel.id === `${viewName}-view`;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    $$("[data-view]").forEach((link) => {
      link.classList.toggle("active", link.dataset.view === viewName);
    });
    if (viewName === "realtime-radar") {
      try {
        window.renderRealtimeRadar?.();
      } catch (error) {}
    }
  }

  ensureMarketTabs();
  ensureRealtimeRadarEntry();
  applyMarketMode("overview");
  setTimeout(ensureRealtimeRadarEntry, 400);
  setTimeout(ensureRealtimeRadarEntry, 1400);

  document.addEventListener("click", (event) => {
    const modeButton = event.target.closest?.("[data-market-mode]");
    if (modeButton) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      applyMarketMode(modeButton.dataset.marketMode);
      return;
    }
    const realtimeLink = event.target.closest?.('[data-view="realtime-radar"]');
    if (realtimeLink) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showView("realtime-radar");
      return;
    }
    const marketLink = event.target.closest?.('[data-view="market"]');
    if (marketLink) {
      setTimeout(() => {
        ensureMarketTabs();
        applyMarketMode("overview");
        if (!marketPanel.classList.contains("active")) showView("market");
      }, 0);
    }
  }, true);
})();
