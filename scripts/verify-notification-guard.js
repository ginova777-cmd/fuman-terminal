const fs = require("fs");
const os = require("os");
const path = require("path");

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "fuman-notify-guard-"));
process.env.FUMAN_STATE_DIR = stateDir;
process.env.NOTIFY_RUNTIME_VERSION = "notify-20260628-02";
process.env.NOTIFY_MIN_RUNTIME_VERSION = "notify-20260628-01";

const {
  channelAllowed,
  claimNotification,
  compareVersionLike,
  fastMode,
  guardedSend,
  localGate,
} = require("./notification-guard");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  assert(compareVersionLike("notify-20260628-02", "notify-20260628-01") > 0, "version comparison should allow newer runtime");
  assert(channelAllowed("line"), "line channel should be enabled by default");
  assert(localGate("telegram", { eventTime: new Date().toISOString() }).ok, "fresh event should pass local gate");
  assert(!localGate("line", { eventTime: "2020-01-01T00:00:00+08:00", maxEventAgeSec: 1 }).ok, "stale event should be blocked");

  const payload = { text: "hello" };
  const first = claimNotification({ channel: "line", target: "u1", payload, options: { dedupeScope: "test" } });
  assert(first.ok && !first.duplicate, "first claim should win");
  const second = claimNotification({ channel: "line", target: "u1", payload, options: { dedupeScope: "test" } });
  assert(!second.ok && second.duplicate, "second claim should dedupe");

  let sent = 0;
  const result = await guardedSend({
    channel: "telegram",
    target: "chat1",
    payload: { text: "unique" },
    options: { dedupeScope: "guarded-send" },
    send: async () => { sent += 1; },
  });
  assert(result.sent && sent === 1, "guarded send should call sender once");
  const duplicate = await guardedSend({
    channel: "telegram",
    target: "chat1",
    payload: { text: "unique" },
    options: { dedupeScope: "guarded-send" },
    send: async () => { sent += 1; },
  });
  assert(!duplicate.sent && sent === 1, "duplicate guarded send should skip sender");

  process.env.NOTIFY_FAST_MODE = "1";
  assert(fastMode(), "fast mode should be enabled by env");
  const fast = await guardedSend({
    channel: "line",
    target: "u2",
    payload: { text: "fast" },
    options: { dedupeScope: "fast-mode" },
    send: async () => { sent += 1; },
  });
  assert(fast.sent && Number.isFinite(fast.latencyMs), "fast guarded send should return latency");

  console.log("[notification-guard] ok");
}

main().catch((error) => {
  console.error(`[notification-guard] failed: ${error.message}`);
  process.exit(1);
});
