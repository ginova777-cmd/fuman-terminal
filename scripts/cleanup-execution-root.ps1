function Assert-FumanCleanupExecutionRoot {
  param([Parameter(Mandatory=$true)][string]$ExecutionRoot)
  $expected = 'C:\fuman-release-owner\prod81'
  if ([IO.Path]::GetFullPath($ExecutionRoot).TrimEnd('\') -ine $expected) { throw 'RELEASE_ROOT_DRIFT: cleanup execution must use prod81' }
  Push-Location -LiteralPath $expected
  try {
    & node (Join-Path $expected 'scripts\verify-release-root-authority.js') --require-production-root
    if ($LASTEXITCODE -ne 0) { throw 'RELEASE_ROOT_DRIFT: cleanup authority verification failed' }
  } finally { Pop-Location }
}
