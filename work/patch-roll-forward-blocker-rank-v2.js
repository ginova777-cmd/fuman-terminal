const fs = require('fs');
const file = 'C:/fuman-terminal/scripts/run-terminal-auto-roll-forward.js';
let s = fs.readFileSync(file, 'utf8');
const oldText = `function blockerRank(action = {}) {\n  const keyRank = { strategy2: 0, strategy3: 1, strategy4: 2, strategy5: 3, institution: 4, warrant: 5, cb: 6, scorecard: 7 };\n  const severityRank = action.reasonSeverity === "critical" ? 0 : 1;\n  return [severityRank, Number(action.priority ?? 80), keyRank[action.key] ?? 50, String(action.key || "")];\n}`;
const newText = `function blockerRank(action = {}) {\n  const keyRank = { strategy2: 0, strategy3: 1, strategy4: 2, strategy5: 3, institution: 4, warrant: 5, cb: 6, scorecard: 7 };\n  const waitingRank = action.state === "WAITING_FORMAL_WINDOW" || action.deferredUntilNextFormalWindow ? 1 : 0;\n  const severityRank = action.reasonSeverity === "critical" ? 0 : 1;\n  return [waitingRank, severityRank, Number(action.priority ?? 80), keyRank[action.key] ?? 50, String(action.key || "")];\n}`;
if (!s.includes(oldText)) throw new Error('blockerRank exact text not found');
s = s.replace(oldText, newText);
fs.writeFileSync(file, s, 'utf8');
