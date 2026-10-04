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
$selection = $rotation.Find({ param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$transportStamp' }, $true)
if (-not $selection) { throw 'Missing transport timestamp selection' }
foreach ($mode in @('json', 'string', 'offset', 'local')) {
  foreach ($age in @(30, 350)) {
    $instant = [DateTimeOffset]::UtcNow.AddSeconds(-$age)
    $value = switch ($mode) {
      'json' { ('{"at":"' + $instant.ToString('yyyy-MM-ddTHH:mm:ss.fffZ') + '"}' | ConvertFrom-Json).at }
      'string' { $instant.ToString('o') }
      'offset' { $instant.ToOffset([TimeSpan]::FromHours(8)) }
      'local' { $instant.LocalDateTime }
    }
    foreach ($useTransport in @($false,$true)) {
      $current = @{lastMessageAt=$value}
      if ($useTransport) { $current.transportHealth=@{last_transport_at=$value};$current.lastMessageAt='2000-01-01T00:00:00Z' }
      Invoke-Expression $selection.Extent.Text
      Invoke-Expression $check.Extent.Text
      if ($streamStale -ne ($age -gt 300)) { throw "Incorrect rotation decision: $mode age=$age transport=$useTransport" }
    }
  }
}
$current = @{lastMessageAt='invalid'}
Invoke-Expression $selection.Extent.Text
Invoke-Expression $check.Extent.Text
if (-not $streamStale) { throw 'Invalid time must fail closed' }
Write-Output 'PASS: actual rotation condition handles JSON DateTime, ISO string, offset/local time, true expiry and invalid time'
