param([string]$DateKey=(Get-Date -Format yyyyMMdd),[int]$Top=30)
$ErrorActionPreference='Stop'
# Top remains accepted for compatibility; acceptance renders the complete lists.
$root='C:\fuman-release-owner\fuman-terminal'
Write-Host '全市場開盤空：掃描、來源讀回、分類排序、完整顯示及完成回執'
& node.exe "$root\scripts\run-opening-short-complete.cjs" "--date=$DateKey"
if($LASTEXITCODE -ne 0){throw "OpeningShort complete acceptance failed (exit $LASTEXITCODE)"}
