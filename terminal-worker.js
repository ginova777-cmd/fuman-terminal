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

self.addEventListener("message", (event) => {
  const { id, type, rows, sortKey, sortDir } = event.data || {};
  try {
    if (type === "sortRows") {
      self.postMessage({ id, ok: true, rows: sortRows(rows, sortKey, sortDir) });
      return;
    }
    self.postMessage({ id, ok: false, error: "unknown worker task" });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
});
