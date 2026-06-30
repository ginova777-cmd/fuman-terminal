"use strict";

const tls = require("tls");

function emailConfigFromEnv() {
  return {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    to: process.env.REPORT_EMAIL_TO || process.env.ALERT_EMAIL_TO || process.env.OPS_EMAIL_TO || "",
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
  await new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });
  await smtpCommand(socket, null);
  await smtpCommand(socket, "EHLO fuman-terminal");
  await smtpCommand(socket, "AUTH LOGIN", /^334/);
  await smtpCommand(socket, Buffer.from(config.user).toString("base64"), /^334/);
  await smtpCommand(socket, Buffer.from(config.pass).toString("base64"));
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
}

module.exports = {
  emailConfigFromEnv,
  hasEmailConfig,
  sendEmailText,
};
