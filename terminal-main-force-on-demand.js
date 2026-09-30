(() => {
  "use strict";
  if (window.fumanMainForceOnDemand) return;
  window.fumanMainForceOnDemand = true;
  const cache = new Map(), pending = new Map();
  let retryAfter = 0;
  async function read(code, date) {
    const key = `${date}:${code}`, saved = cache.get(key);
    if (saved && saved.until > Date.now()) return saved.item;
    if (pending.has(key)) return pending.get(key);
    if (Date.now() < retryAfter) throw Error("cooldown");
    const promise = (async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
      try {
        const query = new URLSearchParams({ codes: code, asOf: date, requested: "1" });
        const response = await fetch(`/api/main-force-costs?${query}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || payload.ok !== true || payload.deferred) throw Error("unavailable");
        const item = payload.items?.find(row => row.code === code && row.tradeDate === date) || null;
        cache.set(key, { item, until: Date.now() + (item ? 6 : 1) * 3600000 });
        while (cache.size > 1000) cache.delete(cache.keys().next().value);
        return item;
      } catch (error) {
        retryAfter = Date.now() + 1800000;
        throw error;
      } finally { clearTimeout(timer); }
    })();
    pending.set(key, promise);
    try { return await promise; } finally { pending.delete(key); }
  }
  document.addEventListener("click", async event => {
    const button = event.target.closest?.("[data-main-force-request]");
    if (!button) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const code = button.dataset.mainForceRequest, date = button.dataset.mainForceDate;
    const output = button.parentElement.querySelector("[data-main-force-result]");
    if (!output) return;
    output.hidden = false;
    if (!/^\d{4}$/.test(code || "") || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
      output.textContent = "缺少正式資料日期，暫不查詢"; return;
    }
    button.disabled = true; output.textContent = "查詢中…";
    try {
      const item = await read(code, date);
      output.textContent = item?.status === "ready"
        ? `主力成本 ${item.mainForceCostPrice}｜資料日 ${item.tradeDate}`
        : `資料不足｜須有 ${date} 正式分點資料`;
      if (item?.status === "ready") {
        for (const [field, label] of [["overnight", "隔日沖"], ["shortSwing", "短沖"], ["daytrade", "當沖"]]) {
          const style = item[field];
          output.textContent += `｜${label} ${style?.matched ? style.costPrice : "未匹配"}`;
        }
      }
    } catch {
      output.textContent = "來源暫時無法讀取，30 分鐘後可再查詢";
    } finally { button.disabled = false; }
  }, true);
})();
