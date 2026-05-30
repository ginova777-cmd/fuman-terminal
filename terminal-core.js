(function () {
  const version = "speed-modules-20260530";
  window.FUMAN_TERMINAL_BOOT = {
    version,
    startedAt: Date.now(),
  };

  const loadMain = () => {
    if (document.querySelector("script[data-fuman-terminal-main]")) return;
    const script = document.createElement("script");
    script.src = `terminal.js?v=${version}`;
    script.async = true;
    script.dataset.fumanTerminalMain = "1";
    document.body.appendChild(script);
  };

  if ("requestIdleCallback" in window) {
    requestIdleCallback(loadMain, { timeout: 250 });
  } else {
    setTimeout(loadMain, 0);
  }
})();
