const fs = require('fs');
const file = 'C:/fuman-terminal/scripts/run-terminal-auto-roll-forward.js';
let s = fs.readFileSync(file, 'utf8');
s = s.replace('const isRunIdClosureState = state.includes("RUNID_MISMATCH") || String(base.nextAction || "").includes("refresh_terminal_snapshot_bundle_mobile_88_readback");', 'const isRunIdClosureState = state.includes("RUNID_MISMATCH");');
fs.writeFileSync(file, s, 'utf8');
