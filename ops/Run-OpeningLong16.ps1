param(
  [string]$DateKey = (Get-Date -Format yyyyMMdd),
  [string]$Output = 'C:\fuman-runtime\outputs\opening-long-market'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$date = $DateKey -replace '^(\d{4})(\d{2})(\d{2})$','$1-$2-$3'

Write-Host '全市場開盤多：正式水源、月線斜率、布林位階、分類、排序與回執'
& node.exe "$root\run-opening-long-complete.cjs" "--date=$date" "--output-root=$Output"
if ($LASTEXITCODE -ne 0) { throw "OpeningLong complete acceptance failed (exit $LASTEXITCODE)" }
