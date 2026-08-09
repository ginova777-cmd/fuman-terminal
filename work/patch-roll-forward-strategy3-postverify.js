const fs = require('fs');
const file = 'C:/fuman-terminal/scripts/run-terminal-auto-roll-forward.js';
let s = fs.readFileSync(file, 'utf8');
s = s.replace(`    const scannerCommand = scannerStepForKey(key, job.command);\n    if (scannerCommand) base.commands.push(scannerCommand);`, `    const scannerCommands = scannerStepsForKey(key, job.command);\n    for (const scannerCommand of scannerCommands) base.commands.push(scannerCommand);`);
s = s.replace(`function scannerStepForKey(key, fallbackCommand = "") {\n  const map = {`, `function scannerStepsForKey(key, fallbackCommand = "") {\n  const map = {`);
s = s.replace(`    strategy3: {\n      command: process.platform === "win32" ? "pwsh.exe" : "pwsh",\n      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ".\\\\run-strategy3-complete-scan.ps1"],\n      label: "scanner:strategy3",\n    },`, `    strategy3: [\n      {\n        command: process.platform === "win32" ? "pwsh.exe" : "pwsh",\n        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ".\\\\run-strategy3-complete-scan.ps1"],\n        label: "scanner:strategy3",\n        writesSource: true,\n      },\n      npmRun("verify:daytrade-strategy3-closure-live"),\n      npmRun("scan-receipts:normalize"),\n      npmRun("verify:strategy-scan-receipt-contract"),\n    ],`);
s = s.replace(`  if (map[key]) return map[key];\n  if (fallbackCommand) {`, `  if (map[key]) return Array.isArray(map[key]) ? map[key] : [map[key]];\n  if (fallbackCommand) {`);
s = s.replace(`    return { command: parts[0], args: parts.slice(1), label: \\`scanner:${'${key}'}\\` };\n  }\n  return null;\n}`, `    return [{ command: parts[0], args: parts.slice(1), label: \\`scanner:${'${key}'}\\`, writesSource: true }];\n  }\n  return [];\n}`);
fs.writeFileSync(file, s, 'utf8');
