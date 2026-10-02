$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$writer = Join-Path $root 'ops/public-slot/Run-DaytradeSourceWriter.ps1'
$collector = Join-Path $root 'ops/public-slot/Run-DaytradeWebSocketCollector.ps1'
$writerAst = $null
foreach ($file in @($writer,$collector)) {
  $tokens=$null; $errors=$null
  $ast=[System.Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors)
  if ($errors.Count) { throw ($errors | Out-String) }
  if ($file -eq $writer) { $writerAst=$ast }
}
$function=$writerAst.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-ClosingWaterWindow'},$true)
if (-not $function) { throw 'CLOSING_WINDOW_FUNCTION_MISSING' }
Invoke-Expression $function.Extent.Text
$receiptFunction=$writerAst.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-ClosingWaterSyncReceipt'},$true)
if (-not $receiptFunction) { throw 'SYNC_RECEIPT_VALIDATOR_MISSING' }
Invoke-Expression $receiptFunction.Extent.Text
$started=[DateTimeOffset]::UtcNow.AddMinutes(-2)
$valid=@{ok=$true;mode='apply';trade_date='2026-10-02';checked_at=$started.AddSeconds(1).ToString('o');completed_at=$started.AddSeconds(2).ToString('o')}
if (-not (Test-ClosingWaterSyncReceipt $valid '2026-10-02' $started)) { throw 'CURRENT_SYNC_RECEIPT_REJECTED' }
foreach ($mutation in @(
  @{checked_at=$started.AddMinutes(-1).ToString('o')},
  @{completed_at=$started.AddSeconds(-1).ToString('o')},
  @{completed_at=[DateTimeOffset]::UtcNow.AddMinutes(5).ToString('o')},
  @{checked_at='invalid'}, @{mode='dry_run'}, @{trade_date='2026-10-01'}, @{ok=$false}
)) {
  $bad=$valid.Clone()
  foreach ($key in $mutation.Keys) { $bad[$key]=$mutation[$key] }
  if (Test-ClosingWaterSyncReceipt $bad '2026-10-02' $started) { throw 'BAD_SYNC_RECEIPT_ACCEPTED' }
}
$cases=@(
  @('2026-10-02T13:32:59+08:00',$false),
  @('2026-10-02T13:33:00+08:00',$true),
  @('2026-10-02T13:35:59+08:00',$true),
  @('2026-10-02T13:36:00+08:00',$false),
  @('2026-10-03T13:33:00+08:00',$false),
  @('2026-10-04T13:33:00+08:00',$false),
  @('2026-10-02T05:33:00Z',$true)
)
foreach ($case in $cases) {
  if ((Test-ClosingWaterWindow -Now ([DateTimeOffset]::Parse($case[0]))) -ne $case[1]) { throw ('BOUNDARY_FAILED:'+ $case[0]) }
}
# The real entry rejects incompatible modes before touching runtime or the network.
$invalid = & (Get-Process -Id $PID).Path -NoProfile -File $writer -ClosingWaterOnly 2>&1
if ($LASTEXITCODE -eq 0 -or ($invalid | Out-String) -notmatch 'CLOSING_WATER_MODE_INVALID') { throw 'INVALID_MODE_NOT_REJECTED' }
$text=Get-Content -LiteralPath $writer -Raw
$backoff=$text.IndexOf('STOP database_backoff')
$sync=$text.IndexOf('if ($Apply -and (-not $runCloseout -or $ClosingWaterOnly))')
$finish=$text.IndexOf("CLOSING_WATER_WRITTEN strategies_started=false")
$lease=$text.IndexOf('if (Test-Path -LiteralPath $CrossSessionLockPath)', $sync)
if ($backoff -lt 0 -or $sync -le $backoff -or $finish -le $sync -or $lease -le $finish) { throw 'LOCK_BACKOFF_CLOSING_ORDER_INVALID' }
$collectorText=Get-Content -LiteralPath $collector -Raw
if ([regex]::Matches($collectorText,'TimeSpan\]::Parse\("13:32"\)').Count -ne 2) { throw 'COLLECTOR_GRACE_BOUNDARY_INVALID' }
Write-Output '{"ok":true,"window_cases":7,"sync_receipt_cases":8,"invalid_mode_rejected":true,"powershell_parse":true,"database_calls":0,"natural_closing_acceptance":false}'
