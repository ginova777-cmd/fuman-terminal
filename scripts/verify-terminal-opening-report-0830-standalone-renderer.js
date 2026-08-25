"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "terminal-opening-report-0830-standalone.js"), "utf8");

async function main() {
  assert(source.includes("briefingOnly=1"), "bridge must use the fast briefing endpoint");
  assert(source.includes("FUMAN_RENDER_OPENING_REPORT_0830"), "bridge must hand data to the desktop AI renderer");
  assert(!source.includes("terminal-opening-report-0830-root"), "bridge must not create a second market surface");

  const document = {
    readyState: "complete",
    documentElement: { dataset: {} },
    addEventListener() {},
  };
  let rendered = null;
  const context = {
    document,
    fetch: async () => ({
      ok: true,
      json: async () => ({
        openingMorningReport: {
          ok: true,
          date: "2026-08-25",
          priority_industries: [{ industry: "TEST" }],
        },
      }),
    }),
    FUMAN_RENDER_OPENING_REPORT_0830(payload) {
      rendered = payload;
      return true;
    },
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: "terminal-opening-report-0830-standalone.js" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(document.documentElement.dataset.fumanOpeningReport0830, "mounted");
  assert.equal(rendered?.openingMorningReport?.ok, true);
  assert.equal(rendered?.openingMorningReport?.date, "2026-08-25");
  console.log(JSON.stringify({
    ok: true,
    contract: "terminal_opening_report_0830_ai_panel_bridge_v1",
    mounted_inside_ai_panel: true,
    independent_surface_created: false,
    failed_checks: [],
    first_blocker: null,
    read_only: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(1);
});
