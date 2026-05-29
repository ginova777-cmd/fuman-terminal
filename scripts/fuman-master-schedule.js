const WORKFLOWS = {
  patrol: { workflow: "schedule-patrol.yml" },
  openBuy: { workflow: "open-buy-background-scan.yml", inputs: { full_scan: "true" } },
  strategy3: { workflow: "strategy3-background-scan.yml" },
  strategy4: { workflow: "strategy4-background-scan.yml", inputs: { full_scan: "true" } },
  strategy5: { workflow: "strategy5-background-scan.yml" },
  flow: { workflow: "flow-cache.yml", inputs: { force_run: "false" } },
  intradayRecord: { workflow: "intraday-radar-scorecard.yml", inputs: { mode: "record", force_report: "false" } },
  intradayReport: { workflow: "intraday-radar-scorecard.yml", inputs: { mode: "report", force_report: "false" } },
};

function taipeiNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${byType.year}-${byType.month}-${byType.day}`,
    weekday: byType.weekday,
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    minutes: Number(byType.hour) * 60 + Number(byType.minute),
    label: `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}`,
  };
}

function isWeekday(now) {
  return now.weekday !== "Sat" && now.weekday !== "Sun";
}

function inRange(now, start, end) {
  return now.minutes >= start && now.minutes <= end;
}

function shouldRunEvery(now, every, offset = 0) {
  return now.minute % every === offset;
}

function taipeiSlotIso(now, minutes) {
  const utc = new Date(Date.UTC(
    Number(now.date.slice(0, 4)),
    Number(now.date.slice(5, 7)) - 1,
    Number(now.date.slice(8, 10)),
    Math.floor(minutes / 60) - 8,
    minutes % 60,
    0,
  ));
  return utc.toISOString();
}

async function hasHealthyWorkflowRunSince(workflow, sinceIso) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) return false;
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?per_page=20`, {
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "User-Agent": "fuman-master-schedule",
    },
  });
  if (!response.ok) return false;
  const payload = await response.json();
  const since = Date.parse(sinceIso);
  return (payload.workflow_runs || []).some((run) => {
    const createdAt = Date.parse(run.created_at || "");
    if (!Number.isFinite(createdAt) || createdAt < since) return false;
    if (run.status === "queued" || run.status === "in_progress") return true;
    return run.status === "completed" && run.conclusion === "success";
  });
}

async function pushOnceInWindow(tasks, taskKey, now, start, end, sinceStart = start) {
  if (!inRange(now, start, end)) return;
  const workflow = WORKFLOWS[taskKey]?.workflow;
  if (!workflow) return;
  const sinceIso = taipeiSlotIso(now, sinceStart);
  if (await hasHealthyWorkflowRunSince(workflow, sinceIso)) return;
  tasks.push(taskKey);
}

async function selectTasks(now) {
  if (!isWeekday(now)) return [];
  const tasks = [];

  if (inRange(now, 7 * 60, 22 * 60 + 55) && shouldRunEvery(now, 10, 0)) {
    tasks.push("patrol");
  }

  await pushOnceInWindow(tasks, "openBuy", now, 7 * 60, 7 * 60 + 20);
  await pushOnceInWindow(tasks, "openBuy", now, 14 * 60 + 30, 14 * 60 + 50);

  if (inRange(now, 13 * 60, 14 * 60 + 30) && shouldRunEvery(now, 10, 0)) {
    tasks.push("strategy3");
  }

  await pushOnceInWindow(tasks, "strategy4", now, 7 * 60, 8 * 60 + 30);
  await pushOnceInWindow(tasks, "strategy4", now, 14 * 60 + 30, 16 * 60);

  await pushOnceInWindow(tasks, "strategy5", now, 6 * 60, 6 * 60 + 20);
  await pushOnceInWindow(tasks, "strategy5", now, 21 * 60, 21 * 60 + 20);

  await pushOnceInWindow(tasks, "flow", now, 6 * 60 + 20, 6 * 60 + 40, 6 * 60);
  await pushOnceInWindow(tasks, "flow", now, 21 * 60 + 20, 21 * 60 + 40, 21 * 60);

  if (inRange(now, 9 * 60, 13 * 60 + 30) && shouldRunEvery(now, 10, 0)) {
    tasks.push("intradayRecord");
  }

  if ((inRange(now, 14 * 60 + 15, 15 * 60 + 15) || inRange(now, 15 * 60 + 30, 16 * 60 + 30)) && shouldRunEvery(now, 10, 5)) {
    tasks.push("intradayReport");
  }

  return tasks;
}

async function dispatchWorkflow(taskKey) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const ref = process.env.GITHUB_REF_NAME || "main";
  const task = WORKFLOWS[taskKey];
  if (!repo) throw new Error("missing GITHUB_REPOSITORY");
  if (!token) throw new Error("missing GITHUB_TOKEN");
  if (!task) throw new Error(`unknown task ${taskKey}`);

  const response = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${task.workflow}/dispatches`, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "fuman-master-schedule",
    },
    body: JSON.stringify({ ref, ...(task.inputs ? { inputs: task.inputs } : {}) }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${task.workflow} dispatch failed HTTP ${response.status} ${text}`.trim());
  }
  return task.workflow;
}

async function main() {
  const now = taipeiNow();
  const forced = (process.env.MASTER_FORCE_TASKS || "").split(",").map((item) => item.trim()).filter(Boolean);
  const tasks = forced.length ? forced : await selectTasks(now);
  console.log(`fuman master schedule ${now.label} tasks=${tasks.join(",") || "none"}`);
  for (const task of tasks) {
    const workflow = await dispatchWorkflow(task);
    console.log(`dispatched ${task} -> ${workflow}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
