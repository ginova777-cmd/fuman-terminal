$ErrorActionPreference='Stop'
$file=Join-Path $PSScriptRoot '../ops/Run-DaytradeFutoptPreopenEvidence.ps1'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'parse failed'}
$definition=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Write-Receipt'},$true)
Invoke-Expression $definition.Extent.Text
# Invoke the actual receipt writer, redirecting only its output to an isolated file.
$receiptPath=Join-Path ([IO.Path]::GetTempPath()) ('preopen-receipt-test-'+[guid]::NewGuid()+'.json')
$release=[pscustomobject]@{productionRoot='isolated-release';productionHead=('a'*40)}
$tradeDate='2026-09-29';$Slot='0845';$actualSlot='0845'
try {
  Write-Receipt $true 'market_calendar_non_trading_day' 'skipped'
  $receipt=Get-Content -Raw $receiptPath | ConvertFrom-Json
  if($receipt.complete -ne $false -or $receipt.status -ne 'skipped' -or $receipt.exitCode -ne 0){throw 'skip falsely completed'}
  Write-Receipt $true 'preopen_slot_verified_and_published' 'complete'
  $receipt=Get-Content -Raw $receiptPath | ConvertFrom-Json
  if($receipt.complete -ne $true -or $receipt.status -ne 'complete' -or $receipt.release_sha -ne ('a'*40)){throw 'verified complete broken'}
  Write-Receipt $false 'producer_failed' 'producer_failed'
  $receipt=Get-Content -Raw $receiptPath | ConvertFrom-Json
  if($receipt.complete -ne $false -or $receipt.exitCode -ne 1){throw 'failure falsely completed'}
  'PASS actual preopen receipt writer: skipped / verified complete / failed and release identity'
} finally {if(Test-Path -LiteralPath $receiptPath){Remove-Item -LiteralPath $receiptPath}}
