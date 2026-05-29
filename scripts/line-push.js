const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

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

async function pushLineMessages(messages) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const targets = lineTargets();
  if (!token || !targets.length) {
    throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN and LINE_TO or LINE_USER_ID");
  }
  for (const to of targets) {
    const response = await fetch(LINE_PUSH_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, messages }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`LINE push failed ${response.status}: ${detail}`);
    }
  }
}

async function sendLineText(text) {
  await pushLineMessages([{ type: "text", text: trimLineText(text) }]);
}

async function sendLineFlex(altText, contents) {
  await pushLineMessages([{ type: "flex", altText: trimAltText(altText), contents }]);
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
