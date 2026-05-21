const DEFAULT_OWNER = "ginova777-cmd";
const DEFAULT_REPO = "fuman-terminal";
const DEFAULT_WORKFLOW = "fuman-master-schedule.yml";
const TASK_WORKFLOWS = {
  master: { workflow: "fuman-master-schedule.yml" },
  patrol: { workflow: "schedule-patrol.yml" },
  openBuy: { workflow: "open-buy-background-scan.yml", inputs: { full_scan: "true" } },
  strategy3: { workflow: "strategy3-background-scan.yml", inputs: { full_scan: "true" } },
  strategy4: { workflow: "strategy4-background-scan.yml", inputs: { full_scan: "true" } },
  strategy5: { workflow: "strategy5-background-scan.yml", inputs: { full_scan: "true" } },
  flow: { workflow: "flow-cache.yml", inputs: { full_scan: "true" } },
  intradayRecord: { workflow: "intraday-radar-scorecard.yml", inputs: { mode: "record", force_report: "false" } },
  intradayReport: { workflow: "intraday-radar-scorecard.yml", inputs: { mode: "report", force_report: "false" } },
};

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

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
    minutes: Number(byType.hour) * 60 + Number(byType.minute),
    time: `${byType.hour}:${byType.minute}`,
  };
}

function isTradingPatrolWindow(now) {
  if (now.weekday === "Sat" || now.weekday === "Sun") return false;
  return now.minutes >= 7 * 60 && now.minutes <= 22 * 60 + 55;
}

async function dispatchWorkflow({ owner, repo, workflow, ref, token, inputs }) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "fuman-terminal-external-schedule",
    },
    body: JSON.stringify({ ref, ...(inputs ? { inputs } : {}) }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GitHub dispatch failed HTTP ${response.status} ${text}`.trim());
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const expectedSecret = process.env.SCHEDULE_DISPATCH_SECRET || "";
  const providedSecret = req.query?.secret || req.headers["x-schedule-secret"] || "";
  if (!expectedSecret || providedSecret !== expectedSecret) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN || "";
  if (!token) {
    sendJson(res, 500, { ok: false, error: "missing_github_dispatch_token" });
    return;
  }

  const now = taipeiNow();
  if (!isTradingPatrolWindow(now) && req.query?.force !== "1") {
    sendJson(res, 200, {
      ok: true,
      skipped: true,
      reason: "outside_trading_patrol_window",
      taipei: now,
    });
    return;
  }

  const owner = process.env.GITHUB_OWNER || DEFAULT_OWNER;
  const repo = process.env.GITHUB_REPO || DEFAULT_REPO;
  const workflow = process.env.SCHEDULE_PATROL_WORKFLOW || DEFAULT_WORKFLOW;
  const ref = process.env.GITHUB_REF_NAME || "main";
  const dispatched = [];
  const task = String(req.query?.task || "").trim();

  try {
    if (task) {
      const target = TASK_WORKFLOWS[task];
      if (!target) {
        sendJson(res, 400, {
          ok: false,
          error: "unknown_task",
          allowedTasks: Object.keys(TASK_WORKFLOWS),
          taipei: now,
        });
        return;
      }
      await dispatchWorkflow({
        owner,
        repo,
        workflow: target.workflow,
        ref,
        inputs: target.inputs,
        token,
      });
      sendJson(res, 200, {
        ok: true,
        dispatched: [`${target.workflow}:${task}`],
        repo: `${owner}/${repo}`,
        ref,
        taipei: now,
      });
      return;
    }

    await dispatchWorkflow({ owner, repo, workflow, ref, token });
    dispatched.push(workflow);

    sendJson(res, 200, {
      ok: true,
      dispatched,
      repo: `${owner}/${repo}`,
      ref,
      taipei: now,
    });
  } catch (error) {
    sendJson(res, 502, {
      ok: false,
      error: error.message,
      taipei: now,
    });
  }
};
