const TELEGRAM_API_BASE = "https://api.telegram.org";

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

async function telegramRequest(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Telegram ${method} failed ${response.status}: ${detail}`);
  }
  return response.json();
}

async function sendTelegramText(text) {
  const targets = telegramTargets();
  if (!process.env.TELEGRAM_BOT_TOKEN || !targets.length) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID or TELEGRAM_TO");
  }
  const chunks = splitTelegramText(text);
  for (const chatId of targets) {
    for (const chunk of chunks) {
      await telegramRequest("sendMessage", {
        chat_id: chatId,
        text: trimTelegramText(chunk),
        disable_web_page_preview: true,
      });
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
