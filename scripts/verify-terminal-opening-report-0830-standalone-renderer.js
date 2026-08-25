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
  querySelector(selector) {
    if (String(selector).includes("data-fuman-market-tabs")) return this.tabs || null;
    if (String(selector).includes("terminal-band")) return this.terminalBand || null;
    return this.panel || null;
  }
  replaceChildren(node) {
    this.children = [node];
    node.parentElement = this;
    if (node.id) this.byId.set(node.id, node);
  }
  insertAdjacentElement(position, node) {
    if (position !== "afterend" || !this.parentElement) return;
    const parent = this.parentElement;
    const index = parent.children.indexOf(this);
    parent.children.splice(index + 1, 0, node);
    node.parentElement = parent;
    if (node.id) parent.byId.set(node.id, node);
  }
  appendChild(node) { this.children.push(node); node.parentElement = this; if (node.id) this.byId.set(node.id, node); }
  insertBefore(node, anchor) { this.children.unshift(node); node.parentElement = this; if (node.id) this.byId.set(node.id, node); }
}

async function main() {
  assert(source.includes("briefingOnly=1"), "standalone renderer must use the fast briefing endpoint");
  assert(source.includes("market-ai-live"), "standalone renderer must retain the market API fallback");
  const byId = new Map();
  const market = new Element("market-view");
  const panel = new Element("market-ai-panel");
  const terminalBand = new Element("terminal-band");
  panel.byId = byId;
  terminalBand.byId = byId;
  market.byId = byId;
  market.panel = panel;
  market.terminalBand = terminalBand;
  const document = {
    readyState: "complete",
    documentElement: { dataset: {} },
    querySelector(selector) { return selector === "#market-view" ? market : null; },
    createElement() { const node = new Element(); node.byId = byId; return node; },
    getElementById(id) { return byId.get(id) || null; },
    addEventListener() {},
  };
  let observerCallback = null;
  const context = {
    document,
    MutationObserver: class {
      constructor(callback) { observerCallback = callback; }
      observe() {}
    },
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
  const root = document.getElementById("terminal-opening-report-0830-root");
  const node = root?.children[0];
  assert.equal(document.documentElement.dataset.fumanOpeningReport0830, "mounted");
  assert.equal(root?.className, "terminal-opening-report-0830-root");
  assert.equal(market.children[1], root, "briefing root must render before the AI panel");
  assert.equal(node?.id, "terminal-opening-report-0830-standalone");
  assert(node.innerHTML.includes("晨報｜今日優先觀察"));
  assert(node.innerHTML.includes("測試族群"));
  assert(observerCallback, "root observer was not installed");
  panel.replaceChildren(document.createElement("section"));
  observerCallback();
  assert.equal(document.getElementById("terminal-opening-report-0830-root")?.children[0]?.id, "terminal-opening-report-0830-standalone");
  console.log(JSON.stringify({ ok: true, contract: "terminal_opening_report_0830_standalone_renderer_v1", mounted: true, target: "independent_market_view_sibling", survived_ai_panel_overwrite: true, failed_checks: [], first_blocker: null, read_only: true }, null, 2));
}
main().catch((error) => { console.error(error.stack || String(error)); process.exit(1); });
