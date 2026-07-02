(function installMarketAiLiveWatchdog() {
  if (window.__fumanMarketAiLiveWatchdog) return;

  const endpoint = "/api/market-ai-live?canvas=1&compact=1&shell=1&limit=40";
  const loadingCopyMarker = "載入今日正式 AI 判讀";
  const staleCacheMarker = "不顯示舊 panel cache";

  window.__fumanMarketAiLiveWatchdog = "20260702-single-renderer-disabled";
  window.__fumanMarketAiLiveContractWatchdog = {
    endpoint,
    source: "live-contract-watchdog",
    renderer: "terminal-desktop-fast-shell",
    disabledReason: `${loadingCopyMarker} / ${staleCacheMarker}`,
  };
})();
