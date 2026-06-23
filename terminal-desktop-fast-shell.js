(function () {
  if (window.__fumanDesktopFastShell === "20260623-09") return;
  window.__fumanDesktopFastShell = "20260623-09";

  const NAV_SELECTOR = "[data-view]:not([data-member-tab])";
  let pendingTimer = 0;
  let lastRoute = "";
  let lastAt = 0;

  installStyle();
  installRouteFeedback();
  installContentCommitWatcher();

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
    link.classList.add("fuman-shell-pending");
    document.body.classList.add("fuman-shell-switching");
    document.body.dataset.fumanShellPending = route;
    warm(link, source);

    window.clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(clearPending, 900);
  }

  function clearPending() {
    document.body.classList.remove("fuman-shell-switching");
    delete document.body.dataset.fumanShellPending;
    document.querySelectorAll(".fuman-shell-pending").forEach((item) => {
      item.classList.remove("fuman-shell-pending");
    });
  }

  function installRouteFeedback() {
    document.addEventListener("pointerdown", (event) => {
      const link = event.target.closest?.(NAV_SELECTOR);
      if (!link || !isPrimaryPointer(event)) return;
      setPending(link, "pointer");
    }, true);

    document.addEventListener("mouseover", (event) => {
      const link = event.target.closest?.(NAV_SELECTOR);
      if (link) warm(link, "hover");
    }, true);

    document.addEventListener("click", (event) => {
      const link = event.target.closest?.(NAV_SELECTOR);
      if (!link || event.__fumanDeferredViewClick || event.__fumanFastOfficialClick) return;
      setPending(link, "click");
    }, true);
  }

  function installContentCommitWatcher() {
    const root = document.querySelector("main") || document.body;
    const observer = new MutationObserver(() => {
      if (!document.body.classList.contains("fuman-shell-switching")) return;
      window.clearTimeout(pendingTimer);
      pendingTimer = window.setTimeout(clearPending, 120);
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "aria-hidden"],
    });
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
      body.fuman-shell-switching .view-panel,
      body.fuman-shell-switching .strategy-terminal,
      body.fuman-shell-switching .chip-flow-shell,
      body.fuman-shell-switching .terminal-table {
        transition: none !important;
      }
      body.fuman-shell-switching [data-view] {
        transition: border-color 70ms ease, background-color 70ms ease, box-shadow 70ms ease, transform 70ms ease !important;
      }
    `;
    document.head.appendChild(style);
    document.documentElement.classList.add("fuman-desktop-fast-shell");
  }
})();
