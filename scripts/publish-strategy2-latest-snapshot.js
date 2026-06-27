const { upsertSnapshot } = require("../lib/supabase-snapshots");
const strategy2Latest = require("../api/strategy2-latest");

const SNAPSHOT_KEY = process.env.STRATEGY2_SUPABASE_SNAPSHOT_KEY || "strategy2_latest_snapshot";

function createResponse(resolve) {
  const response = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      resolve({ statusCode: this.statusCode || 200, payload, headers: this.headers });
      return this;
    },
    end(payload = "") {
      resolve({ statusCode: this.statusCode || 204, payload, headers: this.headers });
      return this;
    },
  };
  return response;
}

function compactDate(value) {
  const text = String(value || "").replace(/\D/g, "");
  return text.length >= 8 ? text.slice(0, 8) : "";
}

async function readLiveStrategy2Payload() {
  return new Promise((resolve, reject) => {
    const query = {
      canvas: "1",
      compact: "1",
      shell: "1",
      limit: "240",
      today: "1",
      live: "1",
    };
    const request = {
      method: "GET",
      headers: { host: "localhost" },
      url: "/api/strategy2-latest?canvas=1&compact=1&shell=1&limit=240&today=1&live=1",
      query,
    };
    Promise.resolve(strategy2Latest(request, createResponse(resolve))).catch(reject);
  });
}

async function main() {
  const result = await readLiveStrategy2Payload();
  const payload = result.payload && typeof result.payload === "object" ? result.payload : null;
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (result.statusCode < 200 || result.statusCode >= 300 || payload?.ok === false || !rows.length) {
    throw new Error(`strategy2 live payload not snapshot-ready status=${result.statusCode} ok=${payload?.ok} rows=${rows.length}`);
  }
  const updatedAt = payload.updatedAt || payload.generatedAt || new Date().toISOString();
  const snapshotPayload = {
    ...payload,
    ok: payload.ok !== false,
    cacheSource: "supabase:strategy2_latest_snapshot",
    snapshotFirst: true,
    snapshotLabel: "最近快照，前端需背景 live 刷新",
    updatedAt,
    transport: {
      ...(payload.transport || {}),
      source: "strategy2_latest_snapshot_publish",
      snapshotKey: SNAPSHOT_KEY,
      via: "scripts/publish-strategy2-latest-snapshot.js",
      fetchedAt: new Date().toISOString(),
    },
  };
  const write = await upsertSnapshot(SNAPSHOT_KEY, snapshotPayload, {
    source: "strategy2_latest_snapshot_publish",
    reason: "manual-strategy2-snapshot-first-cache",
    tradeDate: compactDate(payload.date) || compactDate(updatedAt),
    timeoutMs: Number(process.env.STRATEGY2_SNAPSHOT_WRITE_TIMEOUT_MS || 20000),
  });
  if (!write.ok) throw new Error(write.reason || write.error || "strategy2 snapshot write failed");
  console.log(`[strategy2-snapshot] ok key=${SNAPSHOT_KEY} run=${payload.runId || ""} rows=${rows.length} updatedAt=${updatedAt}`);
}

main().catch((error) => {
  console.error(`[strategy2-snapshot] failed: ${error.message}`);
  process.exit(1);
});
