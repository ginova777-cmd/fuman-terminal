const fs = require("fs");
const path = require("path");

const BOOT_PATH = path.resolve(__dirname, "..", "data", "mobile-boot.json");

module.exports = function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  try {
    const text = fs.readFileSync(BOOT_PATH, "utf8");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.status(200).send(request.method === "HEAD" ? "" : text);
  } catch (error) {
    response.status(503).json({
      ok: false,
      source: "mobile-boot-api",
      error: "mobile_boot_unavailable",
      message: error?.message || String(error),
    });
  }
};
