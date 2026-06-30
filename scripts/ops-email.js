"use strict";

const fs = require("fs");
const path = require("path");
const tls = require("tls");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";

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

function secretFileValue(fileNames = []) {
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

function normalizeSmtpPassword(pass, host) {
  const value = String(pass || "");
  if (!/gmail\.com$/i.test(String(host || ""))) return value;
  return value.replace(/\s+/g, "");
}

function emailConfigFromEnv() {
  return {
    host: secretValue("SMTP_HOST", ["smtp-host.txt"]) || "smtp.gmail.com",
    port: Number(secretValue("SMTP_PORT", ["smtp-port.txt"]) || 465),
    user: secretValue("SMTP_USER", ["smtp-user.txt", "gmail-user.txt"]),
    pass: secretFileValue(["smtp-pass.txt", "gmail-app-password.txt"]) || secretValue("SMTP_PASS", []),
    to: secretValue("REPORT_EMAIL_TO", ["report-email-to.txt", "smtp-to.txt", "gmail-to.txt"])
      || secretValue("ALERT_EMAIL_TO", ["alert-email-to.txt"])
      || secretValue("OPS_EMAIL_TO", ["ops-email-to.txt"]),
  };
}

function hasEmailConfig(config = emailConfigFromEnv()) {
  return Boolean(config.to && config.user && config.pass);
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
  if (!expect.test(response)) throw new Error(`SMTP failed after ${command}: ${response}`);
  return response;
}

async function sendEmailText(subject, text, config = emailConfigFromEnv()) {
  if (!hasEmailConfig(config)) throw new Error("Missing REPORT_EMAIL_TO/ALERT_EMAIL_TO, SMTP_USER, or SMTP_PASS");

  const socket = tls.connect({ host: config.host, port: config.port, servername: config.host });
  socket.setMaxListeners(Math.max(socket.getMaxListeners(), 30));
  await new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });
  await smtpCommand(socket, null);
  await smtpCommand(socket, "EHLO fuman-terminal");
  await smtpCommand(socket, "AUTH LOGIN", /^334/);
  await smtpCommand(socket, Buffer.from(config.user).toString("base64"), /^334/);
  await smtpCommand(socket, Buffer.from(normalizeSmtpPassword(config.pass, config.host)).toString("base64"));
  await smtpCommand(socket, `MAIL FROM:<${config.user}>`);
  await smtpCommand(socket, `RCPT TO:<${config.to}>`);
  await smtpCommand(socket, "DATA", /^354/);
  const message = [
    `From: ${config.user}`,
    `To: ${config.to}`,
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
  return {
    ok: true,
    host: config.host,
    port: config.port,
    to: config.to,
    sentAt: new Date().toISOString(),
  };
}

module.exports = {
  emailConfigFromEnv,
  hasEmailConfig,
  normalizeSmtpPassword,
  secretValue,
  sendEmailText,
};
