const fs = require("fs");
const path = require("path");

module.exports = function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).send("method_not_allowed");
    return;
  }

  const html = fs.readFileSync(path.join(__dirname, "..", "mobile.html"), "utf8");
  if (request.method === "HEAD") {
    response.status(200).end("");
    return;
  }
  response.status(200).send(html);
};
