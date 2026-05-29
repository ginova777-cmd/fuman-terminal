Set-Location "C:\fuman-terminal"

New-Item -ItemType Directory -Force -Path "C:\fuman-terminal\logs" | Out-Null
$log = "C:\fuman-terminal\logs\flow-$(Get-Date -Format yyyyMMdd-HHmmss).log"

"=== Flow and warrant scan start $(Get-Date) ===" | Out-File $log -Encoding utf8

git pull --rebase origin main >> $log 2>&1

$env:REQUIRE_FRESH_INSTITUTION = "1"

$institutionExit = 1
for ($attempt = 1; $attempt -le 6; $attempt++) {
  "Institution scan attempt $attempt/6" >> $log
  node scripts\scan-institution-cache.js >> $log 2>&1
  $institutionExit = $LASTEXITCODE
  if ($institutionExit -eq 0) {
    "Institution scan succeeded on attempt $attempt" >> $log
    break
  }
  if ($attempt -lt 6) {
    "Institution scan not fresh yet, retrying in 10 minutes" >> $log
    Start-Sleep -Seconds 600
  }
}

Remove-Item Env:REQUIRE_FRESH_INSTITUTION -ErrorAction SilentlyContinue

if ($institutionExit -ne 0) {
  "Institution scan failed after retries with exit code $institutionExit" >> $log
  exit $institutionExit
}

node scripts\scan-warrant-flow-cache.js >> $log 2>&1
$warrantExit = $LASTEXITCODE

if ($warrantExit -ne 0) {
  "Warrant flow scan failed with exit code $warrantExit" >> $log
  exit $warrantExit
}

git add data\institution-latest.json data\institution-backup.json data\warrant-flow-latest.json data\warrant-flow-backup.json >> $log 2>&1
$status = git status --porcelain data\institution-latest.json data\institution-backup.json data\warrant-flow-latest.json data\warrant-flow-backup.json

if ($status) {
  git commit -m "Update flow and warrant cache from mini pc" >> $log 2>&1
  git pull --rebase --autostash origin main >> $log 2>&1
  git push >> $log 2>&1
  $pushExit = $LASTEXITCODE

  if ($pushExit -ne 0) {
    "Flow first push failed with exit code $pushExit, retrying pull/rebase then push" >> $log
    git pull --rebase --autostash origin main >> $log 2>&1
    $pullExit = $LASTEXITCODE
    if ($pullExit -ne 0) {
      "Flow retry pull/rebase failed with exit code $pullExit" >> $log
      exit $pullExit
    }

    git push >> $log 2>&1
    $retryPushExit = $LASTEXITCODE
    if ($retryPushExit -ne 0) {
      "Flow retry push failed with exit code $retryPushExit" >> $log
      exit $retryPushExit
    }
  }
} else {
  "No flow cache changes" >> $log
}

"=== Flow and warrant scan end $(Get-Date) ===" >> $log
