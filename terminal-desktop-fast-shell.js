(function () {
  if (window.__fumanDesktopFastShell === "20260623-09") return;
  window.__fumanDesktopFastShell = "20260623-09";

  const NAV_SELECTOR = "[data-view]:not([data-member-tab])";
  let pendingTimer = 0;
  let lastRoute = "";
  let lastAt = 0;
  let fastClickRoute = "";
  let fastClickAt = 0;

  installStyle();
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
    `;
    document.head.appendChild(style);
    document.documentElement.classList.add("fuman-desktop-fast-shell");
  }
})();
