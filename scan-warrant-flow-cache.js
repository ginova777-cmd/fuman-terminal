const fs = require("fs");
const path = require("path");
const scanWarrantFlow = require("./api/scan-warrant-flow");

const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "data", "warrant-flow-latest.json");
const BACKUP_FILE = path.join(ROOT, "data", "warrant-flow-backup.json");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function runHandler() {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", query: {} };
    const res = {
      statusCode: 200,
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        if (this.statusCode >= 400) reject(new Error(payload?.error || `HTTP ${this.statusCode}`));
        else resolve(payload);
      },
      end() { resolve({ ok: false, matches: [] }); },
    };
    Promise.resolve(scanWarrantFlow(req, res)).catch(reject);
  });
}

async function main() {
  const previous = readJson(OUT_FILE, { ok: true, matches: [] });
  const backup = readJson(BACKUP_FILE, { ok: true, matches: [] });
  const payload = await runHandler();
  const matches = Array.isArray(payload.matches) ? payload.matches : [];
  const output = {
    ...payload,
    ok: true,
    source: "github-actions",
    updatedAt: new Date().toISOString(),
    count: matches.length,
    matches,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  if (matches.length) {
    fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
    fs.writeFileSync(BACKUP_FILE, `${JSON.stringify({ ...output, source: "github-actions-backup" }, null, 2)}\n`);
  } else if ((backup.matches || []).length) {
    fs.writeFileSync(OUT_FILE, `${JSON.stringify({ ...backup, source: "github-actions-backup-readonly" }, null, 2)}\n`);
  } else if ((previous.matches || []).length) {
    fs.writeFileSync(OUT_FILE, `${JSON.stringify({ ...previous, source: "github-actions-previous-readonly" }, null, 2)}\n`);
  } else {
    fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  }
  console.log(`warrant-flow cache updated: matches ${matches.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
