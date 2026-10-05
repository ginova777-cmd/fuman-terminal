param([string]$Wrapper=(Join-Path $PSScriptRoot '../ops/public-slot/Run-DaytradeSourceWriter.ps1'))
$ErrorActionPreference='Stop'
$text=Get-Content -LiteralPath $Wrapper -Raw
$start=$text.IndexOf('  [string]$verifyText = Get-Content')
$end=$text.IndexOf('  if ($verifyText.Length', $start)
if($start -lt 0 -or $end -lt 0){throw 'PATCH_MISSING'}
$block=[scriptblock]::Create($text.Substring($start,$end-$start)+'; return $verifyText')
$verifyLog=Join-Path ([IO.Path]::GetTempPath()) ('writer-stderr-test-'+[guid]::NewGuid())
try {
 foreach($case in @(@{raw='';expected=''},@{raw="failure`r`nHTTP 503";expected='failure HTTP 503'},@{raw=' ';expected=''})) {
  [IO.File]::WriteAllText(($verifyLog+'.stderr'),$case.raw)
  $actual=& $block
  if($actual -cne $case.expected){throw 'STDERR_TEXT_MISMATCH'}
 }
 $tokens=$null;$errors=$null
 [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $Wrapper),[ref]$tokens,[ref]$errors)
 if($errors.Count){throw 'PARSE_FAILURE'}
 Write-Output '{"ok":true,"empty_stderr":true,"multiline_error_preserved":true,"whitespace":true,"database_calls":0}'
} finally {Remove-Item -LiteralPath ($verifyLog+'.stderr') -ErrorAction SilentlyContinue}
