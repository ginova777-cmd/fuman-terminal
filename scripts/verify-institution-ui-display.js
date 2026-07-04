"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function includesAll(text, needles, label) {
  const missing = needles.filter((needle) => !text.includes(needle));
  assert.strictEqual(missing.length, 0, `${label} missing ${missing.join(", ")}`);
  return { label, checked: needles };
}

function regexMatch(text, regex, label) {
  assert(regex.test(text), `${label} missing ${regex}`);
  return { label, pattern: String(regex) };
}

function assertNoForbiddenStaticRendererUse(files, forbiddenPaths) {
  const hits = [];
  for (const file of files) {
    const text = readText(file);
    for (const forbidden of forbiddenPaths) {
      if (text.includes(forbidden)) hits.push({ file, forbidden });
    }
  }
  assert.strictEqual(hits.length, 0, `forbidden static institution renderer paths: ${JSON.stringify(hits)}`);
  return { files, forbiddenPaths, hits };
}

function verifyMatrix() {
  const matrix = readJson("fixtures/institution-ui-display-matrix.json");
  assert.strictEqual(matrix.strategy, "institution", "matrix strategy must be institution");
  assert(Array.isArray(matrix.surfaces) && matrix.surfaces.length >= 3, "matrix surfaces missing");
  const requiredColumns = [
    "uiSurface",
    "routeOrEndpoint",
    "rendererFile",
    "apiEndpointUsed",
    "forbiddenStaticPaths",
    "displayedFields",
    "requiredDisplayedFields",
    "uiBlankHandling",
    "degradedDisplayRule",
    "fallbackDisplayRule",
    "previousGoodDisplayRule",
    "verifierCommand",
    "negativeTest",
  ];
  for (const [index, row] of matrix.surfaces.entries()) {
    for (const column of requiredColumns) {
      assert(column in row, `surface ${index} missing ${column}`);
    }
    assert.strictEqual(row.apiEndpointUsed, "/api/institution-latest", `${row.uiSurface} must use institution latest API`);
    assert(Array.isArray(row.forbiddenStaticPaths) && row.forbiddenStaticPaths.length > 0, `${row.uiSurface} forbiddenStaticPaths missing`);
  }
  return matrix;
}

function main() {
  const matrix = verifyMatrix();
  const indexHtml = readText("index.html");
  const desktopShell = readText("terminal-desktop-fast-shell.js");
  const chipFlow = readText("terminal-chip-flow.js");
  const terminalApp = readText("terminal-app.js");
  const mobileHtml = readText("mobile.html");
  const mobileBoot = readText("api/mobile-boot.js");
  const mobileFragment = readText("api/mobile-fragment.js");
  const serviceWorker = readText("fuman-sw.js");
  const terminalUiE2e = readText("scripts/verify-terminal-ui-e2e.js");

  const checks = [];
  checks.push(includesAll(indexHtml, [
    "data-view=\"chip-trade\"",
    "id=\"chip-trade-view\"",
    "id=\"chip-trade-date\"",
    "id=\"chip-trade-body\"",
    "外資買賣超(張)",
    "投信買賣超(張)",
    "法人合計(張)",
  ], "desktop DOM"));
  checks.push(includesAll(desktopShell, [
    "\"chip-trade|買賣超\": \"/api/institution-latest\"",
    "foreignStreak",
    "trustStreak",
    "jointStreak",
    "foreignTrustVolumePct",
  ], "desktop fast shell route and sort endpoints"));
  checks.push(includesAll(chipFlow, [
    "chip-trade-api-only-no-local-fallback-v1",
    "function institutionPayloadEndpoint()",
    "return scope.endpoints.chipTradeLatest || scope.endpoints.institutionCache || scope.endpoints.institutionSlim",
    "function restoreChipTradeLocalCache()",
    "return false",
    "買賣超正式 API 讀取失敗",
    "未使用舊本機 cache",
    "function renderNormalRows",
    "foreignStreak",
    "trustStreak",
    "jointStreak",
    "foreignTrustBuyVolumePct",
  ], "desktop chip flow renderer"));
  checks.push(regexMatch(terminalApp, /"chip-trade"===viewName.+loadChipTradeData\(!1\)/s, "desktop view loads chip data through module"));
  checks.push(includesAll(mobileHtml, [
    "data-fragment=\"chip\"",
    "/api/mobile-boot",
    "/api/mobile-fragment?tab=",
  ], "mobile shell chip route"));
  checks.push(includesAll(mobileBoot, [
    "chip: \"/api/institution-latest\"",
    "source: \"mobile-boot-api-only\"",
    "fragmentVersion: \"mobile-api-only-v1\"",
  ], "mobile boot chip endpoint"));
  checks.push(includesAll(mobileFragment, [
    "chip: {",
    "endpoint: \"/api/institution-latest\"",
    "API-only complete run",
    "等待最新 complete run",
    "手機 API fragment 暫時無法取得",
  ], "mobile fragment chip endpoint and degraded display"));
  checks.push(includesAll(serviceWorker, [
    "/\\/api\\/institution-latest/i",
    "strategy2-intraday|strategy3|strategy5|institution",
  ], "service worker API cache and retired static institution data"));
  checks.push(includesAll(terminalUiE2e, [
    "key: \"institution\"",
    "expectedRouteKey: \"chip-trade|買賣超\"",
    "expectedPanelId: \"chip-trade-view\"",
    "fragment: \"chip\"",
  ], "terminal UI E2E institution routes"));
  checks.push(assertNoForbiddenStaticRendererUse([
    "terminal-chip-flow.js",
    "api/mobile-boot.js",
    "api/mobile-fragment.js",
  ], ["/data/institution-latest.json", "/data/institution.json"]));

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    strategy: "institution",
    contract: "institution-ui-display-v1",
    supabaseRead: false,
    supabaseWrite: false,
    deploy: false,
    usesUiDisplayMatrixFile: true,
    surfaces: matrix.surfaces.map((surface) => ({
      uiSurface: surface.uiSurface,
      apiEndpointUsed: surface.apiEndpointUsed,
      rendererFile: surface.rendererFile,
      requiredDisplayedFields: surface.requiredDisplayedFields,
      negativeTest: surface.negativeTest,
    })),
    checks,
  }, null, 2));
}

main();
