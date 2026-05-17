module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }

  const expected = String(process.env.FUMAN_EXPORT_PASSWORD || "").trim();
  if (!expected) {
    res.status(503).json({
      ok: false,
      code: "PASSWORD_NOT_SET",
      message: "尚未設定匯出密碼。",
    });
    return;
  }

  const body = typeof req.body === "object" && req.body ? req.body : {};
  const password = String(body.password || "").trim();

  if (password && password === expected) {
    res.status(200).json({ ok: true });
    return;
  }

  res.status(401).json({ ok: false, message: "密碼錯誤。" });
};
