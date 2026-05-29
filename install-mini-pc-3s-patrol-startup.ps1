$ErrorActionPreference = "Stop"

$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "Fuman Mini PC 3s Patrol.lnk"
$scriptPath = "C:\fuman-terminal\run-mini-pc-3s-patrol.ps1"
$pwsh = "C:\Users\ginov\AppData\Local\Microsoft\WindowsApps\pwsh.exe"
if (-not (Test-Path $pwsh)) {
  $pwsh = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $pwsh
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
$shortcut.WorkingDirectory = "C:\fuman-terminal"
$shortcut.WindowStyle = 7
$shortcut.Description = "Fuman Mini PC startup patrol: Strategy2 and realtime radar every 3 seconds."
$shortcut.Save()

Write-Host "Installed startup shortcut: $shortcutPath"

