module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  response.status(410).json({
    ok: false,
    error: "desktop_static_json_disabled",
    detail: "Desktop strategy data is API-only. Use the latest API endpoint instead of /data/*.json.",
    path: request.url || "",
  });
};
