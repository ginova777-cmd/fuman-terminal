const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");

const EXPECTED_TABLES = [
  "fugle_intraday_1m",
  "fugle_preopen_snapshot_history",
];

function assertNumberLike(value) {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
}

async function fetchRows(table, select, query = "") {
  const url = serverSupabaseUrl();
  const key = serverSupabaseKey();
  if (!url || !key) throw new Error("missing Supabase credentials");
  const endpoint = `${url}/rest/v1/${table}?select=${encodeURIComponent(select)}${query ? `&${query}` : ""}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${table} HTTP ${response.status}: ${text.slice(0, 320)}`);
    const rows = JSON.parse(text || "[]");
    return Array.isArray(rows) ? rows : [];
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const rows = await fetchRows(
    "v_fuman_cost_governance_audit_status",
    [
      "table_name",
      "ran_at",
      "keep_policy",
      "keep_from_date",
      "deleted_rows",
      "before_rows",
      "after_rows",
      "before_total_bytes",
      "after_total_bytes",
      "before_total_size",
      "after_total_size",
      "has_before_after_audit",
      "audit_payload",
    ].join(","),
    "order=table_name.asc"
  );

  const issues = [];
  const evidence = {};
  for (const table of EXPECTED_TABLES) {
    const row = rows.find((item) => item.table_name === table);
    if (!row) {
      issues.push(`${table}: latest audit row missing`);
      continue;
    }
    evidence[table] = row;
    if (row.has_before_after_audit !== true) issues.push(`${table}: has_before_after_audit must be true`);
    if (row.keep_policy !== "keep 3 days") issues.push(`${table}: keep_policy must be keep 3 days`);
    if (!assertNumberLike(row.before_rows)) issues.push(`${table}: before_rows missing`);
    if (!assertNumberLike(row.after_rows)) issues.push(`${table}: after_rows missing`);
    if (!assertNumberLike(row.before_total_bytes)) issues.push(`${table}: before_total_bytes missing`);
    if (!assertNumberLike(row.after_total_bytes)) issues.push(`${table}: after_total_bytes missing`);
    const payload = row.audit_payload && typeof row.audit_payload === "object" ? row.audit_payload : {};
    if (payload.auditContract !== "cost-governance-before-after-v1") {
      issues.push(`${table}: audit_payload.auditContract must be cost-governance-before-after-v1`);
    }
  }

  const result = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    contract: "cost-governance-before-after-v1",
    source: "v_fuman_cost_governance_audit_status",
    expectedTables: EXPECTED_TABLES,
    issues,
    evidence,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    checkedAt: new Date().toISOString(),
    contract: "cost-governance-before-after-v1",
    error: error.message,
  }, null, 2));
  process.exit(1);
});
