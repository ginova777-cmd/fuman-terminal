"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const c = require("./strategy3-v2-contract");
const runtime = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const date = process.argv.find((x) => x.startsWith("--trade-date="))?.split("=")[1] || c.taipeiDate();
const compact = date.replace(/\D/g, "");
const dryRun = process.argv.includes("--dry-run");
const retryTarget = process.argv.find((x) => x.startsWith("--retry-target="))?.split("=")[1] || "";

function reg(name) {
  try { return execFileSync("reg.exe", ["query", "HKCU\\Environment", "/v", name], { encoding: "utf8", windowsHide: true }).trim().split(/\s{2,}/).pop().trim(); }
  catch { return ""; }
}
function secret(file) { try { return fs.readFileSync(path.join(runtime, "secrets", file), "utf8").trim(); } catch { return ""; } }
function type(value) { return /^U[a-f0-9]{20,}$/i.test(value) ? "personal" : /^[CR][a-f0-9]{20,}$/i.test(value) ? "group" : "invalid"; }
function config() {
  const token = process.env.FUMAN_LINE_CHANNEL_ACCESS_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN || reg("FUMAN_LINE_CHANNEL_ACCESS_TOKEN") || reg("LINE_CHANNEL_ACCESS_TOKEN") || secret("line-channel-access-token.txt");
  const names = ["FUMAN_LINE_TO_USER", "FUMAN_LINE_USER_ID", "FUMAN_LINE_TO_GROUP", "FUMAN_LINE_GROUP_ID", "FUMAN_LINE_TO", "LINE_TO", "LINE_USER_ID"];
  const values = [...names.map((n) => process.env[n]), ...names.map(reg), secret("line-target-id.txt")];
  const targets = [...new Set(values.flatMap((v) => String(v || "").split(",")).map((v) => v.trim()).filter((v) => type(v) !== "invalid"))];
  return { token, targets };
}
function priorSent(target, runId) {
  try {
    const file = path.join(runtime, "state", "notification-guard", "sent-notifications.jsonl");
    return fs.readFileSync(file, "utf8").trim().split(/\r?\n/).some((line) => {
      try {
        const row = JSON.parse(line);
        return row.channel === "line" && row.target === target && row.status === "sent"
          && (row.idempotencyKey === `strategy3-v2:${runId}` || row.idempotencyKey === `strategy3-v2:${runId}:${target}`);
      } catch { return false; }
    });
  } catch { return false; }
}
function card(scan) {
  return { type: "bubble",
    header: { type: "box", layout: "vertical", backgroundColor: "#EC407A", contents: [
      { type: "text", text: "隔日沖參考", color: "#FFFFFF", weight: "bold", size: "lg" },
      { type: "text", text: `${scan.trade_date}｜${scan.result_count} 檔`, color: "#FFFFFF", size: "sm" }] },
    body: { type: "box", layout: "vertical", spacing: "md", contents: (scan.results || []).slice(0, 7).map((r) => ({
      type: "box", layout: "vertical", paddingAll: "9px", backgroundColor: "#FFF3F7", cornerRadius: "8px", contents: [
        { type: "text", text: `${r.rank}. ${r.code} ${r.name || ""}`, weight: "bold", color: "#AD1457" },
        { type: "text", text: `進場 ${r.entry_price}｜停損 ${r.stop_price}｜目標 ${r.conservative_target_price}`, size: "sm", wrap: true },
        { type: "text", text: `分數 ${r.score}｜漲幅 ${r.change_percent}%`, size: "xs", color: "#666666" }] })) },
    footer: { type: "box", layout: "vertical", contents: [{ type: "text", text: "3～7 個交易日參考，非自動下單", size: "xs", color: "#888888" }] } };
}
async function main() {
  const scan = c.readJson(c.scanReceiptPath(compact), null);
  if (!scan || scan.ok !== true || scan.status !== "COMPLETE" || scan.apply !== true || !String(scan.run_id || "").startsWith(`strategy3v2-${compact}-`)) {
    throw new Error("strategy3_v2_scan_not_publishable");
  }
  const cfg = config();
  const types = new Set(cfg.targets.map(type));
  const receipt = { ok: true, strategy: c.STRATEGY, contract: c.CONTRACT_VERSION, checked_at: c.nowTaipeiIso(), date: compact,
    dry_run: dryRun, status: dryRun ? "DRY_RUN_READY" : "PUSHED", run_id: scan.run_id, count: scan.result_count || 0,
    message_type: "flex", line_push_ok: false, line_push_personal_ok: false, line_push_group_ok: false,
    token_logged: false, target_logged: false, target_count: cfg.targets.length,
    line_card_design_contract: { version: "strategy3-v2-line-card-overnight-reference-v1", title: "隔日沖參考",
      forbidden_titles: ["日內當沖進出場參考", "日內當沖參考"], layout: "white_stock_card_pink_panel_six_box",
      source_contract: "Strategy3 V2 applied complete receipt only; legacy Strategy3 tables forbidden" } };
  if (!dryRun) {
    if (!cfg.token || !cfg.targets.length) throw new Error("strategy3_v2_line_config_missing");
    const targetsToSend = retryTarget ? cfg.targets.filter((target) => type(target) === retryTarget) : cfg.targets;
    if (!targetsToSend.length) throw new Error(`strategy3_v2_line_retry_target_missing:${retryTarget}`);
    process.env.LINE_CHANNEL_ACCESS_TOKEN = cfg.token; process.env.LINE_TO = targetsToSend.join(",");
    process.env.LINE_PUSH_RETRIES = process.env.LINE_PUSH_RETRIES || "3"; process.env.LINE_PUSH_TIMEOUT_MS = process.env.LINE_PUSH_TIMEOUT_MS || "4500";
    process.env.NOTIFY_GUARD_DISABLED = "1";
    const deliveries = await require("./line-push").sendLineFlex(`隔日沖參考 ${scan.trade_date}`, card(scan), {
      idempotencyKey: `strategy3-v2:${scan.run_id}`,
      strategy3V2Line: true,
      dataConfirmed: true,
    });
    if (!Array.isArray(deliveries) || deliveries.length !== targetsToSend.length || deliveries.some((item) => item.sent !== true)) {
      throw new Error(`strategy3_v2_line_not_delivered:${JSON.stringify(deliveries || [])}`);
    }
    const delivered = new Map(deliveries.map((item) => [item.target, item.sent === true]));
    const targetOk = (target) => delivered.get(target) === true || priorSent(target, scan.run_id);
    receipt.delivery_evidence = cfg.targets.map((target) => ({ target_type: type(target), sent: targetOk(target), sent_now: delivered.get(target) === true }));
    receipt.retry_target = retryTarget || null;
    receipt.line_push_personal_ok = cfg.targets.filter((target) => type(target) === "personal").every(targetOk) && types.has("personal");
    receipt.line_push_group_ok = cfg.targets.filter((target) => type(target) === "group").every(targetOk) && types.has("group");
    receipt.line_push_ok = receipt.line_push_personal_ok && receipt.line_push_group_ok;
    receipt.ok = receipt.line_push_personal_ok && receipt.line_push_group_ok;
    if (!receipt.ok) receipt.status = "PARTIAL_TARGETS";
  }
  const file = c.writeJson(c.lineReceiptPath(compact, dryRun ? ".dry-run" : ""), receipt);
  console.log(JSON.stringify({ ...receipt, receipt_path: file }, null, 2)); process.exitCode = receipt.ok ? 0 : 1;
}
main().catch((error) => {
  const receipt = c.failClosed("strategy3_v2_line_push_failed", { checked_at: c.nowTaipeiIso(), date: compact, dry_run: dryRun,
    status: "FAILED", line_push_ok: false, line_push_personal_ok: false, line_push_group_ok: false,
    token_logged: false, target_logged: false, error: error?.message || String(error) });
  const file = c.writeJson(c.lineReceiptPath(compact, dryRun ? ".dry-run" : ""), receipt);
  console.error(JSON.stringify({ ...receipt, receipt_path: file }, null, 2)); process.exit(1);
});
