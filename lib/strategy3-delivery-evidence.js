"use strict";

// Evidence must bind to the scanner batch, never to whatever old latest is present.
function verifyDelivery({ scan, tri, collection, current, line, date, ui }) {
  const issues = [];
  const add = (ok, reason) => { if (!ok) issues.push(reason); };
  const id = scan?.run_id;
  const count = scan?.result_count;
  const compact = String(date).replace(/\D/g, "");
  const sameCount = (value) => Number.isInteger(count) && count >= 0 && value !== undefined && value !== null && Number(value) === count;
  add(Boolean(id) && scan?.trade_date === date, "scanner_identity_mismatch");
  add(scan?.ok === true && scan?.apply === true, "scanner_not_applied_complete");
  add(tri?.complete === true && tri?.status === "complete", "tri_surface_not_complete");
  add(tri?.runId === id && [tri?.desktopRunId, tri?.mobileRunId, tri?.scorecardRunId].every(x => x === id), "tri_surface_run_id_mismatch");
  add(String(tri?.expectedDate).replace(/\D/g, "") === compact && sameCount(tri?.count), "tri_surface_date_or_count_mismatch");
  add(collection?.ok === true && collection?.blobPublished === true && collection?.tradeDate === date, "scorecard_collection_not_published");
  const report = collection?.reports?.find(x => x.key === "strategy3");
  const currentReport = current?.sourceReports?.find(x => x.key === "strategy3");
  for (const [name, row] of [["collection", report], ["current", currentReport]]) {
    add(row?.ok === true && row?.runId === id && sameCount(row?.count) && (row?.tradeDate || row?.date) === date, `scorecard_${name}_mismatch`);
  }
  const rows = (current?.records || []).filter(x => x.strategy === "策略3隔日沖成績單" && x.record_date === date);
  const expected = (scan?.results || []).map(x => String(x.code || x.symbol)).sort();
  const actual = rows.map(x => String(x.ticker || x.code || x.symbol)).sort();
  add(sameCount(expected.length) && sameCount(actual.length) && new Set(actual).size === actual.length && JSON.stringify(actual) === JSON.stringify(expected), "scorecard_result_set_mismatch");
  add(ui?.ok === true && ["desktop", "mobile", "scorecard"].every(kind => ui?.results?.some(row =>
    row.kind === kind && row.routeKey === "strategy3" && row.ok === true
    && row.accessState !== "membership_locked" && row.contentAcceptance?.actualRun === id
    && JSON.stringify(row.contentAcceptance?.actualSymbols) === JSON.stringify(expected)
    && row.contentAcceptance?.sameSymbols === true)), "rendered_ui_evidence_missing_or_mismatched");
  add(line?.ok === true && line?.run_id === id && sameCount(line?.count) && String(line?.date).replace(/\D/g, "") === compact, "line_identity_or_count_mismatch");
  add(line?.line_push_personal_ok === true && line?.line_push_group_ok === true, "line_targets_incomplete");
  add(["personal", "group"].every(type => line?.delivery_evidence?.some(x => x.target_type === type && x.sent === true)), "line_delivery_evidence_missing");
  return { ok: !issues.length, issues, firstBlocker: issues[0] || null };
}

module.exports = { verifyDelivery };
