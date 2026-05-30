param(
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Query
)

$ErrorActionPreference = "Stop"
$registryPath = Join-Path $PSScriptRoot "fuman-schedule-registry.json"
$registry = (Get-Content -LiteralPath $registryPath -Raw | ConvertFrom-Json).tasks
$keyword = (($Query -join " ").Trim())

function Convert-CsvTasks {
  $result = schtasks /Query /FO CSV /V
  $csv = $result | ConvertFrom-Csv
  return @($csv | Where-Object { $_.TaskName -like "\Fuman*" })
}

$tasks = Convert-CsvTasks
$items = foreach ($row in $tasks) {
  $standard = $registry | Where-Object { $_.taskName -eq $row.TaskName } | Select-Object -First 1
  [pscustomobject]@{
    排程 = $row.TaskName
    標準名稱 = if ($standard) { "OK" } else { "未列入標準表" }
    中文說明 = if ($standard) { $standard.description } else { "" }
    狀態 = $row.Status
    上次執行 = $row.'Last Run Time'
    下次執行 = $row.'Next Run Time'
    結果碼 = $row.'Last Result'
    執行指令 = $row.'Task To Run'
  }
}

if ($keyword) {
  $needle = $keyword.ToLowerInvariant()
  $registryMatches = @($registry | Where-Object {
    $_.displayName.ToLowerInvariant().Contains($needle) -or
    $_.description.ToLowerInvariant().Contains($needle) -or
    (@($_.aliases) -join " ").ToLowerInvariant().Contains($needle)
  })
  $taskMatches = @($items | Where-Object {
    $_.排程.ToLowerInvariant().Contains($needle) -or $_.中文說明.ToLowerInvariant().Contains($needle)
  })
  if ($registryMatches.Count -and -not $taskMatches.Count) {
    $taskMatches = @($items | Where-Object { $registryMatches.taskName -contains $_.排程 })
  }
  $items = $taskMatches
}

if (-not $items.Count) {
  Write-Host "找不到符合的 Fuman 排程。請用關鍵字，例如：買賣超 0620、權證 2030、PC Sleep。" -ForegroundColor Yellow
  exit 1
}

$items | Sort-Object 排程 | Format-Table -AutoSize -Wrap

