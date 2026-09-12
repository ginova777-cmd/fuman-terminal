(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FUMAN_OPENING_REPORT_VIEW = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const arr = value => Array.isArray(value) ? value : [];
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  function rowsOf(data) {
    return arr(data?.display_top3 || data?.priority_industries).map(row => ({
      rank: Number(row.rank), name: row.display_name || row.industry || "",
      percent: Number(row.percent ?? row.average_percent),
      a: arr(row.mapped_symbols_a || row.a_symbols), b: arr(row.mapped_symbols_b || row.b_symbols),
      overseas: row.overseas_name || row.overseas_symbol || "",
    }));
  }
  function render(data) {
    const rows = rowsOf(data), warnings = arr(data?.delivery_warnings);
    const valid = data?.ok === true && Number(data?.industry_bias?.count) === 15 && rows.length <= 3
      && rows.every(row => row.rank >= 1 && row.rank <= 3 && row.percent > 0);
    const state = !data ? "empty" : !valid ? "blocked" : data.previousTradingDay || warnings.length ? "degraded" : rows.length ? "ready" : "zero";
    const message = !data ? "晨報尚未產生，等待 08:30 排程。" : !valid ? `晨報資料未完整：${data.reason_code || "產業或排名資料缺漏"}`
      : data.previousTradingDay ? `休市期間，顯示最近交易日 ${data.date} 的晨報。` : rows.length ? "正漲幅優先觀察" : "15 個產業已掃描，沒有符合正漲幅條件的觀察標的（0 筆）。";
    const stocks = (items, group) => `<div data-morning-group="${group}"><b>台股 ${group}：</b>${items.length ? items.map(stock => `<span data-morning-symbol="${esc(stock.symbol || stock.code)}" data-morning-name="${esc(stock.name)}">${esc(stock.symbol || stock.code)} ${esc(stock.name)}</span>`).join("、") : "無"}</div>`;
    return `<section class="opening-report-0830-briefing" data-opening-report-0830-briefing="1" data-opening-report-state="${state}" data-run-id="${esc(data?.run_id)}" data-trade-date="${esc(data?.date)}" data-content-hash="${esc(data?.delivery_content_hash)}" style="border:1px solid #64748b;border-radius:12px;padding:16px;margin:12px 0;overflow-wrap:anywhere;line-height:1.7">
      <header><h3 style="margin:0">${esc(data?.date || "")} 漲幅族群晨報</h3><p data-morning-status>${esc(message)}</p><p>資料截點 08:20｜晨報時段 08:30-08:59｜僅供觀察排序，不構成正式進場訊號</p></header>
      ${warnings.length ? `<p role="status">交付待確認：${warnings.map(esc).join("、")}</p>` : ""}
      ${valid ? `<p>產業掃描 <b data-morning-industry-count>15</b>／15｜觀察 <b data-morning-count>${rows.length}</b> 筆</p>${!rows.length ? '<p data-morning-zero>沒有符合正漲幅條件的觀察標的（0 筆）。</p>' : rows.map(row => `<article data-morning-rank="${row.rank}" style="border-top:1px solid #64748b;padding:12px 0"><h4><span data-morning-title>${esc(row.name)}</span> <span data-morning-percent>${row.percent > 0 ? "+" : ""}${row.percent.toFixed(2)}%</span></h4>${row.overseas ? `<p>${esc(row.overseas)}</p>` : ""}${stocks(row.a,"A")}${stocks(row.b,"B")}</article>`).join("")}` : ""}
    </section>`;
  }
  return { render, rowsOf };
});
