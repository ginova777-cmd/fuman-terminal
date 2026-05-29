const fs = require("fs");
const path = require("path");
const https = require("https");
const { URL, URLSearchParams } = require("url");

const SHEET_ID = process.env.GOOGLE_SHEET_ID || "1UCpEBXmOWNA57eLXH62WffnPrflly6OwmDm242JYhp8";
const TARGET_SHEET = process.argv[2] || "";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const SECRET_DIR = process.env.GOOGLE_OAUTH_DIR || path.join(RUNTIME_DIR, "secrets");
const TOKEN_PATH = path.join(SECRET_DIR, "google-sheets-token.json");
const CREDENTIALS_PATH = process.env.GOOGLE_OAUTH_CLIENT || path.join(SECRET_DIR, "google-oauth-client.json");

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function requestJson(method, rawUrl, { token, body, form } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(rawUrl);
    const data = form ? new URLSearchParams(form).toString() : body ? JSON.stringify(body) : null;
    const req = https.request({
      method,
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        "User-Agent": "FumanSheetTabCleanup/1.0",
        Accept: "application/json,text/plain,*/*",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : body ? { "Content-Type": "application/json" } : {}),
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let chunks = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { chunks += chunk; });
      res.on("end", () => {
        const parsed = chunks ? (() => { try { return JSON.parse(chunks); } catch { return chunks; } })() : {};
        if (res.statusCode >= 400) {
          const detail = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
          reject(new Error(`${method} ${url.pathname} HTTP ${res.statusCode}: ${detail.slice(0, 800)}`));
          return;
        }
        resolve(parsed);
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getAccessToken() {
  const client = readJson(CREDENTIALS_PATH)?.installed || readJson(CREDENTIALS_PATH)?.web || readJson(CREDENTIALS_PATH);
  const token = readJson(TOKEN_PATH);
  if (!client?.client_id || !client?.client_secret) throw new Error(`Missing Google OAuth client: ${CREDENTIALS_PATH}`);
  if (token?.access_token && token?.created_at && Date.now() - token.created_at < (token.expires_in || 3600) * 900) return token.access_token;
  if (!token?.refresh_token) throw new Error(`Missing Google refresh token: ${TOKEN_PATH}`);
  const refreshed = await requestJson("POST", "https://oauth2.googleapis.com/token", {
    form: {
      client_id: client.client_id,
      client_secret: client.client_secret,
      refresh_token: token.refresh_token,
      grant_type: "refresh_token",
    },
  });
  const merged = { ...token, ...refreshed, created_at: Date.now() };
  writeJson(TOKEN_PATH, merged);
  return merged.access_token;
}

async function main() {
  if (!TARGET_SHEET) throw new Error("Usage: node scripts/delete-google-sheet-tab.js <sheet-title>");
  const token = await getAccessToken();
  const spreadsheet = await requestJson("GET", `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties(title,sheetId)`, { token });
  const target = (spreadsheet.sheets || []).find((sheet) => sheet.properties?.title === TARGET_SHEET);
  if (!target) {
    console.log(`Sheet not found, nothing deleted: ${TARGET_SHEET}`);
    return;
  }
  await requestJson("POST", `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, {
    token,
    body: { requests: [{ deleteSheet: { sheetId: target.properties.sheetId } }] },
  });
  console.log(`Deleted sheet: ${TARGET_SHEET}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});


