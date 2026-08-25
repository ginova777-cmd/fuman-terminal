param(
  [string]$TradeDate = "",
  [int]$Limit = 1600,
  [switch]$WaitUntil0850,
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
  [System.TimeZoneInfo]::ConvertTimeFromUtc((Get-Date).ToUniversalTime(), $tz)
}

function Wait-UntilTaipeiTime {
  param([string]$Time, [string]$Label)
  while ($true) {
    $now = Get-TaipeiNow
    $target = Get-Date -Date ("{0} {1}" -f $now.ToString("yyyy-MM-dd"), $Time)
    if ($now -ge $target) { return }
    Start-Sleep -Seconds ([Math]::Min(60, [Math]::Max(1, [int]($target - $now).TotalSeconds)))
  }
}

function Write-JsonFile {
  param([string]$Path, [object]$Payload)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $Payload | ConvertTo-Json -Depth 80 | Set-Content -LiteralPath $Path -Encoding UTF8
}
function ConvertFrom-JsonOutput {
  param([string]$Text, [string]$Label)
  if (!$Text) { throw ("{0}_no_output" -f $Label) }
  $trimmed = $Text.Trim()
  try {
    return ($trimmed | ConvertFrom-Json)
  } catch {
    $start = $trimmed.IndexOf('{')
    $end = $trimmed.LastIndexOf('}')
    if ($start -ge 0 -and $end -gt $start) {
      $jsonOnly = $trimmed.Substring($start, $end - $start + 1)
      try { return ($jsonOnly | ConvertFrom-Json) } catch {}
    }
    $rawPath = Join-Path $env:TEMP ("{0}-raw-output.txt" -f $Label)
    $trimmed | Set-Content -LiteralPath $rawPath -Encoding UTF8
    throw ("{0}_json_parse_failed raw={1}" -f $Label, $rawPath)
  }
}


function Write-OpeningLimitOrderReadableSummary {
  param([object]$StaticPrefilter)
  if (!$StaticPrefilter -or !$StaticPrefilter.rows) { return }
  $rows = @($StaticPrefilter.rows | Where-Object { $_.status -eq "STATIC_MATCH" -or $_.status -eq "CONDITIONALLY_READY" })
  Write-Host ""
  Write-Host "========== 08:50 開盤入預檢：符合標的 / 符合策略幾 =========="
  if ($rows.Count -eq 0) {
    Write-Host "目前沒有符合靜態條件或待確認條件的標的。"
    return
  }
  foreach ($row in $rows) {
    $matchedNumbers = @($row.static_matched_strategy_numbers | ForEach-Object { "策略{0}" -f $_ }) -join "、"
    $pendingNumbers = @($row.pending_strategy_numbers | ForEach-Object { "策略{0}" -f $_ }) -join "、"
    $matched = @($row.static_matched_strategy_labels | ForEach-Object { $_.display }) -join "；"
    $pending = @($row.pending_strategy_labels | ForEach-Object { $_.display + "（待 " + $_.required_confirmation + "）" }) -join "；"
    Write-Host ("代碼 {0} | {1} | 參考價 {2}" -f $row.symbol, $row.qualified_label, $row.preopen_price_reference)
    if ($matchedNumbers) { Write-Host ("  已符合策略幾：{0}" -f $matchedNumbers) }
    if ($matched) { Write-Host ("  已符合策略名稱：{0}" -f $matched) }
    if ($pendingNumbers) { Write-Host ("  待確認策略幾：{0}" -f $pendingNumbers) }
    if ($pending) { Write-Host ("  待確認策略名稱：{0}" -f $pending) }
  }
  Write-Host "=============================================================="
  Write-Host ""
}
if (!$TradeDate) { $TradeDate = (Get-TaipeiNow).ToString("yyyy-MM-dd") }
if ($Limit -lt 1600) { Write-Host ("[0850] ignore user Limit={0}; use full opening watchlist limit=1600" -f $Limit); $Limit = 1600 }
if ($WaitUntil0850) { Wait-UntilTaipeiTime -Time "08:50:00" -Label "until_0850" }

$compactDate = $TradeDate -replace "[^\d]", ""
$outDir = Join-Path $RuntimeDir "data\opening-limit-order"
$watchlistPath = Join-Path $outDir ("opening-limit-order-0855-watchlist-{0}.json" -f $compactDate)
$preflightPath = Join-Path $outDir ("opening-limit-order-0850-preflight-{0}.json" -f $compactDate)
$sourceCachePath = Join-Path $outDir ("opening-limit-order-0850-static-sources-{0}.json" -f $compactDate)
$runner0855 = Join-Path $TerminalDir "ops\Run-OpeningLimitOrder0855Readonly.ps1"

if (!(Test-Path -LiteralPath $TerminalDir)) { throw "terminal_dir_missing:$TerminalDir" }
if (!(Test-Path -LiteralPath $runner0855)) { throw "opening_limit_order_0855_runner_missing:$runner0855" }

Push-Location $TerminalDir
try {
  $nodeExe = Resolve-NodeExe
  Write-Host ("[0850] build opening-entry watchlist trade_date={0} limit={1}" -f $TradeDate, $Limit)
  $watchlistText = ((& $nodeExe "scripts\build-opening-limit-order-watchlist.js" "--trade-date=$TradeDate" "--limit=$Limit" "--out=$watchlistPath") | Out-String).Trim()
  if (!$watchlistText) { throw "opening_limit_order_0850_watchlist_no_output" }
  $watchlist = ConvertFrom-JsonOutput -Text $watchlistText -Label "opening_limit_order_0850_watchlist"

  # Static daily, institutional, branch-cost, and overnight-style inputs are fetched before 08:55.
  $sourceWarmup = $null
  if ($watchlist.ok -eq $true -and @($watchlist.symbols).Count -gt 0) {
    Write-Host ("[0850] warm static opening sources symbols={0}" -f @($watchlist.symbols).Count)
    $symbolArg = (@($watchlist.symbols) -join ",")
    $warmupRaw = & $nodeExe "scripts\verify-opening-limit-order-candidate-readonly.js" "--trade-date=$TradeDate" "--symbols=$symbolArg" "--warmup-static=true" "--source-cache=$sourceCachePath"
    $warmupExitCode = $LASTEXITCODE
    $warmupText = ($warmupRaw | Out-String).Trim()
    $warmupRequested = @($watchlist.symbols).Count
    $warmupReady = 0
    $warmupFailed = 0
    if ($warmupText -match '"ready"\s*:\s*(\d+)') { $warmupReady = [int]$Matches[1] }
    if ($warmupText -match '"failed"\s*:\s*(\d+)') { $warmupFailed = [int]$Matches[1] }
    if ($warmupReady -le 0 -and (Test-Path -LiteralPath $sourceCachePath)) { $warmupReady = [Math]::Max(0, $warmupRequested - $warmupFailed) }
    $sourceWarmup = [pscustomobject]@{
      ok = ($warmupExitCode -eq 0 -and (Test-Path -LiteralPath $sourceCachePath))
      contract = "opening_limit_order_candidate_gate_v1"
      source_cache_path = $sourceCachePath
      source_cache = [pscustomobject]@{
        requested = $warmupRequested
        ready = $warmupReady
        failed = $warmupFailed
      }
      first_blocker = $null
    }
  }

  $staticPrefilterPath = Join-Path $outDir ("opening-limit-order-0850-static-prefilter-{0}.json" -f $compactDate)
  $staticPrefilter = $null
  if ($sourceWarmup -and $sourceWarmup.ok -eq $true) {
    Write-Host ("[0850] derive static matches for rules 1,2,8 and conditional rules 3,4,10")
    $staticPrefilterText = ((& $nodeExe "scripts\build-opening-limit-order-static-prefilter.js" "--trade-date=$TradeDate" "--source-cache=$sourceCachePath" "--out=$staticPrefilterPath") | Out-String).Trim()
    if (Test-Path -LiteralPath $staticPrefilterPath) { $staticPrefilter = Get-Content -LiteralPath $staticPrefilterPath -Raw | ConvertFrom-Json }
    elseif ($staticPrefilterText) { $staticPrefilter = $staticPrefilterText | ConvertFrom-Json }
    Write-OpeningLimitOrderReadableSummary -StaticPrefilter $staticPrefilter
  }

  $preflight = [ordered]@{
    ok = ($LASTEXITCODE -eq 0 -and $watchlist.ok -eq $true)
    contract = "opening_limit_order_0850_preflight_v1"
    trade_date = $TradeDate
    checked_at = (Get-Date).ToUniversalTime().ToString("o")
    phase = "0850_preopen_watchlist_warmup"
    candidate_deadline = "08:55:00 Asia/Taipei"
    watchlist_path = $watchlistPath
    source_cache_path = $sourceCachePath
    static_prefilter_path = $staticPrefilterPath
    static_prefilter = [ordered]@{
      contract = $staticPrefilter.contract
      static_match_count = $staticPrefilter.static_match_count
      conditional_ready_count = $staticPrefilter.conditional_ready_count
      data_gap_count = $staticPrefilter.data_gap_count
      first_blocker = $staticPrefilter.first_blocker
      opening_report_files_accepted = $staticPrefilter.opening_report_readback.industry_bias_files_accepted
      opening_report_mapped_symbol_count = $staticPrefilter.opening_report_readback.mapped_symbol_count
    }
    watchlist_symbol_count = $watchlist.symbol_count
    watchlist_full_symbol_count = $watchlist.full_symbol_count
    opening_report_run_ids = $watchlist.sources.opening_report.run_ids
    source_warmup = [ordered]@{
      contract = $sourceWarmup.contract
      source_cache_contract = "opening_limit_order_0850_static_sources_v1"
      source_cache_path = $sourceWarmup.source_cache_path
      requested = $sourceWarmup.source_cache.requested
      ready = $sourceWarmup.source_cache.ready
      failed = $sourceWarmup.source_cache.failed
      first_blocker = $sourceWarmup.first_blocker
    }
    action_guard = [ordered]@{
      creates_order = $false
      creates_formal_candidate = $false
      publish_allowed = $false
      requires_second_confirm_before_action = $true
    }
    formal_candidate_count = 0
    formal_candidate_allowed = $false
    publish_allowed = $false
    first_blocker = if ($watchlist.first_blocker) { $watchlist.first_blocker } else { $null }
  }
  Write-JsonFile -Path $preflightPath -Payload $preflight
  if ($preflight.ok -ne $true) { $preflight | ConvertTo-Json -Depth 80; exit 1 }

  # The outer morning runner is the only owner of the 08:55 observation call.
  # Keeping it here would run the candidate phase twice and can cross 09:00.
} finally { Pop-Location }












