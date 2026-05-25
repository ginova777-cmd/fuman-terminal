Set-Location "C:\fuman-terminal"

New-Item -ItemType Directory -Force -Path "C:\fuman-terminal\logs" | Out-Null
$log = "C:\fuman-terminal\logs\open-buy-$(Get-Date -Format yyyyMMdd-HHmmss).log"

"=== Open buy full scan start $(Get-Date) ===" | Out-File $log -Encoding utf8

git pull --rebase origin main >> $log 2>&1

$env:FULL_SCAN = "1"
$env:OPEN_BUY_BATCH_SIZE = "80"
$env:OPEN_BUY_BATCHES_PER_RUN = "999"

node scripts\scan-open-buy-cache.js >> $log 2>&1
$scanExit = $LASTEXITCODE

Remove-Item Env:FULL_SCAN -ErrorAction SilentlyContinue
Remove-Item Env:OPEN_BUY_BATCH_SIZE -ErrorAction SilentlyContinue
Remove-Item Env:OPEN_BUY_BATCHES_PER_RUN -ErrorAction SilentlyContinue

if ($scanExit -ne 0) {
  "Open buy scan failed with exit code $scanExit" >> $log
  exit $scanExit
}

git add data\open-buy-latest.json data\open-buy-backup.json data\open-buy-scorecard-source.json >> $log 2>&1
$status = git status --porcelain data\open-buy-latest.json data\open-buy-backup.json data\open-buy-scorecard-source.json

if ($status) {
  git commit -m "Update open buy cache from mini pc" >> $log 2>&1
  git pull --rebase --autostash origin main >> $log 2>&1
  git push >> $log 2>&1
} else {
  "No open buy cache changes" >> $log
}

"=== Open buy full scan end $(Get-Date) ===" >> $log
