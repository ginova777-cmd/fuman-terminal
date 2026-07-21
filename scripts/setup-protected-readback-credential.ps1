param(
  [string]$Email = "",
  [string]$CredentialFile = "C:\fuman-runtime\secrets\protected-readback-credential.json",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$Installer = Join-Path $RepoRoot "scripts\install-protected-readback-credential.ps1"
if (-not (Test-Path -LiteralPath $Installer)) {
  throw "Missing installer: $Installer"
}

$installArgs = @{
  CredentialFile = $CredentialFile
  StoreEmailPassword = $true
}
if (-not [string]::IsNullOrWhiteSpace($Email)) {
  $installArgs.Email = $Email
}
if ($Force) {
  $installArgs.Force = $true
}

Write-Output "[protected-readback] repo=$RepoRoot"
Write-Output "[protected-readback] credentialFile=$CredentialFile"
Write-Output "[protected-readback] installing runtime credential..."
& $Installer @installArgs

Write-Output "[protected-readback] verifying credential..."
Push-Location $RepoRoot
try {
  npm run verify:protected-readback-credential
} finally {
  Pop-Location
}
