const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FILES = [
  "index.html",
  "terminal-core.js",
  "terminal.js",
  "terminal-modules.js",
  "fuman-sw.js",
];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function write(file, content) {
  fs.writeFileSync(path.join(ROOT, file), content, "utf8");
}

function detectVersion() {
  const core = read("terminal-core.js");
  const match = core.match(/const\s+version\s*=\s*["']([^"']+)["']/);
  if (!match) throw new Error("Unable to detect current version from terminal-core.js");
  return match[1];
}

function nextVersion(version) {
  const match = version.match(/^(.*-)(\d+)$/);
  if (!match) {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `${version}-${stamp}-01`;
  }
  const width = match[2].length;
  const next = String(Number(match[2]) + 1).padStart(width, "0");
  return `${match[1]}${next}`;
}

const current = detectVersion();
const target = process.argv[2] || nextVersion(current);

if (!/^[a-z0-9][a-z0-9._-]*$/i.test(target)) {
  console.error(`Invalid version: ${target}`);
  process.exit(1);
}

for (const file of FILES) {
  let content = read(file);
  content = content.split(current).join(target);
  if (file === "terminal-modules.js") {
    content = content.replace(/const VERSION = "([^"]+)";/, `const VERSION = "${target}";`);
  }
  write(file, content);
  console.log(`${file}: ${current} -> ${target}`);
}

console.log(`[version] bumped ${current} -> ${target}`);
