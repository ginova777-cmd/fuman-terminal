"use strict";

const RULE_CONTRACT = "scorecard-strategy-rule-lock-v1";
const FOLLOWUP_DAYS = 7;
const FOLLOWUP_RULE = "close_or_high_T+7 > entry_price";
const FOLLOWUP_STATUS = "pending_7d_growth_check";
const POSITIVE_GROWTH_BASIS = "positive_growth_7d";

const STRATEGY_KEYS = {
  "策略1開盤入成績單": "strategy1",
  "策略2成績單": "strategy2",
  "策略3隔日沖成績單": "strategy3",
  "策略4成績單": "strategy4",
  "策略5成績單": "strategy5",
  "買賣超成績單": "institution",
  "權證成績單": "warrant",
  "CB成績單": "cb",
  "即時雷達成績單": "realtime-radar",
};

const FOLLOWUP_STRATEGIES = new Set([
  "策略4成績單",
  "策略5成績單",
  "買賣超成績單",
  "權證成績單",
  "CB成績單",
]);

const WINDOW_RULES = [
  { strategy: "即時雷達成績單", start: 9 * 60, end: 13 * 60 + 30, label: "09:00-13:30" },
  { strategy: "策略2成績單", start: 9 * 60, end: 13 * 60 + 30, label: "09:00-13:30" },
];

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function roundPrice(value) {
  return Math.round(cleanNumber(value) * 10000) / 10000;
}

function timeMinutes(value) {
  const match = cleanText(value).match(/(?:^|T|\s)(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function compactReason(value, maxLength = 1600) {
  return cleanText(value).replace(/\s+/g, " ").slice(0, maxLength);
}

function splitTags(value) {
  const tags = [];
  const push = (item) => {
    const text = cleanText(item)
      .replace(/^策略項目=.+$/u, "")
      .replace(/^策略細項=.+$/u, "")
      .replace(/^7日追蹤=.+$/u, "")
      .replace(/^追蹤狀態=.+$/u, "")
      .replace(/^規則版本=.+$/u, "")
      .trim();
    if (!text || /最高價補值|fugle_quotes_latest|latest complete run/i.test(text)) return;
    if (!tags.includes(text)) tags.push(text);
  };
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "object" && item) push(item.reason || item.name || item.id || item.label);
      else push(item);
    }
  } else {
    for (const item of cleanText(value).split(/[；;|/、,，]+/u)) push(item);
  }
  return tags.slice(0, 8);
}

function markerValue(reason, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = cleanText(reason).match(new RegExp(`${escaped}=([^；;]+)`, "u"));
  return cleanText(match?.[1] || "");
}

function appendMarker(reason, key, value) {
  const text = compactReason(reason);
  if (!cleanText(value)) return text;
  if (markerValue(text, key)) return text;
  return compactReason(`${text}${text ? "；" : ""}${key}=${value}`);
}

function addDays(dateText, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanText(dateText))) return "";
  const date = new Date(`${dateText}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function slug(value) {
  const text = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return text || "rule";
}

function firstReasonTag(reason, fallback) {
  return splitTags(reason)[0] || fallback;
}

function inferRuleTags(strategy, row = {}, reason = "") {
  const tags = [];
  const add = (value) => splitTags(value).forEach((tag) => {
    if (!tags.includes(tag)) tags.push(tag);
  });
  add(row.strategyTags);
  add(row.strategyReasons);
  add(row.signals);
  add(row.matches);
  add(row.tags);
  add(reason);

  if (strategy === "策略4成績單") add(row.zone_label || row.zoneLabel || row.zone);
  if (strategy === "策略5成績單") add(row.setup_type || row.setupType || row.pattern || row.stage);
  if (strategy === "權證成績單") add(row.result_type || row.resultType || row._scorecardArrayKey);
  if (strategy === "即時雷達成績單") add(row.state || row.signal || row.action || row.risk);
  return tags.slice(0, 8);
}

function inferRuleGroup(strategy, row = {}, reason = "") {
  const tags = inferRuleTags(strategy, row, reason);
  if (strategy === "買賣超成績單") {
    const foreign = cleanNumber(row.foreign_net ?? row.foreignNet);
    const trust = cleanNumber(row.trust_net ?? row.trustNet);
    const dealer = cleanNumber(row.dealer_net ?? row.dealerNet);
    if (foreign > 0 && trust > 0 && dealer > 0) return "三大法人同步買超";
    if (foreign > 0 && trust > 0) return "外資投信同步買超";
    if (foreign > 0) return "外資買超";
    if (trust > 0) return "投信買超";
    if (dealer > 0) return "自營商買超";
  }
  if (strategy === "權證成績單") {
    const type = cleanText(row.result_type || row.resultType || row._scorecardArrayKey);
    if (/volume/i.test(type)) return "權證成交量放大";
    if (/single/i.test(type)) return "權證單一訊號";
  }
  if (strategy === "CB成績單") {
    const cbTags = tags.filter((tag) => /董事會|競價|轉換|近期|發行規模|MA200|MACD|量能/u.test(tag));
    if (cbTags.length) return cbTags.slice(0, 2).join(" + ");
  }
  return tags[0] || firstReasonTag(reason, `${strategy}規則`);
}

function entryPriceSource(taskKey, row = {}) {
  if (taskKey === "cb") {
    if (cleanNumber(row.stockPrice) > 0) return "stockPrice";
    if (cleanNumber(row.entry_price ?? row.entryPrice) > 0) return "entry_price";
    return "inferred";
  }
  if (cleanNumber(row.entry_price ?? row.entryPrice) > 0) return "entry_price";
  if (cleanNumber(row.price ?? row.close ?? row.lastPrice) > 0) return "price";
  return "inferred";
}

function buildRuleMetadata({ record = {}, taskKey = "", sourceRow = {}, reason = "" } = {}) {
  const strategy = cleanText(record.strategy || sourceRow.strategy);
  const key = taskKey || STRATEGY_KEYS[strategy] || slug(strategy);
  const baseReason = cleanText(reason || record.reason);
  const tags = inferRuleTags(strategy, sourceRow, baseReason);
  const group = inferRuleGroup(strategy, sourceRow, baseReason);
  const followup = FOLLOWUP_STRATEGIES.has(strategy);
  const metadata = {
    rule_contract: RULE_CONTRACT,
    rule_key: `${key}:${slug(group)}`,
    rule_group: group,
    rule_tags: tags.length ? tags : [group],
    entry_price_source: entryPriceSource(key, sourceRow),
  };
  if (followup) {
    metadata.followup_days = FOLLOWUP_DAYS;
    metadata.followup_rule = FOLLOWUP_RULE;
    metadata.followup_status = FOLLOWUP_STATUS;
    metadata.followup_price_basis = POSITIVE_GROWTH_BASIS;
    metadata.followup_due_date = addDays(record.record_date, FOLLOWUP_DAYS);
    metadata.positive_growth_7d = null;
  }
  return metadata;
}

function applyScorecardRuleMetadata({ record = {}, taskKey = "", sourceRow = {}, payload = {} } = {}) {
  const reason = cleanText(record.reason);
  const metadata = buildRuleMetadata({ record, taskKey, sourceRow, reason });
  let nextReason = reason;
  nextReason = appendMarker(nextReason, "規則版本", RULE_CONTRACT);
  nextReason = appendMarker(nextReason, "策略項目", metadata.rule_group);
  nextReason = appendMarker(nextReason, "策略細項", (metadata.rule_tags || []).slice(0, 4).join("|"));
  nextReason = appendMarker(nextReason, "進場價來源", metadata.entry_price_source);
  if (metadata.followup_days) {
    nextReason = appendMarker(nextReason, "7日追蹤", FOLLOWUP_RULE);
    nextReason = appendMarker(nextReason, "追蹤狀態", FOLLOWUP_STATUS);
  }
  if (taskKey === "strategy1") {
    nextReason = appendMarker(nextReason, "策略1結算", "前一日21:30顯示，當日收盤後結算");
  }
  if (taskKey === "strategy3") {
    nextReason = appendMarker(nextReason, "策略3最高價", "隔天高點");
  }
  return {
    ...record,
    ...metadata,
    reason: nextReason,
    display_rule_contract: cleanText(payload.displayRuleContract || RULE_CONTRACT),
  };
}

function hydrateScorecardRuleMetadataFromReason(record = {}) {
  const reason = cleanText(record.reason);
  const strategy = cleanText(record.strategy);
  const group = markerValue(reason, "策略項目") || inferRuleGroup(strategy, record, reason);
  const tagText = markerValue(reason, "策略細項");
  const tags = tagText ? tagText.split("|").map(cleanText).filter(Boolean) : inferRuleTags(strategy, record, reason);
  const key = STRATEGY_KEYS[strategy] || slug(strategy);
  const followup = FOLLOWUP_STRATEGIES.has(strategy);
  const metadata = {
    rule_contract: markerValue(reason, "規則版本") || (markerValue(reason, "策略項目") ? RULE_CONTRACT : ""),
    rule_key: `${key}:${slug(group)}`,
    rule_group: group,
    rule_tags: tags.length ? tags : [group],
    entry_price_source: markerValue(reason, "進場價來源") || cleanText(record.entry_price_source || ""),
  };
  if (followup) {
    metadata.followup_days = FOLLOWUP_DAYS;
    metadata.followup_rule = markerValue(reason, "7日追蹤") || FOLLOWUP_RULE;
    metadata.followup_status = markerValue(reason, "追蹤狀態") || FOLLOWUP_STATUS;
    metadata.followup_price_basis = POSITIVE_GROWTH_BASIS;
    metadata.followup_due_date = addDays(record.record_date, FOLLOWUP_DAYS);
    metadata.positive_growth_7d = record.positive_growth_7d ?? null;
  }
  const strategy3SourceDate = markerValue(reason, "策略3來源日");
  return {
    ...record,
    ...metadata,
    ...(strategy3SourceDate ? { source_date: strategy3SourceDate } : {}),
  };
}

function payloadRows(payload = {}) {
  const records = Array.isArray(payload.records) ? payload.records : [];
  const latestDate = cleanText(payload.latestDate || payload.summary?.latestDate);
  return latestDate ? records.filter((row) => cleanText(row.record_date) === latestDate) : records;
}

function sourceReportDates(payload = {}, key = "") {
  return new Set((Array.isArray(payload.sourceReports) ? payload.sourceReports : [])
    .filter((report) => !key || cleanText(report?.key) === key || STRATEGY_KEYS[cleanText(report?.strategy)] === key)
    .map((report) => cleanText(report?.date || report?.tradeDate || report?.usedDate || report?.sourceDate))
    .filter(Boolean)
    .map((date) => {
      const digits = date.replace(/\D/g, "");
      return /^\d{8}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : date.slice(0, 10);
    }));
}

function contractPresent(payload = {}, rows = payloadRows(payload)) {
  if (cleanText(payload.displayRules?.strategyRuleContract) === RULE_CONTRACT) return true;
  return rows.some((row) => cleanText(row.rule_contract) === RULE_CONTRACT || markerValue(row.reason, "規則版本") === RULE_CONTRACT);
}

function addCheck(checks, ok, id, message, detail = {}) {
  checks.push({ id, ok: Boolean(ok), message, detail });
}

function metadataOf(row = {}) {
  const hydrated = hydrateScorecardRuleMetadataFromReason(row);
  const strategy = cleanText(row.strategy);
  const followup = FOLLOWUP_STRATEGIES.has(strategy);
  return {
    rule_contract: cleanText(row.rule_contract || hydrated.rule_contract),
    rule_key: cleanText(row.rule_key || hydrated.rule_key),
    rule_group: cleanText(row.rule_group || hydrated.rule_group),
    rule_tags: Array.isArray(row.rule_tags) && row.rule_tags.length ? row.rule_tags : hydrated.rule_tags,
    entry_price_source: cleanText(row.entry_price_source || hydrated.entry_price_source),
    followup_days: followup ? FOLLOWUP_DAYS : cleanNumber(row.followup_days || hydrated.followup_days),
    followup_rule: followup ? FOLLOWUP_RULE : cleanText(row.followup_rule || hydrated.followup_rule),
    followup_status: followup ? FOLLOWUP_STATUS : cleanText(row.followup_status || hydrated.followup_status),
    followup_due_date: cleanText(row.followup_due_date || hydrated.followup_due_date || (followup ? addDays(row.record_date, FOLLOWUP_DAYS) : "")),
  };
}

function verifyScorecardStrategyRules(payload = {}, options = {}) {
  const source = cleanText(options.source || "scorecard");
  const rows = payloadRows(payload);
  const checks = [];
  const strict = Boolean(options.requireContract) || contractPresent(payload, rows);
  const byStrategy = rows.reduce((map, row) => {
    const strategy = cleanText(row.strategy || "未分類");
    map[strategy] = (map[strategy] || 0) + 1;
    return map;
  }, {});

  addCheck(checks, rows.length > 0, `${source}-strategy-rules-rows`, `${source} has rows for strategy rule lock`, { rows: rows.length });
  addCheck(checks, !options.requireContract || contractPresent(payload, rows), `${source}-strategy-rule-contract`, `${source} must carry ${RULE_CONTRACT}`, {
    requireContract: Boolean(options.requireContract),
    strict,
    displayRules: payload.displayRules || null,
  });

  const pnlMismatches = rows
    .map((row) => {
      const entry = cleanNumber(row.entry_price);
      const high = cleanNumber(row.high_price);
      const pnl = cleanNumber(row.pnl);
      const expected = roundPrice(high - entry);
      return {
        strategy: cleanText(row.strategy),
        ticker: cleanText(row.ticker),
        entry_price: entry,
        high_price: high,
        pnl,
        expected,
        delta: roundPrice(pnl - expected),
      };
    })
    .filter((row) => row.entry_price > 0 && row.high_price > 0 && Math.abs(row.delta) > 0.05);
  addCheck(checks, pnlMismatches.length === 0, `${source}-pnl-formula`, `${source} pnl must equal high_price - entry_price before /88 multiplier`, { samples: pnlMismatches.slice(0, 20), count: pnlMismatches.length });

  for (const rule of WINDOW_RULES) {
    const bad = rows
      .filter((row) => cleanText(row.strategy) === rule.strategy)
      .filter((row) => {
        const minutes = timeMinutes(row.entry_time);
        return minutes === null || minutes < rule.start || minutes > rule.end;
      })
      .map((row) => ({ ticker: cleanText(row.ticker), entry_time: cleanText(row.entry_time) }));
    addCheck(checks, bad.length === 0, `${source}-${STRATEGY_KEYS[rule.strategy]}-window`, `${source} ${rule.strategy} only allows ${rule.label}`, { bad });
  }

  const strategy1Bad = rows
    .filter((row) => cleanText(row.strategy) === "策略1開盤入成績單")
    .filter((row) => timeMinutes(row.entry_time) !== 21 * 60 + 30)
    .map((row) => ({ ticker: cleanText(row.ticker), entry_time: cleanText(row.entry_time) }));
  addCheck(checks, strategy1Bad.length === 0, `${source}-strategy1-2130`, `${source} strategy1 entry_time must be 21:30 carry-forward and settle after close`, { bad: strategy1Bad });

  const strategy3Rows = rows.filter((row) => cleanText(row.strategy) === "策略3隔日沖成績單");
  const strategy3Bad = strategy3Rows
    .filter((row) => timeMinutes(row.entry_time) !== 13 * 60 || !(cleanNumber(row.high_price) >= cleanNumber(row.entry_price)))
    .map((row) => ({ ticker: cleanText(row.ticker), entry_time: cleanText(row.entry_time), entry_price: row.entry_price, high_price: row.high_price }));
  const strategy3BadSource = strategy3Rows
    .filter((row) => {
      const hydrated = hydrateScorecardRuleMetadataFromReason(row);
      const sourceDate = cleanText(row.source_date || hydrated.source_date);
      const reportDates = sourceReportDates(payload, "strategy3");
      if (!sourceDate) return true;
      if (reportDates.size > 0 && !reportDates.has(sourceDate)) return true;
      return false;
    })
    .map((row) => ({ ticker: cleanText(row.ticker), record_date: cleanText(row.record_date), source_date: cleanText(row.source_date || hydrateScorecardRuleMetadataFromReason(row).source_date) }));
  addCheck(checks, strategy3Bad.length === 0, `${source}-strategy3-1300-next-high`, `${source} strategy3 entry_time must be 13:00 and high_price must be the next-day high proxy`, { bad: strategy3Bad });
  addCheck(checks, strategy3BadSource.length === 0, `${source}-strategy3-source-report-date`, `${source} strategy3 source_date must be present and match the Strategy3 source report date`, { bad: strategy3BadSource, sourceReportDates: [...sourceReportDates(payload, "strategy3")] });

  const cbBad = rows
    .filter((row) => cleanText(row.strategy) === "CB成績單")
    .filter((row) => {
      const metadata = metadataOf(row);
      return !(cleanNumber(row.entry_price) > 0 && cleanNumber(row.high_price) >= cleanNumber(row.entry_price))
        || (strict && metadata.entry_price_source !== "stockPrice");
    })
    .map((row) => ({ ticker: cleanText(row.ticker), entry_price: row.entry_price, high_price: row.high_price, entry_price_source: metadataOf(row).entry_price_source }));
  addCheck(checks, cbBad.length === 0, `${source}-cb-stock-price-entry`, `${source} CB entry_price must come from detected stockPrice and be calculable`, { bad: cbBad });

  const followupRows = rows.filter((row) => FOLLOWUP_STRATEGIES.has(cleanText(row.strategy)));
  const followupBad = strict ? followupRows
    .filter((row) => {
      const metadata = metadataOf(row);
      return metadata.rule_contract !== RULE_CONTRACT
        || !metadata.rule_key
        || !metadata.rule_group
        || !Array.isArray(metadata.rule_tags)
        || metadata.rule_tags.length === 0
        || metadata.followup_days !== FOLLOWUP_DAYS
        || metadata.followup_rule !== FOLLOWUP_RULE
        || metadata.followup_status !== FOLLOWUP_STATUS
        || !metadata.followup_due_date;
    })
    .map((row) => ({ strategy: cleanText(row.strategy), ticker: cleanText(row.ticker), metadata: metadataOf(row) })) : [];
  addCheck(checks, !strict || followupBad.length === 0, `${source}-7d-followup-contract`, `${source} strategy4/5/institution/warrant/CB rows must be split into rule items and carry 7-day positive-growth followup`, {
    strict,
    count: followupBad.length,
    samples: followupBad.slice(0, 20),
  });

  const ruleGroupsByStrategy = {};
  for (const row of followupRows) {
    const strategy = cleanText(row.strategy);
    const metadata = metadataOf(row);
    const group = metadata.rule_group || "(missing)";
    ruleGroupsByStrategy[strategy] = ruleGroupsByStrategy[strategy] || {};
    ruleGroupsByStrategy[strategy][group] = (ruleGroupsByStrategy[strategy][group] || 0) + 1;
  }

  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    contract: RULE_CONTRACT,
    strict,
    latestDate: cleanText(payload.latestDate || payload.summary?.latestDate),
    rows: rows.length,
    byStrategy,
    ruleGroupsByStrategy,
    checks,
    issues: failed.map((check) => check.id),
  };
}

module.exports = {
  RULE_CONTRACT,
  FOLLOWUP_DAYS,
  FOLLOWUP_RULE,
  FOLLOWUP_STATUS,
  POSITIVE_GROWTH_BASIS,
  applyScorecardRuleMetadata,
  buildRuleMetadata,
  hydrateScorecardRuleMetadataFromReason,
  markerValue,
  timeMinutes,
  verifyScorecardStrategyRules,
};

