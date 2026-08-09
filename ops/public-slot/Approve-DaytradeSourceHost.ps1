param(
  [string]$RuntimeDir = "C:\fuman-runtime",
  [switch]$ConfirmWriterHost
)

$ErrorActionPreference = "Stop"
if (-not $ConfirmWriterHost) { throw "Refusing to approve a writer host without -ConfirmWriterHost" }
$hostId = [string]$env:COMPUTERNAME
if ([string]::IsNullOrWhiteSpace($hostId)) { throw "COMPUTERNAME is missing" }
$dir = Join-Path $RuntimeDir "config"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$file = Join-Path $dir "daytrade-source-host-approval.json"
[ordered]@{
  contract = "daytrade-source-host-approval-v1"
  approved = $true
  sourceRole = "writer"
  hostId = $hostId
  approvedAt = [DateTimeOffset]::UtcNow.ToString("o")
  policy = "only_this_host_may_run_daytrade_source_writer_apply"
} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $file -Encoding utf8
Write-Output "approved source host: $hostId"
Write-Output "approval file: $file"
