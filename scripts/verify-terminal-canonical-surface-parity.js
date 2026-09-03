const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STRATEGIES = ["strategy2", "strategy3", "strategy4", "strategy5", "institution"];
const ENDPOINTS = Object.fromEntries(STRATEGIES.map((key) => [key, `/api/${key}-latest`]));
const REQUIRED_PARITY_FIELDS = ["runId", "tradeDate", "resultCount", "complete"];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : "";
}

function loadJson(file, label, issues) {
  if (!file) return null;
  const absolute = path.resolve(file);
  if (!fs.existsSync(absolute)) {
    issues.push(`${label}_missing:${absolute}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    issues.push(`${label}_invalid_json:${error.message}`);
    return null;
  }
}

function value(row, field) {
  if (field === "tradeDate") return row?.tradeDate ?? row?.trade_date ?? row?.sourceDate ?? row?.usedDate;
  if (field === "resultCount") return row?.resultCount ?? row?.count ?? row?.displayCount;
  return row?.[field];
}

function normalized(row, field) {
  const raw = value(row, field);
  if (field === "resultCount") return Number(raw);
  if (field === "complete") return raw === true;
  return String(raw ?? "").trim();
}

function assertEvidence(label, row, issues) {
  for (const field of REQUIRED_PARITY_FIELDS) {
    const current = normalized(row, field);
    const missing = field === "resultCount" ? !Number.isFinite(current) : field === "complete" ? value(row, field) !== true && value(row, field) !== false : !current;
    if (missing) issues.push(`${label}_missing_${field}`);
  }
}

function compare(strategy, receipt, desktop, mobile, issues) {
  for (const [label, row] of [["receipt", receipt], ["desktop", desktop], ["mobile", mobile]]) {
    assertEvidence(`${strategy}_${label}`, row, issues);
  }
  for (const field of REQUIRED_PARITY_FIELDS) {
    const expected = normalized(receipt, field);
    for (const [label, row] of [["desktop", desktop], ["mobile", mobile]]) {
      const actual = normalized(row, field);
      if (actual !== expected) issues.push(`${strategy}_${label}_${field}_drift:${actual}!=${expected}`);
    }
  }
}

function select(payload, strategy) {
  if (!payload) return null;
  const alias = strategy === "institution" ? "chip" : strategy;
  return payload[strategy] ?? payload[alias] ?? payload.byKey?.[strategy] ?? payload.byKey?.[alias] ??
    (String(payload.strategy ?? payload.key ?? "").toLowerCase() === strategy ? payload : null);
}

function main() {
  const issues = [];
  const mobileBoot = read("api/mobile-boot.js");
  const mobileFragment = read("api/mobile-fragment.js");
  const desktopBundle = read("api/terminal-fast-bundle.js");
  const desktopConfig = read("terminal-runtime-config.js");

  for (const [strategy, endpoint] of Object.entries(ENDPOINTS)) {
    for (const [label, source] of [["mobile_boot", mobileBoot], ["mobile_fragment", mobileFragment], ["desktop_bundle", desktopBundle], ["desktop_config", desktopConfig]]) {
      if (!source.includes(endpoint)) issues.push(`${label}_missing_shared_endpoint:${strategy}:${endpoint}`);
    }
  }

  for (const [label, source] of [["mobile_boot", mobileBoot], ["mobile_fragment", mobileFragment]]) {
    for (const forbidden of ["run-full-scan.ps1", "run-strategy2-v3-unified.ps1", "run-strategy3", "run-strategy4", "run-strategy5", "scan-strategy", "publish-strategy"]) {
      if (source.toLowerCase().includes(forbidden.toLowerCase())) issues.push(`${label}_must_not_run_or_publish:${forbidden}`);
    }
  }

  if (!mobileFragment.includes("data-run-id") || !mobileFragment.includes("data-trade-date") || !mobileFragment.includes("data-result-count")) {
    issues.push("mobile_fragment_missing_canonical_evidence_attributes");
  }
  if (!/no-store/i.test(mobileBoot) || !/no-store/i.test(mobileFragment)) issues.push("mobile_latest_surface_must_be_no_store");

  const receiptFile = arg("receipt");
  const desktopFile = arg("desktop-evidence");
  const mobileFile = arg("mobile-evidence");
  const supplied = [receiptFile, desktopFile, mobileFile].filter(Boolean).length;
  if (supplied !== 0 && supplied !== 3) issues.push("runtime_parity_requires_receipt_desktop_and_mobile_evidence_together");
  if (supplied === 3) {
    const receiptPayload = loadJson(receiptFile, "receipt", issues);
    const desktopPayload = loadJson(desktopFile, "desktop_evidence", issues);
    const mobilePayload = loadJson(mobileFile, "mobile_evidence", issues);
    if (receiptPayload && desktopPayload && mobilePayload) {
      for (const strategy of STRATEGIES) {
        const receipt = select(receiptPayload, strategy);
        const desktop = select(desktopPayload, strategy);
        const mobile = select(mobilePayload, strategy);
        if (!receipt) issues.push(`${strategy}_canonical_receipt_missing`);
        if (!desktop) issues.push(`${strategy}_desktop_evidence_missing`);
        if (!mobile) issues.push(`${strategy}_mobile_evidence_missing`);
        if (receipt && desktop && mobile) compare(strategy, receipt, desktop, mobile, issues);
      }
    }
  }

  const result = {
    ok: issues.length === 0,
    contract: "terminal-canonical-surface-parity-v1",
    mode: supplied === 3 ? "static_and_runtime_evidence" : "static_source_contract",
    rules: {
      oneRunnerPerStrategy: true,
      mobileRunsScanner: false,
      mobileWritesReceipt: false,
      sharedLatestApi: true,
      parityFields: REQUIRED_PARITY_FIELDS,
    },
    strategies: STRATEGIES,
    issues,
    firstBlocker: issues[0] || null,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main();
