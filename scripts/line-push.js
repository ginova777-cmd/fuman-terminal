const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const { guardedSend, guardSummary } = require("./notification-guard");

function lineTargets() {
  return String(process.env.LINE_TO || process.env.LINE_USER_ID || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasLineConfig() {
  return Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN && lineTargets().length);
}

function trimLineText(text, limit = 4800) {
  const value = String(text || "").trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 22).trimEnd()}\n\n...內容過長已截斷`;
}

function trimAltText(text, limit = 400) {
  const value = String(text || "富滿通知").replace(/\s+/g, " ").trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

function splitLineText(text, limit = 3200) {
  const value = String(text || "").trim();
  if (value.length <= limit) return [value];
  const chunks = [];
  let current = "";
  const blocks = value.split(/\n{2,}/);
  blocks.forEach((block) => {
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length <= limit) {
      current = next;
      return;
    }
    if (current) chunks.push(current);
    if (block.length <= limit) {
      current = block;
      return;
    }
    for (let i = 0; i < block.length; i += limit) {
      chunks.push(block.slice(i, i + limit));
    }
    current = "";
  });
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

function requestTimeoutMs() {
  const fastDefault = /^(1|true|yes|on)$/i.test(String(process.env.NOTIFY_FAST_MODE || process.env.FUMAN_NOTIFY_FAST_MODE || ""));
  return Math.max(500, Number(process.env.LINE_PUSH_TIMEOUT_MS || process.env.NOTIFY_PUSH_TIMEOUT_MS || (fastDefault ? 1500 : 2500)));
}

function retryCount() {
  return Math.max(0, Number(process.env.LINE_PUSH_RETRIES || process.env.NOTIFY_PUSH_RETRIES || 1));
}

function shouldRetry(status) {
  return status === 429 || status >= 500;
}

async function fetchLine(payload, token) {
  let lastError = null;
  for (let attempt = 0; attempt <= retryCount(); attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs());
    try {
      const response = await fetch(LINE_PUSH_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (response.ok) return response;
      const detail = await response.text().catch(() => "");
      const error = new Error(`LINE push failed ${response.status}: ${detail}`);
      if (!shouldRetry(response.status) || attempt >= retryCount()) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (attempt >= retryCount()) throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("LINE push failed");
}

async function pushLineMessages(messages, options = {}) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const targets = lineTargets();
  if (!token || !targets.length) {
    throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN and LINE_TO or LINE_USER_ID");
  }
  for (const to of targets) {
    const payload = { to, messages };
    const result = await guardedSend({
      channel: "line",
      target: to,
      payload,
      options,
      send: () => fetchLine(payload, token),
    });
    if (!result.sent && process.env.NOTIFY_GUARD_VERBOSE === "1") {
      console.log(`LINE notification skipped: ${guardSummary(result.claim)}`);
    }
  }
}

async function sendLineText(text, options = {}) {
  await pushLineMessages([{ type: "text", text: trimLineText(text) }], options);
}

async function sendLineFlex(altText, contents, options = {}) {
  await pushLineMessages([{ type: "flex", altText: trimAltText(altText), contents }], options);
}

module.exports = {
  hasLineConfig,
  lineTargets,
  pushLineMessages,
  sendLineFlex,
  sendLineText,
  splitLineText,
  trimAltText,
  trimLineText,
};
