const fs = require("fs");
const path = require("path");
const scanInstitution = require("../api/institution");

const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "data", "institution-latest.json");
const BACKUP_FILE = path.join(ROOT, "data", "institution-backup.json");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function runHandler() {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", query: {} };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        if (this.statusCode >= 400) reject(new Error(payload?.error || `HTTP ${this.statusCode}`));
        else resolve(payload);
      },
      end() { resolve({ ok: false, data: {} }); },
    };
    Promise.resolve(scanInstitution(req, res)).catch(reject);
  });
}

async function main() {
  const backup = readJson(BACKUP_FILE, { ok: true, data: {} });
  const payload = await runHandler();
  const count = Object.keys(payload.data || {}).length;
  const output = {
    ...payload,
    ok: true,
    source: "github-actions",
    updatedAt: new Date().toISOString(),
    count,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  if (count) fs.writeFileSync(BACKUP_FILE, `${JSON.stringify({ ...output, source: "github-actions-backup" }, null, 2)}\n`);
  else if (Object.keys(backup.data || {}).length) fs.writeFileSync(OUT_FILE, `${JSON.stringify({ ...backup, source: "github-actions-backup-readonly" }, null, 2)}\n`);
  console.log(`institution cache updated: rows ${count}, usedDate ${output.usedDate || "--"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
