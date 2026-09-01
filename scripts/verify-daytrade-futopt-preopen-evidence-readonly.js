const fs = require("fs");
const path = require("path");

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const REQUIRED_SLOTS = ["0845", "0850"];
const TIMEOUT_MS = Math.max(3000, Number(process.env.DAYTRADE_SUPABASE_READ_TIMEOUT_MS || 10000));

function readText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const KEY = process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || readText(path.join(RUNTIME_DIR, "secrets", "supabase-service-role-key.txt"))
  || readText(path.join(RUNTIME_DIR, "secrets", "supabase-anon-key.txt"));

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function symbolsArg() {
  return String(arg("symbols", "")).split(/[,+]/).map((value) => value.replace(/\D/g, "").slice(0, 4)).filter((value) => /^\d{4}$/.test(value));
}

async function readView(view, select, tradeDate, symbols = []) {
  if (!KEY) throw new Error("missing_supabase_read_key");
  const params = new URLSearchParams({ select, trade_date: `eq.${tradeDate}`, limit: "5000" });
  if (symbols.length) {
    const field = view === "v_fugle_daytrade_near_one_contract" ? "symbol" : "underlying_symbol";
    params.set(field, `in.(${symbols.join(",")})`);
  }
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${view}?${params}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${view}_HTTP_${response.status}:${body.slice(0, 240)}`);
  return body ? JSON.parse(body) : [];
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}
function verifyFutoptTimestampParserGuard() {
  const scripts = [
    path.join(RUNTIME_DIR, "ops", "Ensure-DaytradeFutoptCollector0835.ps1"),
    path.join(RUNTIME_DIR, "ops", "Run-DaytradeFutoptPreopenEvidence.ps1"),
  ];
  return scripts.map((file) => {
    const text = readText(file);
    const ok = Boolean(
      text.includes("function Convert-FutoptStatusTimeUtc")
      && text.includes("ConvertFrom-Json -DateKind String")
      && text.includes("AssumeUniversal")
      && text.includes("AdjustToUniversal")
      && text.includes("updated_at_utc")
      && !text.includes("[DateTimeOffset]::Parse([string]$status.updatedAt)")
    );
    return { file, ok };
  });
}

async function main() {
  const tradeDate = arg("trade-date", taipeiDate());
  const requestedSymbols = symbolsArg();
  const failures = [];
  const output = {
    ok: false,
    contract: "daytrade_futopt_preopen_formal_evidence_v1",
    trade_date: tradeDate,
    checked_at: new Date().toISOString(),
    evidence_window: "08:45-08:50 Asia/Taipei",
    required_slots: REQUIRED_SLOTS,
    field_contract: {
      near_one: {
        view: "v_fugle_daytrade_near_one_contract",
        required_fields: ["trade_date", "symbol", "fut_contract", "contract_month", "expiry_date", "is_near_one", "resolved_at", "source"],
      },
      trial_and_basis: {
        view: "v_fugle_daytrade_preopen_snapshot_contract",
        required_fields: ["trade_date", "capture_slot", "underlying_symbol", "fut_contract", "expiry_date", "captured_at", "fut_price", "fut_change_pct", "fut_volume", "trial_price", "trial_change_pct", "best_bid", "best_ask", "bid_ask_ratio", "natural_schedule_evidence", "source"],
        derived_fields: ["basis", "basis_percent", "basis_direction"],
      },
      inverse_convergence: {
        view: "v_fugle_daytrade_inverse_convergence",
        required_fields: ["trade_date", "underlying_symbol", "snapshot_count", "natural_schedule_evidence", "basis_status", "inverse_convergence"],
      },
    },
    requested_symbols: requestedSymbols,
    source_a_allowed: false,
    unattended_yes_allowed: false,
    evidence: {},
    cases: {},
    failed_checks: failures,
    script_contract: {
      futopt_timestamp_parser_guard_v1: [],
    },
  };
  const parserGuard = verifyFutoptTimestampParserGuard();
  output.script_contract.futopt_timestamp_parser_guard_v1 = parserGuard;
  for (const guard of parserGuard) {
    if (!guard.ok) failures.push("futopt_timestamp_utc_parser_guard_missing:" + path.basename(guard.file));
  }
  try {
    const [nearRows, snapshotRows, inverseRows] = await Promise.all([
      readView("v_fugle_daytrade_near_one_contract", "trade_date,symbol,fut_contract,contract_month,expiry_date,is_near_one,resolved_at,source", tradeDate, requestedSymbols),
      readView("v_fugle_daytrade_preopen_snapshot_contract", "trade_date,capture_slot,underlying_symbol,fut_contract,expiry_date,captured_at,fut_price,fut_change_pct,fut_volume,trial_price,trial_change_pct,best_bid,best_ask,bid_ask_ratio,natural_schedule_evidence,source", tradeDate, requestedSymbols),
      readView("v_fugle_daytrade_inverse_convergence", "trade_date,underlying_symbol,snapshot_count,natural_schedule_evidence,basis_status,inverse_convergence", tradeDate, requestedSymbols),
    ]);
    const nearBySymbol = new Map(nearRows.map((row) => [String(row.symbol || ""), row]));
    const inverseBySymbol = new Map(inverseRows.map((row) => [String(row.underlying_symbol || ""), row]));
    const snapshotsBySymbol = new Map();
    for (const row of snapshotRows) {
      const symbol = String(row.underlying_symbol || "");
      if (!snapshotsBySymbol.has(symbol)) snapshotsBySymbol.set(symbol, new Map());
      snapshotsBySymbol.get(symbol).set(String(row.capture_slot || ""), row);
    }
    const symbols = requestedSymbols.length ? requestedSymbols : unique([...nearBySymbol.keys(), ...snapshotsBySymbol.keys(), ...inverseBySymbol.keys()]);
    const positiveSymbols = [];
    const negativeSymbols = [];
    const flatSymbols = [];
    let nearReady = 0;
    let trialReady = 0;
    let inverseReady = 0;
    for (const symbol of symbols) {
      const near = nearBySymbol.get(symbol) || null;
      const slotMap = snapshotsBySymbol.get(symbol) || new Map();
      const inverse = inverseBySymbol.get(symbol) || null;
      const slots = REQUIRED_SLOTS.map((slot) => {
        const row = slotMap.get(slot) || null;
        const futPrice = number(row?.fut_price);
        const trialPrice = number(row?.trial_price);
        const basis = futPrice !== null && trialPrice !== null ? futPrice - trialPrice : null;
        const basisPercent = basis !== null && trialPrice ? basis / trialPrice * 100 : null;
        return {
          capture_slot: slot,
          present: Boolean(row),
          natural_schedule_evidence: row?.natural_schedule_evidence === true,
          fut_price: futPrice,
          trial_price: trialPrice,
          formal_future_ready: futPrice !== null && futPrice > 0,
          trial_match_ready: Boolean(row) && row.natural_schedule_evidence === true && futPrice !== null && futPrice > 0 && trialPrice !== null && trialPrice > 0,
          basis: basis === null ? null : Number(basis.toFixed(4)),
          basis_percent: basisPercent === null ? null : Number(basisPercent.toFixed(6)),
          basis_direction: basis === null ? "UNKNOWN" : basis > 0 ? "POSITIVE" : basis < 0 ? "NEGATIVE" : "FLAT",
        };
      });
      const nearOneReady = Boolean(near?.is_near_one === true && near?.fut_contract && near?.expiry_date);
      const trialMatchReady = slots.every((row) => row.trial_match_ready);
      const basis0845 = slots.find((row) => row.capture_slot === "0845")?.basis;
      const basis0850 = slots.find((row) => row.capture_slot === "0850")?.basis;
      const snapshotInverseConvergence = basis0845 !== null && basis0850 !== null
        && basis0845 < 0 && basis0850 < 0 && Math.abs(basis0850) < Math.abs(basis0845);
      const inverseConvergenceReady = Boolean(inverse?.basis_status === "READY" && inverse?.natural_schedule_evidence === true)
        || snapshotInverseConvergence;
      if (nearOneReady) nearReady += 1;
      if (trialMatchReady) trialReady += 1;
      if (inverseConvergenceReady) inverseReady += 1;
      const directions = unique(slots.map((row) => row.basis_direction));
      if (directions.includes("POSITIVE")) positiveSymbols.push(symbol);
      if (directions.includes("NEGATIVE")) negativeSymbols.push(symbol);
      if (directions.includes("FLAT")) flatSymbols.push(symbol);
      output.cases[symbol] = {
        near_one: near,
        near_one_ready: nearOneReady,
        trial_match_ready: trialMatchReady,
        slots,
        inverse_convergence: inverse,
        inverse_convergence_ready: inverseConvergenceReady,
      };
      if (!nearOneReady) failures.push(`near_one_incomplete:${symbol}`);
      for (const row of slots) {
        if (!row.present) failures.push(`preopen_slot_missing:${symbol}:${row.capture_slot}`);
        else if (!row.natural_schedule_evidence) failures.push(`natural_schedule_evidence_false:${symbol}:${row.capture_slot}`);
        if (!row.trial_match_ready) failures.push(`trial_match_incomplete:${symbol}:${row.capture_slot}`);
        if (!row.formal_future_ready) failures.push(`future_price_nonpositive_or_missing:${symbol}:${row.capture_slot}`);
      }
      // Inverse convergence is a signal subtype, not a source-wide completeness requirement.
    }
    if (!symbols.length) failures.push("futopt_preopen_symbols_missing");
    output.evidence = {
      near_one: { total_symbols: symbols.length, ready_symbols: nearReady, ready: symbols.length > 0 && nearReady === symbols.length },
      trial_match: { total_symbols: symbols.length, ready_symbols: trialReady, ready: symbols.length > 0 && trialReady === symbols.length },
      positive_basis: { symbol_count: unique(positiveSymbols).length, symbols: unique(positiveSymbols) },
      negative_basis: { symbol_count: unique(negativeSymbols).length, symbols: unique(negativeSymbols) },
      flat_basis: { symbol_count: unique(flatSymbols).length, symbols: unique(flatSymbols) },
      inverse_convergence: { total_symbols: symbols.length, ready_symbols: inverseReady, ready: symbols.length > 0 && inverseReady === symbols.length },
    };
  } catch (error) {
    failures.push(`readback_failed:${error?.message || String(error)}`);
  }
  output.first_blocker = failures[0] || null;
  output.ok = failures.length === 0;
  output.source_a_allowed = output.ok;
  output.unattended_yes_allowed = output.ok;
  output.reason_code = output.ok ? "futopt_preopen_formal_evidence_ready" : "futopt_preopen_formal_evidence_incomplete";
  console.log(JSON.stringify(output, null, 2));
  process.exitCode = output.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, source_a_allowed: false, unattended_yes_allowed: false, reason_code: "futopt_preopen_verifier_error", error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});



