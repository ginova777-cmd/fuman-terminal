$ErrorActionPreference = 'Stop'
$terminalDir = 'C:\fuman-terminal'
$runtimeDir = 'C:\fuman-runtime'
$node = 'C:\Program Files\nodejs\node.exe'
$verifier = Join-Path $terminalDir 'scripts\verify-opening-limit-order-0855-readonly.js'
$tz = [System.TimeZoneInfo]::FindSystemTimeZoneById('Taipei Standard Time')
$tradeDate = [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz).ToString('yyyy-MM-dd')
$compact = $tradeDate.Replace('-', '')
$outDir = Join-Path $runtimeDir 'data\opening-limit-order'
$receiptPath = Join-Path $outDir "opening-limit-order-0900-verifier-$compact.json"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
. (Join-Path $terminalDir 'schedule-guard.ps1')
Invoke-FumanWeekdayGuard -Label 'Opening Limit Order 0900 verifier'
if (!(Test-Path -LiteralPath $node) -or !(Test-Path -LiteralPath $verifier)) { throw 'opening_limit_order_0900_verifier_dependency_missing' }
$output = (& $node --use-system-ca $verifier "--trade-date=$tradeDate" 2>&1 | Out-String).Trim()
$exitCode = $LASTEXITCODE
try { $payload = $output | ConvertFrom-Json } catch { $payload = [pscustomobject]@{ ok = $false; trade_date = $tradeDate; first_blocker = 'opening_limit_order_0900_verifier_output_invalid_json'; raw = $output } }
$payload | Add-Member -NotePropertyName scheduled_runner -NotePropertyValue 'opening_limit_order_0900_verifier_v1' -Force
$payload | Add-Member -NotePropertyName scheduled_at -NotePropertyValue ([DateTimeOffset]::UtcNow.ToString('o')) -Force
$payload | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $receiptPath -Encoding utf8
$payload | ConvertTo-Json -Depth 20
if ($exitCode -ne 0 -or $payload.ok -ne $true) { exit 1 }
exit 0
