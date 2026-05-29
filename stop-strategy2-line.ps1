$targets = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object {
  $_.CommandLine -like "*patrol-strategy2-live-alert.js*"
}
foreach ($target in $targets) {
  Invoke-CimMethod -InputObject $target -MethodName Terminate | Out-Null
}
