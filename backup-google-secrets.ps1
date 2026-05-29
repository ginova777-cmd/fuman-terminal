param(
  [string]$RuntimeSecretsDir = "C:\fuman-runtime\secrets",
  [string]$DestinationDir = "$env:USERPROFILE\OneDrive\Desktop\fuman-secrets-backups"
)

$ErrorActionPreference = "Stop"

$files = @(
  "google-oauth-client.json",
  "google-sheets-token.json",
  "google-sheets-token.backup.json"
)

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $DestinationDir "google-secrets-$timestamp"
$manifestPath = Join-Path $backupDir "manifest.txt"

if (-not (Test-Path -Path $RuntimeSecretsDir)) {
  throw "Runtime secrets directory not found: $RuntimeSecretsDir"
}

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$manifest = @(
  "Fuman Google secrets backup",
  "createdAt=$((Get-Date).ToString('s'))",
  "source=$RuntimeSecretsDir",
  "destination=$backupDir",
  ""
)

foreach ($name in $files) {
  $source = Join-Path $RuntimeSecretsDir $name
  if (-not (Test-Path -Path $source)) {
    $manifest += "missing $name"
    continue
  }
  $target = Join-Path $backupDir $name
  Copy-Item -Path $source -Destination $target -Force
  $hash = Get-FileHash -Algorithm SHA256 -Path $target
  $manifest += "copied $name sha256=$($hash.Hash)"
}

Get-ChildItem -Path $RuntimeSecretsDir -Filter "google-sheets-token.backup-*.json" -File | Sort-Object LastWriteTime -Descending | Select-Object -First 3 | ForEach-Object {
  $target = Join-Path $backupDir $_.Name
  Copy-Item -Path $_.FullName -Destination $target -Force
  $hash = Get-FileHash -Algorithm SHA256 -Path $target
  $manifest += "copied $($_.Name) sha256=$($hash.Hash)"
}

$manifest | Set-Content -Path $manifestPath -Encoding utf8

Write-Host "Google secrets backup written:"
Write-Host $backupDir
