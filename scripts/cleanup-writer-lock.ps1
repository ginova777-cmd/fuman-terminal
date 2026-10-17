function Enter-FumanCleanupWriterLock {
  param([Parameter(Mandatory=$true)][string]$StateDirectory)
  # Same kernel-enforced file lease used by Run-DaytradeSourceWriter.ps1.
  # Never delete it or infer ownership from its presence/age.
  if (-not (Test-Path -LiteralPath $StateDirectory -PathType Container)) { throw 'cleanup_writer_state_directory_missing' }
  try {
    return [IO.File]::Open((Join-Path $StateDirectory 'writer-database-round.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  } catch [IO.IOException] { throw 'cleanup_writer_round_active_stop' }
}
