﻿      </div>
    </div>
  `).join("");

  document.querySelectorAll(".watchlist-card").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.tagName === "BUTTON") return;
      document.querySelectorAll(".watchlist-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      showTradingDashboard(card.dataset.code, card.dataset.name);
    });
  });

  const selectedCard = document.querySelector(".watchlist-card.selected") || document.querySelector(".watchlist-card");
  if (selectedCard && !watchlistAnalysis.querySelector(".ta-dashboard")) {
    selectedCard.click();
  }

  for (const item of list) {
    fetchStockPrice(item.code).then(stock => {
      if (!stock) return;
      const priceEl = document.querySelector(`#wprice-${item.code}`);
      const changeEl = document.querySelector(`#wchange-${item.code}`);
      const instEl = document.querySelector(`#winst-${item.code}`);
      if (priceEl) priceEl.textContent = stock.close.toLocaleString("zh-TW");
      if (changeEl) {
        const sign = stock.change >= 0 ? "+" : "";
        const color = stock.change > 0 ? "#e74c3c" : stock.change < 0 ? "#27ae60" : "#aaa";
        changeEl.style.color = color;
        changeEl.textContent = `${sign}${stock.change.toFixed(2)} (${sign}${stock.percent.toFixed(2)}%)`;
        if (stock.name && stock.name !== item.code) {
          item.name = stock.name;
          saveWatchlist(getWatchlist().map(w => w.code === item.code ? {...w, name: stock.name} : w));
          const nameEls = document.querySelectorAll(`#wcard-${item.code} span`);
          if (nameEls[1]) nameEls[1].textContent = stock.name;
        }
      }
      if (instEl) {
        const inst = institutionData[item.code];
        if (inst) {
          const fColor = inst.foreign > 0 ? "#e74c3c" : inst.foreign < 0 ? "#27ae60" : "#aaa";
          const tColor = inst.trust > 0 ? "#e74c3c" : inst.trust < 0 ? "#27ae60" : "#aaa";
          instEl.innerHTML = `外資 <span style="color:${fColor}">${inst.foreign > 0 ? "+" : ""}${(inst.foreign/1000).toFixed(0)}k</span>　投信 <span style="color:${tColor}">${inst.trust > 0 ? "+" : ""}${(inst.trust/1000).toFixed(0)}k</span>`;
        } else {
          instEl.innerHTML = `外資 <span>盤後</span>　投信 <span>盤後</span>`;
        }
      }
    });
  }

  if (watchlistRefresh) {
    const now = new Date();
    watchlistRefresh.textContent = `${String(now.getMonth()+1).padStart(2,"0")}/${String(now.getDate()).padStart(2,"0")}  更新 ${now.toLocaleTimeString("zh-TW", {hour12:false})}`;
  }
}

async function addToWatchlist() {
  const code = watchlistSearchInput.value.trim().replace(/\D/g, "");
  if (!code) return;

  const list = getWatchlist();
  if (list.find(w => w.code === code)) {
    watchlistSearchInput.value = "";
    alert("此股票已在自選股中");
    return;
  }

  list.push({ code, name: code });
  saveWatchlist(list);
  watchlistSearchInput.value = "";
  await renderWatchlist();

  const firstCard = document.querySelector(".watchlist-card");
  if (firstCard) firstCard.click();
}

function removeFromWatchlist(code) {
  const list = getWatchlist().filter(w => w.code !== code);
  saveWatchlist(list);
  renderWatchlist();
  watchlistAnalysis.innerHTML = `<div style="color:#555; font-size:14px;">點擊左側股票查看技術分析</div>`;
}

viewPanels.watchlist = document.querySelector("#watchlist-view");

watchlistSearchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addToWatchlist();
});
watchlistAddBtn?.addEventListener("click", addToWatchlist);

strategyCards.forEach((card) => {
  card.addEventListener("click", () => {
    const id = card.dataset.strategy;
    if (selectedStrategyIds.has(id)) {
      selectedStrategyIds.delete(id);
    } else {
      selectedStrategyIds.add(id);
    }
    renderStrategyScanner();
  });
});

strategyModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    strategyMode = button.dataset.strategyMode;
    renderStrategyScanner();
  });
});

strategyClear?.addEventListener("click", () => {
  selectedStrategyIds = new Set();
  if (strategySearch) strategySearch.value = "";
  strategyKeyword = "";
  renderStrategyScanner();
});

strategySearch?.addEventListener("input", (event) => {
  strategyKeyword = event.target.value;
  renderStrategyScanner();
});

async function refreshSelectedWatchlistQuote() {
  const card = document.querySelector(".watchlist-card.selected");
  if (!card) return;
  const stock = await fetchStockPrice(card.dataset.code);
  if (!stock) return;
  const priceEl = document.querySelector(`#wprice-${card.dataset.code}`);
  const changeEl = document.querySelector(`#wchange-${card.dataset.code}`);
  if (priceEl) priceEl.textContent = stock.close ? stock.close.toLocaleString("zh-TW") : "--";
  if (changeEl) {
    const sign = stock.change >= 0 ? "+" : "";
    changeEl.style.color = stock.change > 0 ? "#e74c3c" : stock.change < 0 ? "#27ae60" : "#aaa";
    changeEl.textContent = `${sign}${stock.change.toFixed(2)} (${sign}${stock.percent.toFixed(2)}%)`;
  }
  showTradingDashboard(card.dataset.code, stock.name || card.dataset.name);
}

renderWatchlist();
renderStrategyScanner();
setInterval(refreshSelectedWatchlistQuote, 5000);
