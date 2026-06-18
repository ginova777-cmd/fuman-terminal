const fs = require("fs");
const path = require("path");
const { readSnapshot } = require("../lib/supabase-snapshots");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime";
const FALLBACK_CANDIDATES = [
  path.join(RUNTIME_DIR, "data", "terminal-theme-css.css"),
  path.join(ROOT, "data", "terminal-theme-css.css"),
];
const SNAPSHOT_KEY = "terminal_theme_css";
const MAX_CSS_BYTES = 160 * 1024;

function textResponse(response, status, css, transport = {}) {
  response.setHeader("Content-Type", "text/css; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("X-Fuman-Theme-CSS-Source", transport.source || "unknown");
  if (transport.snapshotId) response.setHeader("X-Fuman-Theme-CSS-Snapshot", transport.snapshotId);
  if (typeof response.status === "function" && typeof response.send === "function") {
    response.status(status).send(css);
    return;
  }
  if (typeof response.status === "function" && typeof response.end === "function") {
    response.status(status).end(css);
    return;
  }
  if (typeof response.writeHead === "function" && typeof response.end === "function") {
    response.writeHead(status);
    response.end(css);
    return;
  }
  if (typeof response.end === "function") {
    response.statusCode = status;
    response.end(css);
    return;
  }
  if (typeof response.json === "function") {
    response.status(status).json({ ok: status < 400, css, transport });
  }
}

function validCss(css) {
  return typeof css === "string" && css.trim() && Buffer.byteLength(css, "utf8") <= MAX_CSS_BYTES;
}

async function readSnapshotCss() {
  const snapshot = await readSnapshot(SNAPSHOT_KEY, {
    allowLatestFallback: true,
    timeoutMs: Number(process.env.TERMINAL_THEME_CSS_SNAPSHOT_READ_TIMEOUT_MS || 2500),
  });
  const css = snapshot?.payload?.css;
  if (!validCss(css)) return null;
  return {
    css,
    source: "supabase:market_snapshots",
    snapshotId: snapshot.snapshotId || "",
    updatedAt: snapshot.updatedAt || "",
    reason: snapshot.reason || (snapshot.locked ? "after-1330-cache" : "supabase-snapshot"),
  };
}

function readFallbackCss() {
  for (const file of FALLBACK_CANDIDATES) {
    try {
      const css = fs.readFileSync(file, "utf8");
      if (!validCss(css)) continue;
      return {
        css,
        source: "data/terminal-theme-css.css",
        file,
        reason: "static-fallback",
      };
    } catch {
      // Try next local fallback.
    }
  }
  return null;
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    textResponse(response, 405, "/* method_not_allowed */\n", { source: "none" });
    return;
  }

  try {
    const snapshotCss = await readSnapshotCss();
    if (snapshotCss) {
      textResponse(response, 200, snapshotCss.css, snapshotCss);
      return;
    }
  } catch {
    // Fall through to static fallback.
  }

  const fallback = readFallbackCss();
  if (fallback) {
    textResponse(response, 200, fallback.css, fallback);
    return;
  }

  textResponse(response, 503, "/* terminal_theme_css_unavailable */\n", { source: "none" });
};
