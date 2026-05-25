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

async function sendLineText(text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const targets = lineTargets();
  if (!token || !targets.length) {
    throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN and LINE_TO or LINE_USER_ID");
  }
  const message = trimLineText(text);
  for (const to of targets) {
    const response = await fetch(LINE_PUSH_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to,
        messages: [{ type: "text", text: message }],
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`LINE push failed ${response.status}: ${detail}`);
    }
  }
}

module.exports = {
  hasLineConfig,
  sendLineText,
  trimLineText,
};
