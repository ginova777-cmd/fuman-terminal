const TELEGRAM_API_BASE = "https://api.telegram.org";
const { guardedSend, guardSummary } = require("./notification-guard");

function telegramTargets() {
  return String(process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_TO || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasTelegramConfig() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && telegramTargets().length);
}

function trimTelegramText(text, limit = 3900) {
  const value = String(text || "").trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 18).trimEnd()}\n\n...內容已截斷`;
}

function splitTelegramText(text, limit = 3900) {
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
    for (let index = 0; index < block.length; index += limit) {
      chunks.push(block.slice(index, index + limit));
    }
    current = "";
  });
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

function requestTimeoutMs() {
  return Math.max(500, Number(process.env.TELEGRAM_PUSH_TIMEOUT_MS || process.env.NOTIFY_PUSH_TIMEOUT_MS || 2500));
}

function retryCount() {
  return Math.max(0, Number(process.env.TELEGRAM_PUSH_RETRIES || process.env.NOTIFY_PUSH_RETRIES || 1));
}

function shouldRetry(status) {
  return status === 429 || status >= 500;
}

async function telegramRequest(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  let lastError = null;
  for (let attempt = 0; attempt <= retryCount(); attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs());
    try {
      const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (response.ok) return response.json();
      const detail = await response.text().catch(() => "");
      const error = new Error(`Telegram ${method} failed ${response.status}: ${detail}`);
      if (!shouldRetry(response.status) || attempt >= retryCount()) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (attempt >= retryCount()) throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error(`Telegram ${method} failed`);
}

async function sendTelegramText(text, options = {}) {
  const targets = telegramTargets();
  if (!process.env.TELEGRAM_BOT_TOKEN || !targets.length) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID or TELEGRAM_TO");
  }
  const chunks = splitTelegramText(text);
  for (const chatId of targets) {
    const payload = {
      chatId,
      chunks: chunks.map((chunk) => trimTelegramText(chunk)),
    };
    const result = await guardedSend({
      channel: "telegram",
      target: chatId,
      payload,
      options,
      send: async () => {
        for (const chunk of chunks) {
          await telegramRequest("sendMessage", {
            chat_id: chatId,
            text: trimTelegramText(chunk),
            disable_web_page_preview: true,
          });
        }
      },
    });
    if (!result.sent && process.env.NOTIFY_GUARD_VERBOSE === "1") {
      console.log(`Telegram notification skipped: ${guardSummary(result.claim)}`);
    }
  }
}

module.exports = {
  hasTelegramConfig,
  sendTelegramText,
  splitTelegramText,
  telegramTargets,
  trimTelegramText,
};
