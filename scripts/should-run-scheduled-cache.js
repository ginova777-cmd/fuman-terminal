const fs = require("fs");
const path = require("path");

const { ROOT, dataPath } = require("./runtime-paths");

const RULES = {
  flow: {
    files: ["data/institution-latest.json", "data/warrant-flow-latest.json"],
    slots: ["06:00", "21:00"],
  },
  strategy3: {
    files: ["data/strategy3-latest.json"],
    slots: ["13:00"],
  },
  openBuy: {
    files: ["data/open-buy-latest.json"],
    slots: ["07:00", "16:00"],
  },
  strategy4: {
    files: ["data/strategy4-latest.json"],
    slots: ["07:00", "14:30"],
  },
  strategy5: {
    files: ["data/strategy5-latest.json"],
    slots: ["06:00", "21:00"],
  },
};

function taipeiNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    dateKey: `${byType.year}-${byType.month}-${byType.day}`,
    minutes: Number(byType.hour) * 60 + Number(byType.minute),
  };
}

function slotMinutes(slot) {
  const [hour, minute] = slot.split(":").map(Number);
  return hour * 60 + minute;
}

function activeSlot(rule, now) {
  return rule.slots
    .map(slotMinutes)
    .filter((minutes) => now.minutes >= minutes)
    .sort((a, b) => b - a)[0];
}

function readUpdatedAt(file) {
  try {
    const payload = JSON.parse(fs.readFileSync(dataPath(file.replace(/^data\//, "")), "utf8"));
    return Date.parse(payload.updatedAt || "");
  } catch {
    return NaN;
  }
}

function isUpdatedForSlot(file, slot, now) {
  const updatedAt = readUpdatedAt(file);
  if (!Number.isFinite(updatedAt)) return false;
  const updated = taipeiNow(new Date(updatedAt));
  return updated.dateKey === now.dateKey && updated.minutes >= slot;
}

function main() {
  const key = process.argv[2];
  const rule = RULES[key];
  if (!rule) throw new Error(`Unknown schedule rule: ${key}`);
  if (process.env.GITHUB_EVENT_NAME === "workflow_dispatch" && process.env.SCHEDULE_FORCE_RUN !== "false" && process.env.SCHEDULE_FORCE_RUN !== "0") {
    console.log("run");
    return;
  }

  const now = taipeiNow();
  const slot = activeSlot(rule, now);
  if (slot === undefined) {
    console.log("skip");
    return;
  }

  const complete = rule.files.every((file) => isUpdatedForSlot(file, slot, now));
  console.log(complete ? "skip" : "run");
}

main();


