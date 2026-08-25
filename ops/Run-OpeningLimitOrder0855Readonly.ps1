param(
  [string]$TradeDate = "",
  [int]$Limit = 1600,
  [switch]$WaitUntil0855,
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
function Get-TaipeiDate {
  $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
  return [System.TimeZoneInfo]::ConvertTimeFromUtc((Get-Date).ToUniversalTime(), $tz).ToString("yyyy-MM-dd")
}

function Wait-UntilTaipei0855 {
  $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
  while ($true) {
    $now = [System.TimeZoneInfo]::ConvertTimeFromUtc((Get-Date).ToUniversalTime(), $tz)
    $target = Get-Date -Date ($now.ToString("yyyy-MM-dd") + " 08:55:00")
    if ($now -ge $target) { return }
    $seconds = [Math]::Min(60, [Math]::Max(1, [int]($target - $now).TotalSeconds))
    Write-Host ("waiting_until_0855_taipei now={0} target={1} sleep_seconds={2}" -f $now.ToString("HH:mm:ss"), $target.ToString("HH:mm:ss"), $seconds)
    Start-Sleep -Seconds $seconds
  }
}

function Write-JsonFile {
  param([string]$Path, [object]$Payload)
  $dir = Split-Path -Parent $Path
  if (!(Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $Payload | ConvertTo-Json -Depth 80 | Set-Content -LiteralPath $Path -Encoding UTF8
}


function Write-OpeningLimitOrderCandidateSummary {
  param([object[]]$Rows)
  Write-Host ""
  Write-Host "========== 08:55 開盤入觀察候選：符合標的 / 符合策略幾 =========="
  if (!$Rows -or $Rows.Count -eq 0) {
    Write-Host "目前沒有正式觀察候選；不掛單、不 publish。"
    return
  }
  foreach ($row in $Rows) {
    $numbers = @($row.matched_strategy_numbers | ForEach-Object { "策略{0}" -f $_ }) -join "、"
    $labels = @($row.matched_strategy_labels | ForEach-Object { $_.display }) -join "；"
    if (!$numbers) { $numbers = "未回讀策略編號" }
    $brokerRank = if ($row.preferred_broker_top_net_buy -eq $true) { " | 主力第一買超：{0}（淨買 {1}，成本 {2}）" -f $row.preferred_broker_top_net_buy_name, $row.preferred_broker_top_net_buy_net_buy, $row.preferred_broker_top_net_buy_cost_price } else { "" }
    Write-Host ("#{0} | 代碼 {1} | {2} | 符合策略幾：{3} | 總分 {4} | 策略基礎 {5} | 晨報 {6} | 股期 {7} | 產業股期共振 {8} | 風險 {9}{10}" -f $row.rank, $row.symbol, $row.qualified_label, $numbers, $row.entry_score, $row.entry_score_base, $row.opening_report_rank_boost, $row.futures_score, $row.industry_futures_combo_score, $row.risk_score, $brokerRank)
    if ($labels) { Write-Host ("  符合策略名稱：{0}" -f $labels) }
  }
  Write-Host "=================================================================="
  Write-Host ""
}
if (!$TradeDate) {
  $TradeDate = Get-TaipeiDate
}

if ($Limit -lt 1600) { Write-Host ("[0855] ignore user Limit={0}; use full opening watchlist limit=1600" -f $Limit); $Limit = 1600 }
if ($WaitUntil0855) {
  Wait-UntilTaipei0855
}

$compactDate = $TradeDate -replace "[^\d]", ""
$outDir = Join-Path $RuntimeDir "data\opening-limit-order"
$watchlistPath = Join-Path $outDir ("opening-limit-order-0855-watchlist-{0}.json" -f $compactDate)
$preflightPath = Join-Path $outDir ("opening-limit-order-0850-preflight-{0}.json" -f $compactDate)
$candidatePath = Join-Path $outDir ("opening-limit-order-0855-candidates-{0}.json" -f $compactDate)
$summaryPath = Join-Path $outDir ("opening-limit-order-0855-summary-{0}.json" -f $compactDate)
$sourceCachePath = Join-Path $outDir ("opening-limit-order-0850-static-sources-{0}.json" -f $compactDate)

if (!(Test-Path -LiteralPath $TerminalDir)) {
  throw "terminal_dir_missing:$TerminalDir"
}

Push-Location $TerminalDir
try {
  $nodeExe = Resolve-NodeExe
  $watchlist = $null
  $watchlistSource = ""
  $preflight = if (Test-Path -LiteralPath $preflightPath) { Get-Content -LiteralPath $preflightPath -Raw | ConvertFrom-Json } else { $null }
  $preflightValid = (
    $preflight -and
    $preflight.ok -eq $true -and
    $preflight.contract -eq "opening_limit_order_0850_preflight_v1" -and
    $preflight.trade_date -eq $TradeDate -and
    $preflight.watchlist_path -eq $watchlistPath -and
    [int]$preflight.watchlist_symbol_count -eq [int]$preflight.watchlist_full_symbol_count -and
    $preflight.action_guard.creates_order -eq $false -and
    $preflight.action_guard.creates_formal_candidate -eq $false -and
    $preflight.action_guard.publish_allowed -eq $false -and
    (Test-Path -LiteralPath $watchlistPath)
  )
  if ($preflightValid) {
    Write-Host ("[0855] reuse verified 0850 watchlist trade_date={0} limit={1}" -f $TradeDate, $Limit)
    $watchlist = Get-Content -LiteralPath $watchlistPath -Raw | ConvertFrom-Json
    $watchlistSource = "0850_preflight_reused"
  } else {
    # The 08:55 candidate run must use the auditable 08:50 universe, never silently rebuild a different one.
    Write-Host ("[0855] fail-closed: verified 0850 preflight watchlist is unavailable or invalid trade_date={0}" -f $TradeDate)
    $watchlist = [pscustomobject]@{
      ok = $false
      first_blocker = "opening_limit_order_0850_preflight_missing_or_invalid"
      action_guard = [pscustomobject]@{
        creates_order = $false
        creates_formal_candidate = $false
        publish_allowed = $false
        requires_second_confirm_before_action = $true
      }
    }
    $watchlistSource = "0850_preflight_invalid"
  }

  if ($watchlist.ok -ne $true) {
    $summary = [ordered]@{
      ok = $false
      contract = "opening_limit_order_0855_readonly_runner_v1"
      trade_date = $TradeDate
      checked_at = (Get-Date).ToUniversalTime().ToString("o")
      phase = "0855_preopen_candidate_list"
      watchlist_path = $watchlistPath
      preflight_path = $preflightPath
      watchlist_source = $watchlistSource
      candidate_path = $candidatePath
      summary_path = $summaryPath
      first_blocker = if ($watchlist.first_blocker) { $watchlist.first_blocker } else { "watchlist_builder_failed" }
      action_guard = $watchlist.action_guard
    }
    Write-JsonFile -Path $summaryPath -Payload $summary
    $summary | ConvertTo-Json -Depth 80
    exit 1
  }

  $symbols = @($watchlist.symbols | Where-Object { $_ })
  if ($symbols.Count -eq 0) { throw "watchlist_symbols_empty" }

  Write-Host ("[0855] verify opening-limit-order rules symbols={0}" -f $symbols.Count)
  $symbolArg = ($symbols -join ",")
  $candidateRaw = & $nodeExe "scripts\verify-opening-limit-order-candidate-readonly.js" "--trade-date=$TradeDate" "--symbols=$symbolArg" "--source-cache=$sourceCachePath"
  $candidateText = ($candidateRaw | Out-String).Trim()
  if (!$candidateText) { throw "candidate_verifier_no_output" }
  $candidate = $candidateText | ConvertFrom-Json
  $candidateText | Set-Content -LiteralPath $candidatePath -Encoding UTF8

  $rows = @($candidate.rows)
  $candidateRows = @($rows | Where-Object { $_.status -eq "OPEN_LIMIT_ORDER_CANDIDATE" })
  $dataGapRows = @($rows | Where-Object { $_.status -eq "OPEN_LIMIT_ORDER_DATA_GAP" })
  $rejectedRows = @($rows | Where-Object { $_.status -eq "OPEN_LIMIT_ORDER_REJECTED" })

  $guardOk = (
    $candidate.action_guard.creates_order -eq $false -and
    $candidate.action_guard.creates_formal_candidate -eq $false -and
    $candidate.action_guard.publish_allowed -eq $false -and
    $candidate.action_guard.requires_second_confirm_before_action -eq $true
  )

  # The report only ranks already-qualified candidates. It never creates one by itself.
  # User-facing order is weighted score first; report/futures/broker evidence are score context, not hard gates.
  $rankedCandidateRows = @($candidateRows | Sort-Object -Property `
    @{ Expression = { [double]($_.final_score ?? $_.entry_score) }; Descending = $true }, `
    @{ Expression = { [int]($_.matched_rule_count) }; Descending = $true }, `
    @{ Expression = { if ($_.evidence.futopt_positive_basis -eq $true -or $_.evidence.trial_match_ready -eq $true -or $_.evidence.inverse_convergence_ready -eq $true) { 1 } else { 0 } }; Descending = $true }, `
    @{ Expression = { if ($_.evidence.preferred_broker_top_net_buy -eq $true) { 1 } else { 0 } }; Descending = $true }, `
    @{ Expression = {
      $evidence = $_.evidence
      if ($evidence.opening_report_strong_sector_return_1d -eq $true -and $evidence.opening_report_priority_observation -eq $true) { 0 }
      elseif ($evidence.opening_report_strong_sector_return_1d -eq $true) { 1 }
      elseif ($evidence.opening_report_priority_observation -eq $true) { 2 }
      else { 3 }
    }; Ascending = $true }, `
    @{ Expression = { [double]($_.opening_report_rank_boost) }; Descending = $true }, `
    symbol)

  $summaryRows = @(
    for ($index = 0; $index -lt $rankedCandidateRows.Count; $index++) {
      $row = $rankedCandidateRows[$index]
      $evidence = $row.evidence
      $reportTier = if ($evidence.opening_report_strong_sector_return_1d -eq $true -and $evidence.opening_report_priority_observation -eq $true) {
        "日報強勢優先觀察"
      } elseif ($evidence.opening_report_strong_sector_return_1d -eq $true) {
        "日報強勢族群"
      } elseif ($evidence.opening_report_priority_observation -eq $true) {
        "日報優先觀察"
      } else {
        "一般候選"
      }

      [ordered]@{
        rank = $index + 1
        ok = ($row.ok -eq $true)
        symbol = $row.symbol
        status = $row.status
        final_score = $row.entry_score
        entry_score = $row.entry_score
        entry_score_base = $row.entry_score_base
        opening_report_rank_boost = $row.opening_report_rank_boost
        opening_report_rank_tier = $reportTier
        opening_report_rank_tier_sort = if ($reportTier -eq "日報強勢優先觀察") { 0 } elseif ($reportTier -eq "日報強勢族群") { 1 } elseif ($reportTier -eq "日報優先觀察") { 2 } else { 3 }
        preferred_broker_top_net_buy = $evidence.preferred_broker_top_net_buy -eq $true
        preferred_broker_top_net_buy_name = $evidence.preferred_broker_top_net_buy_detail.broker_name
        preferred_broker_top_net_buy_trader_id = $evidence.preferred_broker_top_net_buy_detail.trader_id
        preferred_broker_top_net_buy_rank = $evidence.preferred_broker_top_net_buy_detail.rank
        preferred_broker_top_net_buy_net_buy = $evidence.preferred_broker_top_net_buy_detail.net_buy
        preferred_broker_top_net_buy_cost_price = $evidence.preferred_broker_top_net_buy_detail.cost_price
        preferred_broker_top_net_buy_signal_date = $evidence.daily_signal_date
        preferred_broker_top_net_buy_reason = $evidence.preferred_broker_top_net_buy_detail.reason
        risk_score = $row.risk_score
        qualified_label = $row.qualified_label
        matched_rule_count = $row.matched_rule_count
        candidate_min_matched_rules = $row.candidate_min_matched_rules
        reasons = $row.reasons
        matched_strategy_numbers = $row.matched_strategy_numbers
        matched_strategy_numbers_text = (@($row.matched_strategy_numbers | ForEach-Object { "策略{0}" -f $_ }) -join "、")
        matched_strategy_summary_zh = ((@($row.matched_strategy_labels | ForEach-Object { $_.display })) -join "；")
        matched_strategy_labels = $row.matched_strategy_labels
        main_force_cost_top10 = $evidence.main_force_cost_top10
        close = $evidence.close
        futopt_positive_basis = $evidence.futopt_positive_basis
        futures_score = if ($evidence.futures_score -ne $null) { $evidence.futures_score } else { 0 }
        industry_futures_combo_score = if ($evidence.industry_futures_combo_score -ne $null) { $evidence.industry_futures_combo_score } else { 0 }
        broker_score = if ($evidence.broker_score -ne $null) { $evidence.broker_score } else { 0 }
        trial_match_ready = $evidence.trial_match_ready
        inverse_convergence_ready = $evidence.inverse_convergence_ready
        score_components = if ($evidence.score_components) { $evidence.score_components } else { [ordered]@{ base_score = $row.entry_score_base; opening_report_score = $row.opening_report_rank_boost; futures_score = if ($evidence.futopt_positive_basis -eq $true -or $evidence.trial_match_ready -eq $true -or $evidence.inverse_convergence_ready -eq $true) { 10 } else { 0 }; industry_futures_combo_score = if (($evidence.opening_report_strong_sector_return_1d -eq $true -or $evidence.opening_report_priority_observation -eq $true) -and ($evidence.futopt_positive_basis -eq $true -or $evidence.trial_match_ready -eq $true -or $evidence.inverse_convergence_ready -eq $true)) { 20 } else { 0 }; broker_score = if ($evidence.preferred_broker_top_net_buy -eq $true) { 6 } else { 0 }; risk_penalty = $row.risk_score } }
        opening_report_industry_bias = $evidence.opening_report_industry_bias
        opening_report_priority_observation = $evidence.opening_report_priority_observation
        opening_report_strong_sector_return_1d = $evidence.opening_report_strong_sector_return_1d
        opening_report_industries = $evidence.opening_report_industries
      }
    }
  )

  $summary = [ordered]@{
    ok = ($candidate.ok -eq $true -and $guardOk)
    contract = "opening_limit_order_0855_readonly_runner_v1"
    trade_date = $TradeDate
    checked_at = (Get-Date).ToUniversalTime().ToString("o")
    phase = "0855_preopen_candidate_list"
    watchlist_path = $watchlistPath
    candidate_path = $candidatePath
    summary_path = $summaryPath
    preflight_path = $preflightPath
    watchlist_source = $watchlistSource
    watchlist_symbol_count = $watchlist.symbol_count
    watchlist_full_symbol_count = $watchlist.full_symbol_count
    opening_report_files_accepted = $watchlist.sources.opening_report.files_accepted
    opening_report_run_ids = $watchlist.sources.opening_report.run_ids
    candidate_count = $candidateRows.Count
    preferred_broker_top_net_buy_candidate_count = @($summaryRows | Where-Object { $_.preferred_broker_top_net_buy -eq $true }).Count
    data_gap_count = $dataGapRows.Count
    rejected_count = $rejectedRows.Count
    candidates = $summaryRows
    action_guard = $candidate.action_guard
    guard_ok = $guardOk
    formal_candidate_count = 0
    formal_candidate_allowed = $false
    publish_allowed = $false
    first_blocker = if ($candidate.first_blocker) { $candidate.first_blocker } elseif (!$guardOk) { "action_guard_failed" } else { $null }
    next_phase = "09:00 second-confirm only; no order or formal candidate from 08:55 list"
  }

  Write-JsonFile -Path $summaryPath -Payload $summary
  $preferredBrokerVerifierRaw = & $nodeExe "scripts\verify-opening-limit-order-preferred-broker-readonly.js" "--trade-date=$TradeDate"
  $preferredBrokerVerifierText = ($preferredBrokerVerifierRaw | Out-String).Trim()
  if (!$preferredBrokerVerifierText) { throw "preferred_broker_verifier_no_output" }
  $preferredBrokerVerifier = $preferredBrokerVerifierText | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $preferredBrokerVerifier.ok -ne $true) { throw ("preferred_broker_verifier_failed:{0}" -f $preferredBrokerVerifier.first_blocker) }
  Write-OpeningLimitOrderCandidateSummary -Rows $summaryRows
  $summary | ConvertTo-Json -Depth 80
} finally {
  Pop-Location
}

















