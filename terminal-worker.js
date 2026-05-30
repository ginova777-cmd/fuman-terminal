function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function sortRows(rows, sortKey = "score", sortDir = "desc") {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const av = a?.[sortKey];
    const bv = b?.[sortKey];
    const an = cleanNumber(av);
    const bn = cleanNumber(bv);
    if (an || bn) return (an - bn) * dir;
    return String(av ?? "").localeCompare(String(bv ?? ""), "zh-Hant") * dir;
  });
}

function swingSortValue(stock, key) {
  const stageOrder = { low: 1, mid: 2, high: 3, hot: 4 };
  const stage = stock?.swingStage || {};
  const values = {
    code: Number(stock?.code) || 0,
    price: cleanNumber(stock?.close),
    close: cleanNumber(stock?.close),
    percent: cleanNumber(stock?.percent),
    volume: cleanNumber(stock?.tradeVolume),
    tradeVolume: cleanNumber(stock?.tradeVolume),
    stage: stageOrder[stage.tone] || 0,
    score: cleanNumber(stock?.swingScore || stock?.score),
    swingScore: cleanNumber(stock?.swingScore || stock?.score),
  };
  return values[key] ?? 0;
}

function sortSwingRows(rows, sortKey = "score", sortDir = "desc") {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const av = swingSortValue(a, sortKey);
    const bv = swingSortValue(b, sortKey);
    const diff = av === bv ? ((b?.swingSignals?.length || 0) - (a?.swingSignals?.length || 0)) : av - bv;
    return sortDir === "asc" ? diff : -diff;
  });
}

function buildSwingBuckets({ allRows = [], zoneFilter = "all", signalFilter = "all", sortKey = "score", sortDir = "desc" }) {
  const zoneRows = {
    A: sortSwingRows(allRows.filter((stock) => (stock.swingZone || "A") === "A"), sortKey, sortDir),
    B: sortSwingRows(allRows.filter((stock) => stock.swingZone === "B"), sortKey, sortDir),
    C: sortSwingRows(allRows.filter((stock) => stock.swingZone === "C"), sortKey, sortDir),
  };
  const zoneFilteredRows = zoneFilter === "all"
    ? allRows
    : allRows.filter((stock) => (stock.swingZone || "A") === zoneFilter);
  const filteredRows = signalFilter === "all"
    ? zoneFilteredRows
    : zoneFilteredRows.filter((stock) => (stock.swingSignals || []).some((signal) => signal.id === signalFilter));
  const signalCounts = {};
  allRows.forEach((stock) => {
    (stock.swingSignals || []).forEach((signal) => {
      signalCounts[signal.id] = (signalCounts[signal.id] || 0) + 1;
    });
  });
  return {
    rows: sortSwingRows(filteredRows, sortKey, sortDir),
    zoneRows,
    signalCounts,
  };
}

self.addEventListener("message", (event) => {
  const { id, type, rows, sortKey, sortDir } = event.data || {};
  try {
    if (type === "sortRows") {
      self.postMessage({ id, ok: true, rows: sortRows(rows, sortKey, sortDir) });
      return;
    }
    if (type === "swingBuckets") {
      self.postMessage({ id, ok: true, result: buildSwingBuckets(event.data || {}) });
      return;
    }
    self.postMessage({ id, ok: false, error: "unknown worker task" });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
});
