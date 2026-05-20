const tls = require("tls");

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
  await smtpCommand(socket, Buffer.from(pass).toString("base64"));
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
  const to = process.env.REPORT_EMAIL_TO;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!to || !user || !pass) {
    throw new Error("Missing REPORT_EMAIL_TO, SMTP_USER, or SMTP_PASS");
  }

  const workflow = process.env.GITHUB_WORKFLOW || "Intraday Radar Scorecard";
  const runUrl = process.env.GITHUB_RUN_URL || "";
  const mode = process.env.SCORECARD_MODE || "unknown";
  const text = [
    "策略2當沖雷達成績單｜執行失敗通知",
    "",
    `Workflow：${workflow}`,
    `模式：${mode}`,
    runUrl ? `檢查網址：${runUrl}` : "",
    "",
    "代表今天的盤後成績單沒有正常完成，請到 GitHub Actions 查看失敗原因。",
  ].filter(Boolean).join("\n");

  await sendMail({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    user,
    pass,
    to,
    subject: "策略2當沖雷達成績單｜執行失敗通知",
    text,
  });
  console.log(`failure alert sent to ${to}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
