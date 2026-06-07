const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data", "institution-latest.json");

function num(value) {
  if (value === undefined || value === null || value === "") return 0;
  return Number(String(value).replace(/,/g, "").trim()) || 0;
}

function readPayload(file) {
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!payload?.ok || !payload?.data || typeof payload.data !== "object") {
    throw new Error("institution-latest.json missing ok/data object");
  }
  return payload;
}

function countRows(data) {
  const rows = Object.entries(data)
    .map(([code, inst]) => {
      const foreign = num(inst.foreign);
      const trust = num(inst.trust);
      const dealer = num(inst.dealer);
      return {
        code,
        name: inst.name || code,
        foreign,
        trust,
        total: num(inst.total) || foreign + trust + dealer,
      };
    })
    .filter((row) => row.code && row.name);

  return {
    total: rows.length,
    joint: rows.filter((row) => row.foreign > 0 && row.trust > 0).length,
    trust: rows.filter((row) => row.trust > 0).length,
    foreign: rows.filter((row) => row.foreign > 0).length,
    legal: rows.filter((row) => row.total > 0).length,
  };
}

function assertMin(label, value, min) {
  if (value < min) throw new Error(`${label} count too low: ${value} < ${min}`);
}

const payload = readPayload(DATA_FILE);
const counts = countRows(payload.data);

assertMin("institution total", counts.total, 1000);
assertMin("joint buying", counts.joint, 1);
assertMin("trust buying", counts.trust, 1);
assertMin("foreign buying", counts.foreign, 1);

console.log(JSON.stringify({
  ok: true,
  usedDate: payload.usedDate || "",
  updatedAt: payload.updatedAt || "",
  counts,
}, null, 2));
