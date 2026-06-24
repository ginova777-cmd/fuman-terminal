(function () {
  "use strict";

  const VERSION = "public-terminal-fast-20260623-09";

  function install(context = {}) {
    const root = context.document?.documentElement || document.documentElement;
    root.dataset.fumanMemberModule = "lazy-legacy";
    return {
      version: VERSION,
      mode: "lazy-legacy",
      open(reason = "member-module") {
        return window.FUMAN_TERMINAL_LEGACY_MODULES?.member?.(reason)
          || window.FUMAN_TERMINAL_LOAD_APP?.(reason);
      },
    };
  }

  window.FUMAN_MEMBER_MODULE = { version: VERSION, install };
  window.FUMAN_TERMINAL_MODULES?.markLoaded?.("member");
})();
