(function () {
  "use strict";

  const VERSION = "public-terminal-fast-20260623-09";

  function install(context = {}) {
    const root = document.documentElement;
    const instance = {
      version: VERSION,
      mode: "standalone-public-member",
      open,
      handleAuthButton,
      setTab,
      loadLegacy(reason = "member-module") {
        return context.loadApp?.(reason) || window.FUMAN_TERMINAL_LOAD_APP?.(reason);
      },
    };
    root.dataset.fumanMemberModule = instance.mode;
    unlockPublicMember();
    installMemberTabs();
    window.FUMAN_OPEN_MEMBER_CENTER = open;
    window.FUMAN_HANDLE_AUTH_BUTTON = handleAuthButton;
    return instance;
  }

  function unlockPublicMember() {
    document.body?.classList?.add("auth-ready", "public-terminal");
    document.body?.classList?.remove("auth-pending", "auth-locked", "auth-login-open");
    const gate = document.querySelector("#auth-gate");
    gate?.setAttribute("aria-hidden", "true");
    gate?.setAttribute("hidden", "");
    const memberState = document.querySelector("#member-state");
    if (memberState) memberState.textContent = "公開終端";
    const logout = document.querySelector(".sidebar-foot .logout");
    if (logout) logout.textContent = "公開";
    const plan = document.querySelector("#member-plan-label");
    if (plan) plan.textContent = "Public Terminal";
    const billingPlan = document.querySelector("#billing-plan-label");
    if (billingPlan) billingPlan.textContent = "公開版";
    const billingEmail = document.querySelector("#billing-email");
    if (billingEmail) billingEmail.textContent = "公開瀏覽";
  }

  function switchMainView(viewName = "member") {
    const panel = document.querySelector(`#${viewName}-view`);
    if (!panel) return;
    document.querySelectorAll(".view-panel").forEach((item) => {
      const active = item === panel;
      item.classList.toggle("active", active);
      item.hidden = !active;
      item.setAttribute("aria-hidden", active ? "false" : "true");
    });
    document.querySelectorAll("[data-view]").forEach((item) => {
      const active = item.dataset.view === viewName;
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  }

  function setTab(tab = "account") {
    const next = String(tab || "account");
    document.querySelectorAll("[data-member-tab]").forEach((button) => {
      const active = button.dataset.memberTab === next;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-selected", "true");
      else button.removeAttribute("aria-selected");
    });
    document.querySelectorAll("[data-member-panel]").forEach((panel) => {
      const active = panel.dataset.memberPanel === next;
      panel.classList.toggle("active", active);
      panel.hidden = !active;
    });
  }

  function open(tab = "account") {
    unlockPublicMember();
    switchMainView("member");
    setTab(typeof tab === "string" ? tab : "account");
    document.documentElement.dataset.fumanMemberOpened = String(Date.now());
  }

  function handleAuthButton() {
    unlockPublicMember();
    const message = document.querySelector("#auth-message");
    if (message) message.textContent = "目前為公開終端模式，不需要登入即可查看。";
    open("account");
  }

  function installMemberTabs() {
    if (document.documentElement.dataset.fumanMemberTabsReady === "1") return;
    document.documentElement.dataset.fumanMemberTabsReady = "1";
    document.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-member-tab]");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      open(button.dataset.memberTab || "account");
    }, true);
  }

  window.FUMAN_MEMBER_MODULE = { version: VERSION, install };
  window.FUMAN_TERMINAL_MODULES?.markLoaded?.("member");
})();
