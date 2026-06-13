function asText(value, fallback = "--") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function n(value) {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function price(value) {
  const number = n(value);
  return number ? number.toFixed(number >= 100 ? 1 : 2).replace(/\.00$/, "") : "--";
}

function pct(value) {
  const number = n(value);
  if (!number) return "--";
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function intText(value) {
  const number = n(value);
  return number ? Math.round(number).toLocaleString("zh-TW") : "--";
}

function dateSlash(value) {
  return asText(value).replace(/-/g, "/");
}

function text(textValue, options = {}) {
  return { type: "text", text: asText(textValue), wrap: true, ...options };
}

function box(layout, contents, options = {}) {
  return { type: "box", layout, contents: contents.filter(Boolean), ...options };
}

function pill(label, color = "#eef2f7", textColor = "#334155") {
  return box("vertical", [text(label, { size: "xs", weight: "bold", color: textColor, align: "center" })], {
    backgroundColor: color,
    cornerRadius: "16px",
    paddingTop: "6px",
    paddingBottom: "6px",
    paddingStart: "10px",
    paddingEnd: "10px",
  });
}

function kv(label, value, options = {}) {
  return box("vertical", [
    text(label, { size: "xs", color: "#64748b", align: "center" }),
    text(value, { size: options.size || "sm", color: options.color || "#0f172a", weight: "bold", align: "center" }),
  ], {
    flex: 1,
    spacing: "4px",
    backgroundColor: options.backgroundColor || "#f8fafc",
    cornerRadius: "8px",
    paddingAll: "10px",
  });
}

function disclaimer() {
  return box("vertical", [
    text("警語：短線操作務必嚴守停損，跌破防守線請無條件砍倉。本訊息僅供教學參考。", {
      size: "xs",
      color: "#7c2d12",
      wrap: true,
    }),
  ], {
    backgroundColor: "#fffbeb",
    borderColor: "#fde68a",
    borderWidth: "1px",
    cornerRadius: "8px",
    paddingAll: "12px",
  });
}

function battleBubble({ title, subtitle, code, name, time, priceText, pctText, score, volume, tags, plan, footer }) {
  return {
    type: "bubble",
    size: "mega",
    body: box("vertical", [
      text(title, { size: "lg", weight: "bold", color: "#111827", align: "center" }),
      text(subtitle, { size: "xs", color: "#64748b", align: "center", margin: "sm" }),
      box("vertical", [
        text(`${code} ${name}`.trim(), { size: "xl", weight: "bold", color: "#0f172a" }),
        box("horizontal", (tags || []).slice(0, 3).map((tag, index) => pill(tag, index === 0 ? "#e0f2fe" : "#f1f5f9", index === 0 ? "#075985" : "#475569")), { margin: "md", spacing: "sm" }),
        box("vertical", [
          text(`價格：${priceText} ${pctText || ""}`, { size: "xxl", weight: "bold", color: String(pctText || "").startsWith("-") ? "#2563eb" : "#be123c", align: "center" }),
        ], { backgroundColor: "#f1f5f9", cornerRadius: "8px", paddingAll: "12px", margin: "md" }),
        box("horizontal", [
          kv("掃描時間", time || "--"),
          kv("動能分數", score ? String(Math.round(n(score))) : "--", { color: "#be123c" }),
          kv("成交量", volume ? `${intText(volume)}張` : "--"),
        ], { spacing: "8px", margin: "md" }),
        plan ? box("vertical", plan.map((item) => text(item, { size: "sm", color: "#334155" })), {
          borderColor: "#e2e8f0",
          borderWidth: "1px",
          cornerRadius: "8px",
          paddingAll: "12px",
          margin: "md",
          spacing: "4px",
        }) : null,
      ], {
        borderColor: "#e5e7eb",
        borderWidth: "1px",
        cornerRadius: "10px",
        paddingAll: "14px",
        margin: "lg",
        spacing: "sm",
      }),
      disclaimer(),
      text(footer || "Powered by Fuman AI Risk Management", { size: "xxs", color: "#94a3b8", align: "center", margin: "md" }),
    ], {
      backgroundColor: "#ffffff",
      paddingAll: "18px",
      spacing: "md",
    }),
    styles: { body: { backgroundColor: "#f8fafc" } },
  };
}

function strategy2LiveFlex(events, today) {
  const strategyText = (event) => (event.strategyTags || event.strategies || []).slice(0, 3).join(" / ") || event.primaryStrategy || event.strategy || "短線動能";
  const reasonText = (event) => (event.strategyReasons || []).slice(0, 2).join("；") || event.stateReason || event.reason || "首次進入A區，請依紀律觀察。";
  const bubbles = (events || []).slice(0, 10).map((event) => battleBubble({
    title: "【Fuman｜短線戰情室】",
    subtitle: `掃描日期：${dateSlash(today || event.date)}｜策略2 A區通知`,
    code: asText(event.code),
    name: asText(event.name, ""),
    time: event.firstAAt || event.entryAt || "--",
    priceText: price(event.firstAPrice || event.entryPrice),
    pctText: pct(event.percent || event.pct || event.changePct),
    score: event.maxScore || event.score,
    volume: event.volume || event.tradeVolume,
    tags: ["A區進場", strategyText(event), reasonText(event)].filter(Boolean),
    plan: [
      `進場區間：${price(event.firstAPrice || event.entryPrice)}`,
      `觸發策略：${strategyText(event)}`,
      `理由：${reasonText(event)}`,
    ],
  }));
  return bubbles.length === 1 ? bubbles[0] : { type: "carousel", contents: bubbles };
}

function tradeBuyFlex(event, position) {
  return battleBubble({
    title: "【Fuman｜交易管家】",
    subtitle: `策略2 A區 可買通知｜${asText(position.entryTime || event.firstAAt)}`,
    code: asText(event.code || position.code),
    name: asText(event.name || position.name, ""),
    time: position.entryTime || event.firstAAt || "--",
    priceText: price(position.entryPrice),
    pctText: pct(position.qualityPct),
    score: position.qualityScore,
    volume: position.qualityVolume,
    tags: ["可買通知", `${position.lots || "--"}張`, "風控已計算"],
    plan: [
      `建議投入：${intText(position.amount)}元（${position.lots || "--"}張）`,
      `停利價：${price(position.takeProfitPrice)}｜停損價：${price(position.stopLossPrice)}`,
      `品質：分數${Math.round(n(position.qualityScore))}｜量${intText(position.qualityVolume)}張`,
      `動能：${position.volumeTrendText || "--"}｜${position.signalText || "--"}`,
    ],
  });
}

function tradeExitFlex(position, quote, action, pnlText) {
  const isProfit = action === "takeProfit";
  const isDayClose = action === "dayClose";
  const label = isProfit ? "停利" : isDayClose ? "當沖出場" : "停損";
  return battleBubble({
    title: "【Fuman｜交易管家】",
    subtitle: isProfit ? "停利出場通知" : isDayClose ? "當沖出場通知" : "停損出場通知",
    code: asText(position.code),
    name: asText(position.name, ""),
    time: asText(position.entryTime),
    priceText: price(quote?.close || position.lastPrice || position.entryPrice),
    pctText: "",
    score: "",
    volume: "",
    tags: [label, "出場紀律", pnlText || ""].filter(Boolean),
    plan: [
      `進場價：${price(position.entryPrice)}`,
      `目前價：${price(quote?.close || position.lastPrice || position.entryPrice)}`,
      `損益：${pnlText || "--"}`,
      position.stopLossBasis ? `停損依據：${position.stopLossBasis}` : "",
      `建議動作：${isProfit ? "停利出場" : isDayClose ? "當天結束，不留倉" : "停損出場"}`,
    ].filter(Boolean),
  });
}

module.exports = { strategy2LiveFlex, tradeBuyFlex, tradeExitFlex };
