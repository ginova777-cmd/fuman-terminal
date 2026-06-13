const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_TERMINAL_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const LIVE = process.argv.includes("--live") || process.env.FUMAN_VERIFY_MOBILE_LAYOUT_LIVE === "1";

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function fetchText(pathname) {
  const url = new URL(pathname, BASE_URL);
  url.searchParams.set("layout-check", Date.now().toString());
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 20000,
      headers: {
        "cache-control": "no-cache",
        "user-agent": "FumanMobileLayoutVerifier/1.0",
      },
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body, url: url.toString() }));
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
  });
}

function extractStylesVersion(html) {
  return html.match(/styles\.css\?v=([^"'&<>]+)/)?.[1] || "";
}

function assertMobileHeatmapTwoColumns(css, issues) {
  const heatmapBlock = css.match(/#market-view\s+#heatmap\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*!important[^}]*\}/m);
  if (!heatmapBlock) {
    issues.push("mobile #market-view #heatmap must use repeat(2, minmax(0, 1fr)) !important");
  }

  const forbidden = /#market-view\s+#heatmap\s*\{[^}]*grid-template-columns:\s*1fr\s*!important[^}]*\}/m;
  if (forbidden.test(css)) {
    issues.push("forbidden mobile #market-view #heatmap one-column override found");
  }

  const cardBlock = css.match(/#market-view\s+#heatmap\s+\.sector-card\s*\{[^}]*width:\s*auto\s*!important[^}]*min-height:\s*194px\s*!important[^}]*\}/m);
  if (!cardBlock) {
    issues.push("mobile heatmap sector cards must keep auto width and stable mobile height");
  }
}

async function verifyLocal() {
  const issues = [];
  const html = read("index.html");
  const css = read("styles.css");
  const versionJson = JSON.parse(read("version.json"));
  const stylesVersion = extractStylesVersion(html);
  if (!stylesVersion) issues.push("index.html missing styles.css version");
  if (versionJson.version && stylesVersion !== versionJson.version) {
    issues.push(`styles.css version mismatch index=${stylesVersion} version.json=${versionJson.version}`);
  }
  assertMobileHeatmapTwoColumns(css, issues);
  return issues;
}

async function verifyLive() {
  const issues = [];
  const home = await fetchText("/");
  if (home.status < 200 || home.status >= 400) {
    issues.push(`live home HTTP ${home.status}`);
    return issues;
  }
  const version = extractStylesVersion(home.body);
  if (!version) {
    issues.push("live home missing styles.css version");
    return issues;
  }
  const css = await fetchText(`/styles.css?v=${encodeURIComponent(version)}`);
  if (css.status < 200 || css.status >= 400) {
    issues.push(`live styles HTTP ${css.status}`);
    return issues;
  }
  assertMobileHeatmapTwoColumns(css.body, issues);
  console.log(`[mobile-layout] live version=${version}`);
  return issues;
}

async function main() {
  const issues = LIVE ? await verifyLive() : await verifyLocal();
  if (issues.length) {
    console.error(`[mobile-layout] failed mode=${LIVE ? "live" : "local"}`);
    for (const issue of issues) console.error("- " + issue);
    process.exit(1);
  }
  console.log(`[mobile-layout] ok mode=${LIVE ? "live" : "local"}`);
}

main().catch((error) => {
  console.error(`[mobile-layout] failed: ${error.message}`);
  process.exit(1);
});
