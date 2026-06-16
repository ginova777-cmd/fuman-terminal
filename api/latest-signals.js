const strategy4Latest = require("./strategy4-latest");
const strategy3Latest = require("./strategy3-latest");
const strategy5Latest = require("./strategy5-latest");

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET" && request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const url = new URL(request.url || "/api/latest-signals", "https://fuman-terminal.vercel.app");
  const strategy = String(url.searchParams.get("strategy") || request.query?.strategy || "strategy4").trim().toLowerCase();

  if (strategy === "strategy4" || strategy === "swing" || strategy === "swing_radar") {
    await strategy4Latest({ ...request, method: "GET" }, response);
    return;
  }

  if (strategy === "strategy3" || strategy === "overnight") {
    await strategy3Latest({ ...request, method: "GET" }, response);
    return;
  }

  if (strategy === "strategy5" || strategy === "multi" || strategy === "confluence") {
    await strategy5Latest({ ...request, method: "GET" }, response);
    return;
  }

  response.status(400).json({
    ok: false,
    error: "unsupported_strategy",
    strategy,
    supported: ["strategy3", "strategy4", "strategy5"],
  });
};
