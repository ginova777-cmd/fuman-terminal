Set-Location "C:\fuman-terminal"

New-Item -ItemType Directory -Force -Path "C:\fuman-terminal\logs" | Out-Null
$log = "C:\fuman-terminal\logs\strategy4-$(Get-Date -Format yyyyMMdd-HHmmss).log"

"=== Strategy4 full scan start $(Get-Date) ===" | Out-File $log -Encoding utf8

git pull --rebase origin main >> $log 2>&1

$env:FULL_SCAN = "1"
$env:STRATEGY4_BATCH_SIZE = "80"
$env:STRATEGY4_BATCHES_PER_RUN = "999"

node scripts\scan-strategy4-cache.js >> $log 2>&1
$scanExit = $LASTEXITCODE

Remove-Item Env:FULL_SCAN -ErrorAction SilentlyContinue
Remove-Item Env:STRATEGY4_BATCH_SIZE -ErrorAction SilentlyContinue
Remove-Item Env:STRATEGY4_BATCHES_PER_RUN -ErrorAction SilentlyContinue

if ($scanExit -ne 0) {
  "Strategy4 scan failed with exit code $scanExit" >> $log
  exit $scanExit
}

git add data\strategy4-latest.json data\strategy4-backup.json >> $log 2>&1
$status = git status --porcelain data\strategy4-latest.json data\strategy4-backup.json

if ($status) {
  git commit -m "Update strategy4 cache from mini pc" >> $log 2>&1
  git pull --rebase --autostash origin main >> $log 2>&1
  git push >> $log 2>&1
  $pushExit = $LASTEXITCODE

  if ($pushExit -ne 0) {
    "Strategy4 first push failed with exit code $pushExit, retrying pull/rebase then push" >> $log
    git pull --rebase --autostash origin main >> $log 2>&1
    $pullExit = $LASTEXITCODE
    if ($pullExit -ne 0) {
      "Strategy4 retry pull/rebase failed with exit code $pullExit" >> $log
      exit $pullExit
    }

    git push >> $log 2>&1
    $retryPushExit = $LASTEXITCODE
    if ($retryPushExit -ne 0) {
      "Strategy4 retry push failed with exit code $retryPushExit" >> $log
      exit $retryPushExit
    }
  }
} else {
  "No strategy4 cache changes" >> $log
}

"=== Strategy4 full scan end $(Get-Date) ===" >> $log
