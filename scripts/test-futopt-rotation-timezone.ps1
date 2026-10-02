$ErrorActionPreference = 'Stop'
$wrapper = Join-Path $PSScriptRoot '..\ops\public-slot\Run-DaytradeSourceWriter.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($wrapper, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Wrapper syntax error' }
$helper = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-IsoAgeSeconds' }, $true)
Invoke-Expression $helper.Extent.Text
$rotation = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-FugleFutoptCollectorReleaseReconcile' }, $true)
$check = $rotation.Find({ param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$streamStale' -and $n.Right.Extent.Text -match 'Get-IsoAgeSeconds' }, $true)
if (-not $check) { throw 'Rotation does not use typed timestamp helper' }
foreach ($mode in @('json', 'string', 'offset', 'local')) {
  foreach ($age in @(30, 350)) {
    $instant = [DateTimeOffset]::UtcNow.AddSeconds(-$age)
    $value = switch ($mode) {
      'json' { ('{"at":"' + $instant.ToString('yyyy-MM-ddTHH:mm:ss.fffZ') + '"}' | ConvertFrom-Json).at }
      'string' { $instant.ToString('o') }
      'offset' { $instant.ToOffset([TimeSpan]::FromHours(8)) }
      'local' { $instant.LocalDateTime }
    }
    $current = @{lastMessageAt=$value}
    Invoke-Expression $check.Extent.Text
    if ($streamStale -ne ($age -gt 300)) { throw "Incorrect rotation decision: $mode age=$age" }
  }
}
$current = @{lastMessageAt='invalid'}
Invoke-Expression $check.Extent.Text
if (-not $streamStale) { throw 'Invalid time must fail closed' }
Write-Output 'PASS: actual rotation condition handles JSON DateTime, ISO string, offset/local time, true expiry and invalid time'
