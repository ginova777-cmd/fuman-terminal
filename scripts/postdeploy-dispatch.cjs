'use strict';
const { spawnSync } = require('node:child_process');
if (process.env.FUMAN_RELEASE_REHEARSAL === '1') {
  require('../lib/morning-release-rehearsal.cjs').inspect(process.cwd());
  console.log(JSON.stringify({ status: 'NOT_RUN', reason: 'isolated predeploy performs no upload or live postdeploy', naturalAcceptance: false }));
  process.exit(0);
}
const bounded = Boolean(process.env.FUMAN_MORNING_WEB_ARTIFACT_ROOT);
const r = bounded
  ? spawnSync(process.execPath, ['scripts/verify-morning-web-live-release.cjs'], { stdio: 'inherit', windowsHide: true })
  : spawnSync("node --use-system-ca scripts/verify-live-version.js --retry && npm run verify:terminal-desktop-skeleton && npm run verify:opening-report-morning-contract && npm run verify:terminal-display-snapshot -- --retry && node --use-system-ca scripts/verify-mobile-layout.js --live && node --dns-result-order=ipv4first scripts/verify-mobile-realtime.js && node --dns-result-order=ipv4first scripts/publish-mobile-update-event.js --source=postdeploy", { stdio: 'inherit', shell: true, windowsHide: true });
if (r.error) console.error(r.error.message);
process.exitCode = r.error || r.status === null ? 1 : r.status;
