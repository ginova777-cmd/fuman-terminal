Set-Location "C:\fuman-terminal"

New-Item -ItemType Directory -Force -Path "C:\fuman-terminal\logs" | Out-Null
$log = "C:\fuman-terminal\logs\strategy5-$(Get-Date -Format yyyyMMdd-HHmmss).log"

"=== Strategy5 scan start $(Get-Date) ===" | Out-File $log -Encoding utf8

git pull --rebase origin main >> $log 2>&1

node scripts\scan-strategy5-cache.js >> $log 2>&1
$scanExit = $LASTEXITCODE

if ($scanExit -ne 0) {
  "Strategy5 scan failed with exit code $scanExit" >> $log
  exit $scanExit
}

git add data\strategy5-latest.json data\strategy5-backup.json >> $log 2>&1
$status = git status --porcelain data\strategy5-latest.json data\strategy5-backup.json

if ($status) {
  git commit -m "Update strategy5 cache from mini pc" >> $log 2>&1
  git pull --rebase --autostash origin main >> $log 2>&1
  git push >> $log 2>&1
  $pushExit = $LASTEXITCODE

  if ($pushExit -ne 0) {
    "Strategy5 first push failed with exit code $pushExit, retrying pull/rebase then push" >> $log
    git pull --rebase --autostash origin main >> $log 2>&1
    $pullExit = $LASTEXITCODE
    if ($pullExit -ne 0) {
      "Strategy5 retry pull/rebase failed with exit code $pullExit" >> $log
      exit $pullExit
    }

    git push >> $log 2>&1
    $retryPushExit = $LASTEXITCODE
    if ($retryPushExit -ne 0) {
      "Strategy5 retry push failed with exit code $retryPushExit" >> $log
      exit $retryPushExit
    }
  }
} else {
  "No strategy5 cache changes" >> $log
}

"=== Strategy5 scan end $(Get-Date) ===" >> $log
