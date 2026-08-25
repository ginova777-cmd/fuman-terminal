param(
  [string]$TradeDate = "",
  [int]$Limit = 1600,
  [switch]$WaitUntil0840,
  [string]$TerminalDir = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime"
)

$ErrorActionPreference = "Stop"

function Resolve-NodeExe {
  $preferred = "C:\Program Files\nodejs\node.exe"
  if (Test-Path -LiteralPath $preferred) { return $preferred }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  throw "node_exe_missing"
}
function Get-TaipeiNow {
  $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
  return [System.TimeZoneInfo]::ConvertTimeFromUtc((Get-Date).ToUniversalTime(), $tz)
}

function Wait-UntilTaipeiTime {
  param([string]$HHmmss)
  while ($true) {
    $now = Get-TaipeiNow
    $target = Get-Date -Date ($now.ToString("yyyy-MM-dd") + " " + $HHmmss)
    if ($now -ge $target) { return }
    $seconds = [Math]::Min(60, [Math]::Max(1, [int]($target - $now).TotalSeconds))
    Write-Host ("waiting_until_taipei now={0} target={1} sleep_seconds={2}" -f $now.ToString("HH:mm:ss"), $target.ToString("HH:mm:ss"), $seconds)
    Start-Sleep -Seconds $seconds
  }
}

function Write-JsonFile {
  param([string]$Path, [object]$Payload)
  $dir = Split-Path -Parent $Path
  if (!(Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $Payload | ConvertTo-Json -Depth 80 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Read-JsonFile {
  param([string]$Path)
  if (!(Test-Path -LiteralPath $Path)) { return $null }
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

if (!$TradeDate) { $TradeDate = (Get-TaipeiNow).ToString("yyyy-MM-dd") }
if ($Limit -lt 1600) { Write-Host ("[0840] ignore user Limit={0}; use full opening watchlist limit=1600" -f $Limit); $Limit = 1600 }
if ($WaitUntil0840) { Wait-UntilTaipeiTime -HHmmss "08:40:00" }

$compactDate = $TradeDate -replace "[^\d]", ""
$outDir = Join-Path $RuntimeDir "data\opening-limit-order"
$preCandidatesPath = Join-Path $outDir ("opening-limit-order-0840-pre-candidates-{0}.json" -f $compactDate)
$futoptReadbackPath = Join-Path $outDir ("opening-limit-order-0845-futopt-readback-{0}.json" -f $compactDate)
$rankedPath = Join-Path $outDir ("opening-limit-order-0855-ranked-watchlist-{0}.json" -f $compactDate)
$preflightPath = Join-Path $outDir ("opening-limit-order-0850-preflight-{0}.json" -f $compactDate)
$watchlistPath = Join-Path $outDir ("opening-limit-order-0855-watchlist-{0}.json" -f $compactDate)
$summaryPath = Join-Path $outDir ("opening-limit-order-0855-summary-{0}.json" -f $compactDate)
$preflightScript = Join-Path $TerminalDir "ops\Run-OpeningLimitOrder0850PreflightReadonly.ps1"
$observeScript = Join-Path $TerminalDir "ops\Run-OpeningLimitOrder0855Readonly.ps1"
$verifierScript = Join-Path $TerminalDir "ops\Run-OpeningLimitOrder0900Verifier.ps1"
$morningReceiptPath = Join-Path $outDir ("opening-limit-order-morning-readonly-{0}.json" -f $compactDate)
$verifierReceiptPath = Join-Path $outDir ("opening-limit-order-0900-verifier-{0}.json" -f $compactDate)

if (!(Test-Path -LiteralPath $TerminalDir)) { throw "terminal_dir_missing:$TerminalDir" }
if (!(Test-Path -LiteralPath $preflightScript)) { throw "opening_limit_order_0850_script_missing:$preflightScript" }
if (!(Test-Path -LiteralPath $observeScript)) { throw "opening_limit_order_0855_script_missing:$observeScript" }
if (!(Test-Path -LiteralPath $verifierScript)) { throw "opening_limit_order_0900_verifier_script_missing:$verifierScript" }

Push-Location $TerminalDir
try {
  $nodeExe = Resolve-NodeExe
  $calendarText = ((& $nodeExe "scripts\check-market-calendar-action.js" "--date=$TradeDate" "--label=OpeningLimitOrder0840" 2>&1) | Out-String).Trim()
  $calendarExitCode = $LASTEXITCODE
  try { $calendar = $calendarText | ConvertFrom-Json } catch { $calendar = $null }
  if (!$calendar) {
    $receipt = [ordered]@{
      ok = $false; contract = "opening_limit_order_0840_progressive_readonly_v1"; trade_date = $TradeDate
      checked_at = (Get-Date).ToUniversalTime().ToString("o"); phase = "0840_pre_candidates"; status = "BLOCKED_CALENDAR"
      first_blocker = "market_calendar_unreadable"; reason_code = "market_calendar_unreadable"; calendar_exit_code = $calendarExitCode; calendar_raw = $calendarText
      uses_0900_data = $false
      action_guard = [ordered]@{ creates_order = $false; creates_formal_candidate = $false; publish_allowed = $false; requires_second_confirm_before_action = $true }
      formal_candidate_count = 0; formal_candidate_allowed = $false; publish_allowed = $false
    }
    Write-JsonFile -Path $preCandidatesPath -Payload $receipt
    $receipt | ConvertTo-Json -Depth 80
    exit 1
  }

  if ($calendar.marketOpen -ne $true -or $calendar.marketDate -ne $TradeDate) {
    $receipt = [ordered]@{
      ok = $true; contract = "opening_limit_order_0840_progressive_readonly_v1"; trade_date = $TradeDate
      checked_at = (Get-Date).ToUniversalTime().ToString("o"); phase = "0840_pre_candidates"; status = "SKIP_NON_TRADING_DAY"
      market_calendar = $calendar; first_blocker = "market_calendar_non_trading_day"; reason_code = "market_calendar_non_trading_day"
      uses_0900_data = $false
      action_guard = [ordered]@{ creates_order = $false; creates_formal_candidate = $false; publish_allowed = $false; requires_second_confirm_before_action = $true }
      formal_candidate_count = 0; formal_candidate_allowed = $false; publish_allowed = $false
    }
    Write-JsonFile -Path $preCandidatesPath -Payload $receipt
    $receipt | ConvertTo-Json -Depth 80
    exit 0
  }

  Write-Host ("[0840] progressive opening-entry pre-candidates trade_date={0} limit={1}" -f $TradeDate, $Limit)
  & "C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -ExecutionPolicy Bypass -File $preflightScript -TradeDate $TradeDate -Limit $Limit -TerminalDir $TerminalDir -RuntimeDir $RuntimeDir
  $preflightExit = $LASTEXITCODE
  $preflight = Read-JsonFile -Path $preflightPath
  $watchlist = Read-JsonFile -Path $watchlistPath
  $preCandidateSymbols = @()
  if ($watchlist -and $watchlist.symbols) { $preCandidateSymbols = @($watchlist.symbols) }

  $preReceipt = [ordered]@{
    ok = ($preflightExit -eq 0 -and $preflight -and $preflight.ok -eq $true -and $watchlist -and [int]$watchlist.symbol_count -eq [int]$watchlist.full_symbol_count)
    contract = "opening_limit_order_0840_progressive_readonly_v1"
    trade_date = $TradeDate
    checked_at = (Get-Date).ToUniversalTime().ToString("o")
    phase = "0840_pre_candidates"
    detection_window = "08:40-08:45"
    static_source = "opening_limit_order_0850_preflight_engine_reused_at_0840"
    uses_0900_data = $false
    source_paths = [ordered]@{ preflight = $preflightPath; watchlist = $watchlistPath }
    symbol_count = $preCandidateSymbols.Count
    preview_symbols = @($preCandidateSymbols | Select-Object -First 30)
    opening_report_files_accepted = $preflight.static_prefilter.opening_report_files_accepted
    opening_report_mapped_symbol_count = $preflight.static_prefilter.opening_report_mapped_symbol_count
    action_guard = [ordered]@{ creates_order = $false; creates_formal_candidate = $false; publish_allowed = $false; requires_second_confirm_before_action = $true }
    formal_candidate_count = 0
    formal_candidate_allowed = $false
    publish_allowed = $false
    first_blocker = if ($preflightExit -ne 0) { "0850_preflight_failed" } elseif (!$preflight) { "0850_preflight_missing" } elseif (!$watchlist) { "0855_watchlist_missing" } else { $null }
  }
  Write-JsonFile -Path $preCandidatesPath -Payload $preReceipt
  if ($preReceipt.ok -ne $true) { $preReceipt | ConvertTo-Json -Depth 80; exit 1 }

  $scanReceiptDir = Join-Path $RuntimeDir "data\scan-receipts"
  $futoptSlotPaths = [ordered]@{
    "0845" = Join-Path $scanReceiptDir ("daytrade-futopt-preopen-evidence-0845-{0}.json" -f $compactDate)
    "0850" = Join-Path $scanReceiptDir ("daytrade-futopt-preopen-evidence-0850-{0}.json" -f $compactDate)
  }
  $futoptSlots = [ordered]@{}
  foreach ($slot in @("0845", "0850")) {
    # Natural evidence is read only after its scheduled capture slot exists.
    Wait-UntilTaipeiTime -HHmmss ("{0}:00" -f $slot)
    $slotPath = $futoptSlotPaths[$slot]
    $slotReceipt = Read-JsonFile -Path $slotPath
    $slotOk = ($slotReceipt -and $slotReceipt.ok -eq $true)
    $futoptSlots[$slot] = [ordered]@{
      path = $slotPath
      readable = [bool]$slotReceipt
      ok = [bool]$slotOk
      first_blocker = if ($slotReceipt -and $slotReceipt.first_blocker) { $slotReceipt.first_blocker } elseif (!$slotReceipt) { "slot_receipt_missing" } else { $null }
      reason_code = if ($slotReceipt -and $slotReceipt.reason_code) { $slotReceipt.reason_code } elseif (!$slotReceipt) { "slot_receipt_missing" } else { $null }
      checked_at = if ($slotReceipt) { $slotReceipt.checked_at } else { $null }
      near_one_total_symbols = if ($slotReceipt -and $slotReceipt.near_one) { $slotReceipt.near_one.total_symbols } else { $null }
      trial_match_total_symbols = if ($slotReceipt -and $slotReceipt.trial_match) { $slotReceipt.trial_match.total_symbols } else { $null }
      positive_basis_symbol_count = if ($slotReceipt -and $slotReceipt.positive_basis) { $slotReceipt.positive_basis.symbol_count } else { $null }
    }
  }
  $futoptEvidenceOk = ($futoptSlots["0845"].ok -eq $true -and $futoptSlots["0850"].ok -eq $true)
  $futoptBlockers = @($futoptSlots.GetEnumerator() | Where-Object { $_.Value.ok -ne $true } | ForEach-Object {
    "{0}:{1}" -f $_.Key, $(if ($_.Value.first_blocker) { $_.Value.first_blocker } else { "futopt_slot_not_ok" })
  })
  $futoptReceipt = [ordered]@{
    ok = $true
    evidence_ok = $futoptEvidenceOk
    contract = "opening_limit_order_0845_futopt_readback_v2"
    trade_date = $TradeDate
    checked_at = (Get-Date).ToUniversalTime().ToString("o")
    phase = "0845_0850_futopt_trial_readback"
    futopt_detection_window = "08:45-08:50"
    uses_0900_data = $false
    status = if ($futoptEvidenceOk) { "READY_FOR_0855_RANKING" } else { "FUTOPT_PREOPEN_EVIDENCE_DEGRADED" }
    allowed_action = if ($futoptEvidenceOk) { "apply_futopt_trial_weight" } else { "rank_without_futopt_trial_weight" }
    readback_source = "daytrade_futopt_preopen_natural_receipts"
    slot_receipts = $futoptSlots
    slot_paths = $futoptSlotPaths
    first_blocker = if ($futoptEvidenceOk) { $null } elseif ($futoptBlockers.Count -gt 0) { $futoptBlockers[0] } else { "futopt_preopen_evidence_missing" }
    reason_code = if ($futoptEvidenceOk) { "futopt_preopen_evidence_ready" } else { "futopt_preopen_evidence_degraded" }
    action_guard = [ordered]@{ creates_order = $false; creates_formal_candidate = $false; publish_allowed = $false; requires_second_confirm_before_action = $true }
    formal_candidate_count = 0
    formal_candidate_allowed = $false
    publish_allowed = $false
  }
  Write-JsonFile -Path $futoptReadbackPath -Payload $futoptReceipt

  Wait-UntilTaipeiTime -HHmmss "08:55:00"
  Write-Host ("[0855] progressive final ranked watchlist trade_date={0}" -f $TradeDate)
  & "C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -ExecutionPolicy Bypass -File $observeScript -TradeDate $TradeDate -Limit $Limit -TerminalDir $TerminalDir -RuntimeDir $RuntimeDir
  $observeExit = $LASTEXITCODE
  $summary = Read-JsonFile -Path $summaryPath
  $rankedRows = @()
  if ($summary -and $summary.candidates) {
    $rankedRows = @($summary.candidates | ForEach-Object {
      [ordered]@{
        rank = $_.rank
        symbol = $_.symbol
        final_score = $_.final_score
        entry_score = $_.entry_score
        matched_rule_count = $_.matched_rule_count
        matched_strategy_numbers = $_.matched_strategy_numbers
        matched_strategy_numbers_text = $_.matched_strategy_numbers_text
        matched_strategy_summary_zh = $_.matched_strategy_summary_zh
        futopt_positive_basis = $_.futopt_positive_basis
        trial_match_ready = $_.trial_match_ready
        inverse_convergence_ready = $_.inverse_convergence_ready
        preferred_broker_top_net_buy = $_.preferred_broker_top_net_buy
        opening_report_rank_tier = $_.opening_report_rank_tier
        opening_report_rank_boost = $_.opening_report_rank_boost
        risk_score = $_.risk_score
        score_components = $_.score_components
      }
    })
  }
  $summaryOk = ($summary -and $summary.ok -eq $true)
  $rankedReceipt = [ordered]@{
    ok = $summaryOk
    contract = "opening_limit_order_0855_ranked_watchlist_v1"
    trade_date = $TradeDate
    checked_at = (Get-Date).ToUniversalTime().ToString("o")
    phase = "0855_weighted_ranked_watchlist"
    ranking_policy = "final_score_desc_then_strategy_count_futopt_broker_report_symbol"
    uses_0900_data = $false
    observe_exit_code = $observeExit
    source_paths = [ordered]@{ pre_candidates = $preCandidatesPath; futopt_readback = $futoptReadbackPath; summary = $summaryPath }
    candidate_count = $rankedRows.Count
    candidates = $rankedRows
    action_guard = if ($summary) { $summary.action_guard } else { [ordered]@{ creates_order = $false; creates_formal_candidate = $false; publish_allowed = $false; requires_second_confirm_before_action = $true } }
    formal_candidate_count = 0
    formal_candidate_allowed = $false
    publish_allowed = $false
    first_blocker = if (!$summary) { "0855_summary_missing" } elseif ($summary.first_blocker) { $summary.first_blocker } else { $null }
  }
  Write-JsonFile -Path $rankedPath -Payload $rankedReceipt
  if ($rankedReceipt.ok -ne $true) {
    $rankedReceipt | ConvertTo-Json -Depth 80
    exit 1
  }

  Wait-UntilTaipeiTime -HHmmss "09:00:00"
  Write-Host ("[0900] progressive verifier readback trade_date={0}" -f $TradeDate)
  $verifierRaw = & "C:\Program Files\PowerShell\7\pwsh.exe" -NoProfile -ExecutionPolicy Bypass -File $verifierScript -TradeDate $TradeDate -TerminalDir $TerminalDir -RuntimeDir $RuntimeDir -NodeExe $nodeExe 2>&1
  $verifierExit = $LASTEXITCODE
  $verifierText = ($verifierRaw | Out-String).Trim()
  $verifierReceipt = Read-JsonFile -Path $verifierReceiptPath
  $morningReceipt = [ordered]@{
    ok = ($verifierExit -eq 0 -and $verifierReceipt -and $verifierReceipt.ok -eq $true)
    contract = "opening_limit_order_morning_readonly_chain_v1"
    trade_date = $TradeDate
    checked_at = (Get-Date).ToUniversalTime().ToString("o")
    phase = "0840_to_0900_opening_entry_readonly_chain"
    source_paths = [ordered]@{
      pre_candidates = $preCandidatesPath
      futopt_readback = $futoptReadbackPath
      ranked_watchlist = $rankedPath
      summary = $summaryPath
      verifier = $verifierReceiptPath
    }
    ranked_candidate_count = $rankedReceipt.candidate_count
    verifier_exit_code = $verifierExit
    verifier_first_blocker = if ($verifierReceipt) { $verifierReceipt.first_blocker } else { "0900_verifier_receipt_missing" }
    verifier_raw_preview = if ($verifierText.Length -gt 1200) { $verifierText.Substring(0, 1200) } else { $verifierText }
    action_guard = $rankedReceipt.action_guard
    formal_candidate_count = 0
    formal_candidate_allowed = $false
    publish_allowed = $false
    first_blocker = if ($verifierExit -ne 0) { "0900_verifier_failed" } elseif (!$verifierReceipt) { "0900_verifier_receipt_missing" } elseif ($verifierReceipt.first_blocker) { $verifierReceipt.first_blocker } else { $null }
    next_phase = "09:00 second-confirm only; no order or formal candidate from morning chain"
  }
  Write-JsonFile -Path $morningReceiptPath -Payload $morningReceipt
  $morningReceipt | ConvertTo-Json -Depth 80
  exit $(if ($morningReceipt.ok -eq $true) { 0 } else { 1 })
} finally {
  Pop-Location
}





