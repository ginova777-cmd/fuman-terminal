const fs = require("fs");
const path = require("path");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const item = {
      at: new Date().toISOString(),
      kind: String(body.kind || "error").slice(0, 32),
      message: String(body.message || "").slice(0, 240),
      view: String(body.view || "").slice(0, 64),
      userAgent: String(req.headers["user-agent"] || "").slice(0, 160),
    };
    const dir = process.env.FUMAN_FRONTEND_ERROR_DIR || path.join(process.cwd(), ".frontend-errors");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "frontend-errors.jsonl"), `${JSON.stringify(item)}\n`, "utf8");
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(200).json({ ok: false });
  }
};
