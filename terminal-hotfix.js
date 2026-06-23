(function () {
  if (window.__fumanTerminalHotfix === "20260623-02") return;
  window.__fumanTerminalHotfix = "20260623-02";

  installDesktopApiPollingCache();
  installInstantViewSwitch();
  installFastViewClickReplay();
  installHotfixStyle();

  function mark(name) {
    if (!("performance" in window) || !performance.mark) return;
    try { performance.mark(`fuman:hotfix:${name}`); } catch (error) {}
  }

  function installHotfixStyle() {
    if (document.querySelector("#fuman-terminal-hotfix-style")) return;
    const style = document.createElement("style");
    style.id = "fuman-terminal-hotfix-style";
    style.textContent = `
      body.fuman-view-switching .view-panel {
        transition: none !important;
      }
      body.fuman-view-switching [data-view] {
        transition: background-color 80ms ease, border-color 80ms ease, color 80ms ease !important;
      }
    `;
    document.head.appendChild(style);
  }

  function installInstantViewSwitch() {
    if (window.__fumanInstantViewSwitch) return;
    window.__fumanInstantViewSwitch = true;
    const panels = {
      market: "#market-view",
      strategy: "#strategy-view",
      watchlist: "#watchlist-view",
      "chip-trade": "#chip-trade-view",
      "cb-detect": "#cb-detect-view",
      "warrant-flow": "#warrant-flow-view",
      member: "#member-view",
    };
    const switchNow = (link) => {
      const view = link?.dataset?.view;
      const selector = panels[view];
      if (!selector) return false;
      const panel = document.querySelector(selector);
      if (!panel) return false;
      document.body.classList.add("fuman-view-switching");
      window.clearTimeout(window.__fumanViewSwitchingTimer);
      window.__fumanViewSwitchingTimer = window.setTimeout(() => {
        document.body.classList.remove("fuman-view-switching");
      }, 180);
      document.querySelectorAll(".view-panel").forEach((item) => {
        const active = item === panel;
        item.classList.toggle("active", active);
        item.hidden = !active;
        item.setAttribute("aria-hidden", active ? "false" : "true");
      });
      document.querySelectorAll("[data-view]").forEach((item) => {
        item.classList.toggle("active", item === link);
        if (item === link) {
          item.setAttribute("aria-current", "page");
        } else {
          item.removeAttribute("aria-current");
        }
      });
      document.body.dataset.fumanInstantView = view;
      window.__fumanLastInstantView = { view, at: Date.now() };
      mark(`instant-view:${view}`);
      return true;
    };
    window.FUMAN_HOTFIX_SWITCH_VIEW_NOW = switchNow;
    document.addEventListener("pointerdown", (event) => {
      const link = event.target.closest?.("[data-view]");
      if (!link || link.closest("[data-member-tab]")) return;
      switchNow(link);
      window.FUMAN_TERMINAL_LOAD_APP?.("instant-view-pointer");
    }, true);
    document.addEventListener("mousedown", (event) => {
      const link = event.target.closest?.("[data-view]");
      if (!link || link.closest("[data-member-tab]")) return;
      switchNow(link);
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const link = event.target.closest?.("[data-view]");
      if (link) switchNow(link);
    }, true);
  }

  function installFastViewClickReplay() {
    if (window.__fumanFastViewClickReplay) return;
    window.__fumanFastViewClickReplay = true;
    const replayClick = (link, sourceEvent) => {
      if (!link || link.dataset.fumanHotfixReplayQueued === "1") return;
      link.dataset.fumanHotfixReplayQueued = "1";
      requestAnimationFrame(() => {
        const afterPaint = () => {
          delete link.dataset.fumanHotfixReplayQueued;
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
            Object.defineProperty(event, "__fumanDeferredViewClick", { value: true });
          } catch (error) {
            event.__fumanDeferredViewClick = true;
          }
          link.dispatchEvent(event);
        };
        if ("scheduler" in window && typeof window.scheduler?.postTask === "function") {
          window.scheduler.postTask(afterPaint, { priority: "user-visible" }).catch(afterPaint);
        } else {
          setTimeout(afterPaint, 0);
        }
      });
    };
    document.addEventListener("click", (event) => {
      const link = event.target.closest?.("[data-view]");
      if (!link || link.closest("[data-member-tab]")) return;
      if (event.__fumanDeferredViewClick) return;
      if (event.button && event.button !== 0) return;
      const switched = window.FUMAN_HOTFIX_SWITCH_VIEW_NOW?.(link);
      if (!switched) return;
      if (!window.FUMAN_TERMINAL_APP_READY) {
        window.FUMAN_TERMINAL_LOAD_APP?.("instant-view-click");
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      replayClick(link, event);
    }, true);
  }

  function installDesktopApiPollingCache() {
    if (window.__fumanDesktopApiPollingCache) return;
    window.__fumanDesktopApiPollingCache = true;
    const originalFetch = window.fetch.bind(window);
    const memory = new Map();
    const inflight = new Map();
    const skipPattern = /\/api\/(?:export|refresh|frontend-error|performance-report|version|terminal-theme-css|scan-|github|history|realtime(?:$|\?))/i;
    const apiPattern = /\/api\/(?:market|terminal-home|market-ai|heatmap|stocks|watchlist-match-index|open-buy-latest|strategy[2345]-latest|latest-strategy|realtime-radar-latest|institution-latest|chip-trade|warrant-flow-latest|cb-detect-latest|mobile-boot|mobile-fragment)/i;
    const ttlFor = (pathname) => {
      if (/strategy2|realtime-radar/i.test(pathname)) return 3000;
      if (/market(?:$|-ai)|heatmap/i.test(pathname)) return 8000;
      if (/strategy[345]|open-buy/i.test(pathname)) return 15000;
      if (/institution|chip-trade|warrant|cb-detect/i.test(pathname)) return 30000;
      if (/stocks|terminal-home|watchlist-match-index|mobile/i.test(pathname)) return 45000;
      return 10000;
    };
    const cloneFromRecord = (record) => new Response(record.body, {
      status: record.status,
      statusText: record.statusText,
      headers: record.headers,
    });
    const cacheKeyFor = (input, init = {}) => {
      const method = String(init?.method || input?.method || "GET").toUpperCase();
      if (method !== "GET") return "";
      const url = new URL(typeof input === "string" ? input : input?.url || "", location.href);
      if (url.origin !== location.origin) return "";
      if (!apiPattern.test(url.pathname) || skipPattern.test(url.pathname)) return "";
      if (url.searchParams.has("force") || url.searchParams.has("refresh")) return "";
      ["t", "ts", "fresh", "_", "cacheBust"].forEach((key) => url.searchParams.delete(key));
      return `${url.pathname}?${url.searchParams.toString()}`;
    };
    window.fetch = function fumanCachedFetch(input, init = {}) {
      const key = cacheKeyFor(input, init);
      if (!key) return originalFetch(input, init);
      const now = Date.now();
      const cached = memory.get(key);
      if (cached && now - cached.at <= cached.ttl) {
        return Promise.resolve(cloneFromRecord(cached));
      }
      if (inflight.has(key)) {
        return inflight.get(key).then(cloneFromRecord);
      }
      const task = originalFetch(input, init).then(async (response) => {
        const body = await response.clone().text();
        const record = {
          at: Date.now(),
          ttl: ttlFor(new URL(typeof input === "string" ? input : input?.url || "", location.href).pathname),
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers.entries()],
          body,
        };
        if (response.ok) memory.set(key, record);
        return record;
      }).finally(() => inflight.delete(key));
      inflight.set(key, task);
      return task.then(cloneFromRecord);
    };
  }
})();
