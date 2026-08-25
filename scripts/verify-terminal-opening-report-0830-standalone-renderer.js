"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "terminal-opening-report-0830-standalone.js"), "utf8");

class Element {
  constructor(id = "") {
    this.id = id;
    this.dataset = {};
    this.children = [];
    this.parentElement = null;
    this.hidden = false;
    this.innerHTML = "";
  }
  querySelector() { return this.panel || null; }
  replaceChildren(node) {
    this.children = [node];
    node.parentElement = this;
    if (node.id) this.byId.set(node.id, node);
  }
  insertAdjacentElement() {}
}

async function main() {
  const byId = new Map();
  const market = new Element("market-view");
  const panel = new Element("market-ai-panel");
  panel.byId = byId;
  market.panel = panel;
  const document = {
    readyState: "complete",
    documentElement: { dataset: {} },
    querySelector(selector) { return selector === "#market-view" ? market : null; },
    createElement() { const node = new Element(); node.byId = byId; return node; },
    getElementById(id) { return byId.get(id) || null; },
    addEventListener() {},
  };
  const context = {
    document,
    MutationObserver: class { observe() {} },
    fetch: async () => ({ json: async () => ({
      openingMorningReport: {
        ok: true,
        date: "2026-08-25",
        priority_industries: [{ industry: "TEST", display_name: "測試族群", bias: "positive", a_symbols: [{ symbol: "1234", name: "測試股" }] }],
        market_snapshot: { items: [] },
        recommended_symbols: [{ symbol: "1234", name: "測試股" }],
      },
    }) }),
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: "terminal-opening-report-0830-standalone.js" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const node = panel.children[0];
  assert.equal(document.documentElement.dataset.fumanOpeningReport0830, "mounted");
  assert.equal(node?.id, "terminal-opening-report-0830-standalone");
  assert(node.innerHTML.includes("晨報｜今日優先觀察"));
  assert(node.innerHTML.includes("測試族群"));
  console.log(JSON.stringify({ ok: true, contract: "terminal_opening_report_0830_standalone_renderer_v1", mounted: true, target: "market-ai-panel", failed_checks: [], first_blocker: null, read_only: true }, null, 2));
}
main().catch((error) => { console.error(error.stack || String(error)); process.exit(1); });
