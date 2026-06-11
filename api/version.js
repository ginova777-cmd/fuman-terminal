const versionPayload = require("../version.json");

module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(200).json({
    ok: true,
    version: versionPayload.version,
    updatedAt: new Date().toISOString(),
  });
};
