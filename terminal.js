const heatmap = document.querySelector("#heatmap");
const refreshLine = document.querySelector(".refresh-line");
const sourceLine = document.querySelector("#source-line");
const dataStatus = document.querySelector("#data-status");
const headerTimes = [...document.querySelectorAll(".header-time")];
const metricCards = [...document.querySelectorAll(".metric-card")];
const tickerStrip = document.querySelector(".ticker-strip");
const strengthPanel = document.querySelector(".strength-panel");
const terminalMessage = document.querySelector("#terminal-message");
const stockSearch = document.querySelector("#stock-search");
const stockTable = document.querySelector("#stock-table");
const watchCount = document.querySelector("#watch-count");
const viewLinks = [...document.querySelectorAll("[data-view]")];
const viewPanels = {
  market: document.querySelector("#market-view"),
  strategy: document.querySelector("#strategy-view"),
};

const endpoints = {
  backend: "/api/market",
  indexes: "https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX",
  stocks: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
};

let latestStocks = [];

function cleanNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  return Number(String(value).replace(/[,+%]/g, "")) || 0;
}

function formatNumber(value, digits = 2) {
  return cleanNumber(value).toLocaleString("zh-TW", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatChange(sign, points, percent) {
  const symbol = sign === "-" ? "-" : "+";
  return `${symbol}${formatNumber(points)}　(${symbol}${formatNumber(percent)}%)`;
}

function valueOf(record, keys) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== "") return record[key];
  }
  return "";
}

async function fetchJson(url, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.data)) return value.data;
  if (value && Array.isArray(value.rows)) return value.rows;
  if (value && Array.isArray(value.result)) return value.result;
  return [];
}

function formatDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "時間未知";

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const time = date.toLocaleTimeString("zh-TW", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return `${month}/${day} ${time}`;
}

function setDataStatus(type, title, detail) {
  const dotClass = {
    live: "live",
    delayed: "delayed",
    fallback: "fallback",
    pending: "pending",
  }[type] || "pending";

  dataStatus.innerHTML = `
    <span class="status-dot ${dotClass}"></span>
    <strong>${title}</strong>
    <small>${detail}</small>
  `;
}

function renderHeatmap(rows) {
  if (!rows.length) {
    heatmap.innerHTML = `<div class="empty-state">尚無官方資料，未顯示展示行情。</div>`;
    return;
  }

  heatmap.innerHTML = rows
    .map(([name, change, volume, leader, count]) => `
      <article class="sector-card">
        <h3>${name}<span>${change}</span></h3>
        <p>${volume}</p>
        <small>
          <span>▲ ${Math.max(1, Math.ceil(Math.abs(cleanNumber(change)) * 1.4))}</span><b>▼ ${count}</b>
          <span>${leader}</span><b>●</b>
        </small>
      </article>
    `)
    .join("");
}

function renderIndexes(indexes, futuresNear, futuresNext) {
  const targets = [
    ["發行量加權", "加權指數"],
    ["櫃買", "櫃買指數"],
  ];

  targets.forEach(([keyword, label], index) => {
    const record = indexes.find((item) => String(valueOf(item, ["指數", "指數/報酬指數"])).includes(keyword));
    if (!record || !metricCards[index]) return;

    const sign = valueOf(record, ["漲跌", "漲跌(+/-)"]);
    const points = valueOf(record, ["漲跌點數"]);
    const percent = valueOf(record, ["漲跌百分比", "漲跌百分比(%)"]);
    const close = valueOf(record, ["收盤指數"]);
    const trendClass = sign === "-" ? "up" : "down";

    metricCards[index].innerHTML = `
      <span>↗ ${label}</span>
      <strong>${formatNumber(close)}</strong>
      <em class="${trendClass}">${formatChange(sign, points, percent)}</em>
    `;
  });

  // 台指期近月
  if (metricCards[2]) {
    if (futuresNear) {
      const sign = String(futuresNear.change || "").startsWith("-") ? "-" : "+";
      const trendClass = sign === "-" ? "up" : "down";
      metricCards[2].innerHTML = `
        <span>⇅ 台指近 ${futuresNear.month || ""}</span>
        <strong>${formatNumber(futuresNear.price, 0)}</strong>
        <em class="${trendClass}">${futuresNear.change || "--"}</em>
      `;
    } else {
      metricCards[2].innerHTML = `
        <span>⇅ 台指近</span>
        <strong>--</strong>
        <em>非交易時段</em>
      `;
    }
  }

  // 台指期次月
  if (metricCards[3]) {
    if (futuresNext) {
      const sign = String(futuresNext.change || "").startsWith("-") ? "-" : "+";
      const trendClass = sign === "-" ? "up" : "down";
      metricCards[3].innerHTML = `
        <span>☾ 台指次月 ${futuresNext.month || ""}</span>
        <strong>${formatNumber(futuresNext.price, 0)}</strong>
        <em class="${trendClass}">${futuresNext.change || "--"}</em>
      `;
    } else {
      metricCards[3].innerHTML = `
        <span>☾ 台指次月</span>
        <strong>--</strong>
        <em>非交易時段</em>
      `;
    }
  }
}

function stockChange(stock) {
  const change = cleanNumber(valueOf(stock, ["漲跌價差", "Change", "漲跌"]));
  const close = cleanNumber(valueOf(stock, ["收盤價", "ClosingPrice", "收盤"]));
  const previous = close - change;
  const percent = previous ? (change / previous) * 100 : 0;
  return { change, close, percent };
}

function renderStocks(stocks) {
  const parsed = stocks
    .map((stock) => {
      const code = valueOf(stock, ["證券代號", "Code"]);
      const name = valueOf(stock, ["證券名稱", "Name"]);
      const value = cleanNumber(valueOf(stock, ["成交金額", "TradeValue"]));
      const tradeVolume = cleanNumber(valueOf(stock, ["成交股數", "TradeVolume"]));
      return { code, name, value, tradeVolume, ...stockChange(stock) };
    })
    .filter((stock) => stock.code && stock.name && stock.close);

  if (!parsed.length) return;
  latestStocks = parsed;

  const up = parsed.filter((stock) => stock.change > 0).length;
  const down = parsed.filter((stock) => stock.change < 0).length;
  const flat = parsed.length - up - down;
  const totalValue = parsed.reduce((sum, stock) => sum + stock.value, 0) / 100000000;
  const upPercent = (up / parsed.length) * 100;

  strengthPanel.querySelector(".strength-head p").textContent = `${parsed.length.toLocaleString("zh-TW")} 檔 · 上漲 ${up.toLocaleString("zh-TW")} 檔`;
  strengthPanel.querySelector(".strength-head > strong").innerHTML = `${upPercent.toFixed(1)}%<span>上漲比例</span>`;

  const statValues = strengthPanel.querySelectorAll(".stats-row strong");
  statValues[0].textContent = up.toLocaleString("zh-TW");
  statValues[1].textContent = down.toLocaleString("zh-TW");
  statValues[2].textContent = flat.toLocaleString("zh-TW");
  statValues[3].textContent = `${totalValue.toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 億`;

  const topStocks = [...parsed]
    .filter((stock) => stock.percent > 0)
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 22);

  tickerStrip.innerHTML = topStocks
    .slice(0, 12)
    .map((stock, index) => {
      const className = index % 3 === 0 ? "down" : "";
      return `<span class="${className}">${stock.code} ${stock.name} ${stock.percent.toFixed(2)}%</span>`;
    })
    .join("");

  renderHeatmap(
    topStocks.map((stock) => [
      stock.name,
      `+${stock.percent.toFixed(2)}%`,
      `${stock.code} · ${(stock.value / 100000000).toFixed(1)} 億`,
      `收盤 ${stock.close.toLocaleString("zh-TW")}`,
      String(Math.max(0, Math.round(stock.tradeVolume / 10000000))),
    ])
  );

  renderStockTable(topStocks);
  terminalMessage.textContent = `掃描完成：${parsed.length.toLocaleString("zh-TW")} 檔，強勢股 ${topStocks.length} 檔`;
}

function renderStockTable(stocks) {
  const rows = stocks.slice(0, 10);
  watchCount.textContent = `TOP ${rows.length}`;

  if (!rows.length) {
    stockTable.innerHTML = `<div class="empty-state">尚無官方資料，未顯示展示排行。</div>`;
    return;
  }

  stockTable.innerHTML = `
    <div class="stock-row stock-head">
      <span>代號</span><span>名稱</span><span>收盤</span><span>漲幅</span><span>成交值</span>
    </div>
    ${rows
      .map((stock) => `
        <div class="stock-row">
          <span>${stock.code}</span>
          <strong>${stock.name}</strong>
          <span>${stock.close.toLocaleString("zh-TW")}</span>
          <em class="${stock.change >= 0 ? "down" : "up"}">${stock.percent >= 0 ? "+" : ""}${stock.percent.toFixed(2)}%</em>
          <span>${(stock.value / 100000000).toFixed(1)} 億</span>
        </div>
      `)
      .join("")}
  `;
}

function searchStocks(query) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) {
    renderStockTable([...latestStocks].filter((stock) => stock.percent > 0).sort((a, b) => b.percent - a.percent));
    return;
  }

  const results = latestStocks
    .filter((stock) => stock.code.includes(keyword) || stock.name.toLowerCase().includes(keyword))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  renderStockTable(results);
  terminalMessage.textContent = results.length
    ? `搜尋完成：找到 ${results.length} 筆符合「${query}」`
    : `搜尋完成：沒有找到「${query}」`;
}

function tickClock() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const time = now.toLocaleTimeString("zh-TW", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  refreshLine.textContent = `${month}/${day}  重新整理　更新 ${time}`;
  headerTimes.forEach((item) => {
    item.textContent = `${month}/${day} ${time.slice(0, 5)}`;
  });
}

function showView(viewName, activeLink) {
  Object.entries(viewPanels).forEach(([name, panel]) => {
    panel.hidden = name !== viewName;
    panel.classList.toggle("active", name === viewName);
  });

  viewLinks.forEach((link) => link.classList.toggle("active", link === activeLink));

  const focusTarget = activeLink.dataset.focus ? document.querySelector(`#${activeLink.dataset.focus}`) : null;
  if (focusTarget) {
    setTimeout(() => focusTarget.focus(), 0);
  }
}

async function loadMarketData() {
  renderHeatmap([]);
  renderStockTable([]);
  setDataStatus("pending", "資料檢查中", "正在連線官方公開資料");

  try {
    const payload = await fetchJson(endpoints.backend, 12000);
    if (!payload.ok) throw new Error(payload.error || "Backend API failed");

    renderIndexes(
      normalizeArray(payload.indexes),
      payload.futuresNear || payload.futures || null,
      payload.futuresNext || null
    );
    renderStocks(normalizeArray(payload.stocks));
    sourceLine.textContent = `資料來源：${payload.source} · 輔滿 API`;
    setDataStatus("delayed", "延遲真實資料", `最後檢查 ${formatDateTime(payload.updatedAt)}`);
    return;
  } catch (error) {
    sourceLine.textContent = "輔滿 API 暫時無法連線，改用瀏覽器直連公開資料";
    setDataStatus("pending", "改用備援連線", "正在嘗試瀏覽器直連 TWSE");
  }

  try {
    const [indexes, stocks] = await Promise.all([
      fetchJson(endpoints.indexes),
      fetchJson(endpoints.stocks),
    ]);

    renderIndexes(Array.isArray(indexes) ? indexes : [], null, null);
    renderStocks(Array.isArray(stocks) ? stocks : []);
    sourceLine.textContent = "資料來源：TWSE OpenAPI 公開盤後資料";
    setDataStatus("delayed", "延遲真實資料", `最後檢查 ${formatDateTime()}`);
  } catch (error) {
    sourceLine.textContent = "資料來源：備援展示資料，公開資料暫時無法連線";
    latestStocks = [];
    tickerStrip.innerHTML = `<span>官方資料暫時無法連線，未顯示展示行情。</span>`;
    terminalMessage.textContent = "官方資料暫時無法連線，未載入任何假資料";
    renderHeatmap([]);
    renderStockTable([]);
    setDataStatus("fallback", "無真實資料", "官方資料抓取失敗，畫面已停止顯示行情數字");
  }
}

tickClock();
loadMarketData();
stockSearch.addEventListener("input", (event) => searchStocks(event.target.value));
viewLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    showView(link.dataset.view, link);
  });
});
setInterval(tickClock, 1000);
setInterval(loadMarketData, 5 * 60 * 1000);
