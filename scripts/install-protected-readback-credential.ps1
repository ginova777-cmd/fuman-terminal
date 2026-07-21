param(
  [string]$CredentialFile = "C:\fuman-runtime\secrets\protected-readback-credential.json",
  [string]$BearerToken = "",
  [string]$Email = "",
  [switch]$StoreEmailPassword,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Convert-SecureStringToPlainText {
  param([securestring]$Secure)
  if ($null -eq $Secure) { return "" }
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) } }
}

if ([string]::IsNullOrWhiteSpace($CredentialFile)) {
  throw "CredentialFile cannot be empty."
}
$CredentialFile = [System.IO.Path]::GetFullPath($CredentialFile)
$dir = [System.IO.Path]::GetDirectoryName($CredentialFile)
if ([string]::IsNullOrWhiteSpace($dir)) {
  throw "CredentialFile must include a parent directory: $CredentialFile"
}
if (-not (Test-Path -LiteralPath $dir)) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

if ((Test-Path -LiteralPath $CredentialFile) -and -not $Force) {
  throw "Credential file already exists: $CredentialFile. Re-run with -Force to replace it."
}

$payload = [ordered]@{
  contract = "protected-readback-credential-runtime-v1"
  createdAt = (Get-Date).ToString("o")
}

if (-not [string]::IsNullOrWhiteSpace($BearerToken)) {
  $payload.bearerToken = $BearerToken.Trim()
  $payload.source = "bearer-token"
} elseif ($StoreEmailPassword) {
  if ([string]::IsNullOrWhiteSpace($Email)) {
    $Email = Read-Host "FUMAN_TEST_MEMBER_EMAIL"
  }
  $securePassword = Read-Host "FUMAN_TEST_MEMBER_PASSWORD" -AsSecureString
  $password = Convert-SecureStringToPlainText -Secure $securePassword
  if ([string]::IsNullOrWhiteSpace($Email) -or [string]::IsNullOrWhiteSpace($password)) {
    throw "Email/password cannot be empty."
  }
  $payload.email = $Email.Trim()
  $payload.password = $password
  $payload.source = "email-password"
} else {
  throw "Provide -BearerToken or use -StoreEmailPassword. Prefer -BearerToken when possible."
}

$json = $payload | ConvertTo-Json -Depth 6
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($CredentialFile, $json, $utf8NoBom)

# Lock the file to the current Windows user and Administrators/System.
$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$acl = Get-Acl -LiteralPath $CredentialFile
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRule($rule) }
$rights = [System.Security.AccessControl.FileSystemRights]::FullControl
$inheritance = [System.Security.AccessControl.InheritanceFlags]::None
$propagation = [System.Security.AccessControl.PropagationFlags]::None
$allow = [System.Security.AccessControl.AccessControlType]::Allow
foreach ($identity in @($currentIdentity, "BUILTIN\Administrators", "NT AUTHORITY\SYSTEM")) {
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, $rights, $inheritance, $propagation, $allow)
  $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $CredentialFile -AclObject $acl

Write-Output "protected-readback credential installed: $CredentialFile"
Write-Output "source=$($payload.source)"
Write-Output "Run: cd C:\fuman-terminal; npm run verify:protected-readback-credential"
