const tls = require("tls");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";

function readArg(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] || "";
  return "";
}

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function secretValue(envName, fileNames = []) {
  const envValue = process.env[envName];
  if (envValue) return envValue;
  for (const name of fileNames) {
    for (const dir of [
      path.join(RUNTIME_DIR, "secrets"),
      path.join(ROOT, "secrets"),
    ]) {
      const value = readSecretText(path.join(dir, name));
      if (value) return value;
    }
  }
  return "";
}

function writeReceipt(file, payload) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function smtpRead(socket) {
  return new Promise((resolve, reject) => {
    let data = "";
    const onData = (chunk) => {
      data += chunk.toString("utf8");
      const lines = data.trimEnd().split(/\r?\n/);
      const last = lines.at(-1) || "";
      if (/^\d{3} /.test(last)) {
        socket.off("data", onData);
        resolve(data);
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

async function smtpCommand(socket, command, expect = /^[23]/) {
  if (command) socket.write(`${command}\r\n`);
  const response = await smtpRead(socket);
  if (!expect.test(response)) throw new Error(`SMTP failed after ${smtpCommandLabel(command)}: ${sanitizeSmtpResponse(response)}`);
  return response;
}

function smtpCommandLabel(command) {
  if (!command) return "greeting";
  if (/^AUTH\b/i.test(command)) return "AUTH";
  if (/^MAIL FROM\b/i.test(command)) return "MAIL FROM";
  if (/^RCPT TO\b/i.test(command)) return "RCPT TO";
  if (/^DATA\b/i.test(command)) return "DATA";
  if (/^QUIT\b/i.test(command)) return "QUIT";
  if (/^[A-Za-z0-9+/=]{8,}$/.test(command)) return "AUTH credential";
  return String(command).split(/\s+/)[0] || "command";
}

function sanitizeSmtpResponse(value) {
  return String(value || "").replace(/[A-Za-z0-9+/=]{16,}/g, "[redacted]");
}

function normalizeSmtpPassword(pass, host) {
  const value = String(pass || "");
  if (!/gmail\.com$/i.test(String(host || ""))) return value;
  return value.replace(/\s+/g, "");
}

function alertDefaultsForKind(kind, workflow, mode, runUrl) {
  if (/^institution\b|^institution-/i.test(String(kind || ""))) {
    return {
      source: "Institution / 買賣超",
      subject: "買賣超無人值守｜執行失敗通知",
      text: [
        "買賣超無人值守｜執行失敗通知",
        "",
        `Workflow：${workflow}`,
        `策略：Institution / 買賣超`,
        `告警種類：${kind}`,
        `模式：${mode}`,
        runUrl ? `檢查網址：${runUrl}` : "",
        "",
        "代表買賣超資料鏈、watchdog、或 publish gate 沒有正常完成，請立即檢查失敗原因。",
      ].filter(Boolean).join("\n"),
    };
  }
  return {
    source: workflow,
    subject: "策略2當沖雷達成績單｜執行失敗通知",
    text: [
      "策略2當沖雷達成績單｜執行失敗通知",
      "",
      `Workflow：${workflow}`,
      `模式：${mode}`,
      runUrl ? `檢查網址：${runUrl}` : "",
      "",
      "代表今天的盤後成績單沒有正常完成，請到 GitHub Actions 查看失敗原因。",
    ].filter(Boolean).join("\n"),
  };
}

async function sendMail({ host, port, user, pass, to, subject, text }) {
  const socket = tls.connect({ host, port, servername: host });
  await new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });
  await smtpCommand(socket, null);
  await smtpCommand(socket, "EHLO fuman-terminal");
  await smtpCommand(socket, "AUTH LOGIN", /^334/);
  await smtpCommand(socket, Buffer.from(user).toString("base64"), /^334/);
  await smtpCommand(socket, Buffer.from(normalizeSmtpPassword(pass, host)).toString("base64"));
  await smtpCommand(socket, `MAIL FROM:<${user}>`);
  await smtpCommand(socket, `RCPT TO:<${to}>`);
  await smtpCommand(socket, "DATA", /^354/);
  const message = [
    `From: ${user}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    ".",
  ].join("\r\n");
  await smtpCommand(socket, message);
  await smtpCommand(socket, "QUIT");
  socket.end();
}

async function main() {
  const receiptFile = readArg("--receipt") || process.env.FUMAN_ALERT_RECEIPT_FILE || "";
  const dryRun = process.argv.includes("--dry-run") || process.env.FUMAN_ALERT_DRY_RUN === "1";
  const startedAt = new Date().toISOString();
  const workflow = process.env.GITHUB_WORKFLOW || "Intraday Radar Scorecard";
  const runUrl = process.env.GITHUB_RUN_URL || "";
  const mode = process.env.SCORECARD_MODE || "unknown";
  const kind = readArg("--kind") || process.env.FUMAN_ALERT_KIND || "scorecard";
  const alertDefaults = alertDefaultsForKind(kind, workflow, mode, runUrl);
  const source = process.env.FUMAN_ALERT_SOURCE || alertDefaults.source;
  const subject = readArg("--subject") || process.env.FUMAN_ALERT_SUBJECT || alertDefaults.subject;
  const text = process.env.FUMAN_ALERT_TEXT || alertDefaults.text;

  const to = secretValue("REPORT_EMAIL_TO", ["report-email-to.txt", "smtp-to.txt", "gmail-to.txt"]);
  const user = secretValue("SMTP_USER", ["smtp-user.txt", "gmail-user.txt"]);
  const pass = secretValue("SMTP_PASS", ["smtp-pass.txt", "gmail-app-password.txt"]);
  const payload = {
    ok: false,
    kind,
    source,
    to,
    subject,
    startedAt,
    finishedAt: "",
    channel: "smtp",
    host: secretValue("SMTP_HOST", ["smtp-host.txt"]) || "smtp.gmail.com",
    port: Number(secretValue("SMTP_PORT", ["smtp-port.txt"]) || 465),
    receiptFile,
    dryRun,
    error: "",
  };

  try {
    if (!to || !user || !pass) {
      throw new Error("Missing REPORT_EMAIL_TO, SMTP_USER, or SMTP_PASS");
    }
    if (dryRun) {
      payload.channel = "smtp:dry-run";
    } else {
      await sendMail({
        host: payload.host,
        port: payload.port,
        user,
        pass,
        to,
        subject,
        text,
      });
    }
    payload.ok = true;
    payload.finishedAt = new Date().toISOString();
    writeReceipt(receiptFile, payload);
    console.log(dryRun ? `failure alert dry-run to ${to}` : `failure alert sent to ${to}`);
  } catch (error) {
    payload.error = error?.message || String(error);
    payload.finishedAt = new Date().toISOString();
    writeReceipt(receiptFile, payload);
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
