'use strict';
const path=require('path');
const {isTwseTradingDay}=require('../scripts/twse-trading-day');
const {taipeiDateParts,dateKey}=require('../scripts/twse-trading-day');
const taipeiToday=now=>dateKey(taipeiDateParts(now));
async function findPreviousTradingDate(now,stateDir){for(let n=1;n<=14;n++){const day=await isTwseTradingDay(new Date(now.getTime()-n*86400000),{stateDir});if(day.isTradingDay){if(day.error||['stale_cache','weekend_fallback'].includes(day.source))throw Error('STRATEGY4_CALENDAR_UNVERIFIED');return day.date;}}throw Error('STRATEGY4_PREVIOUS_TRADE_DATE_MISSING');}
function targetDate(env=process.env,now=new Date()) {
 const value=env.STRATEGY4_REPLAY_TRADE_DATE;
 if(!value)return taipeiToday(now);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value>=taipeiToday(now))throw Error('STRATEGY4_REPLAY_REQUIRES_COMPLETED_PAST_DATE');
 if(env.STRATEGY4_EXECUTION_MODE!=='recovery_replay')throw Error('STRATEGY4_REPLAY_MODE_REQUIRED');
 return value;
}
async function validateReplay(env=process.env,now=new Date()) {
 const date=targetDate(env,now),stateDir=env.FUMAN_STATE_DIR||path.join(env.FUMAN_RUNTIME_DIR||'C:/fuman-runtime','state');
 if(!env.STRATEGY4_REPLAY_TRADE_DATE)throw Error('STRATEGY4_REPLAY_DATE_REQUIRED');
 const day=await isTwseTradingDay(new Date(date+'T12:00:00+08:00'),{stateDir});
 if(!day.isTradingDay||['weekend_fallback','stale_cache'].includes(day.source)||day.error)throw Error('STRATEGY4_REPLAY_CALENDAR_UNVERIFIED');
 const previous=await findPreviousTradingDate(now,stateDir);
 if(date!==previous)throw Error('STRATEGY4_REPLAY_MUST_USE_LAST_TRADING_DAY');
 return {contract:'strategy4_recovery_date_v1',scope:'recovery_replay',tradeDate:date,executionDate:taipeiToday(now),checkedAt:now.toISOString(),naturalSlotComplete:false,calendar:day};
}

function compact(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }
function iso(value) {
 const d=compact(value);
 return /^\d{8}$/.test(d) ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : "";
}

/**
 * Morning handoff contract: a completed previous-trading-day Strategy 4
 * source is carried into today's execution without mutating the old receipt.
 */
async function resolveMorningHandoff({ sourceReceipt, executionDate, now = new Date(), stateDir } = {}) {
 const execution = iso(executionDate) || taipeiToday(now);
 const calendar = await isTwseTradingDay(new Date(`${execution}T12:00:00+08:00`), { stateDir });
 if (!calendar?.isTradingDay) {
   const previous = await findPreviousTradingDate(new Date(`${execution}T12:00:00+08:00`), stateDir);
   return { ok: false, status: "BLOCKED", reason_code: "MARKET_CLOSED", execution_trade_date: execution, previous_completed_trade_date: previous || null };
 }
 const sourceDate = iso(sourceReceipt?.scanDate || sourceReceipt?.tradeDate || sourceReceipt?.expectedDate || sourceReceipt?.sourceDate);
 const expectedSource = await findPreviousTradingDate(new Date(`${execution}T12:00:00+08:00`), stateDir);
 const failures=[];
 if (!sourceReceipt || typeof sourceReceipt !== "object") failures.push("SOURCE_NOT_READY");
 if (sourceDate !== expectedSource) failures.push(sourceDate ? "SOURCE_DATE_MISMATCH" : "SOURCE_NOT_READY");
 if (sourceReceipt?.complete !== true && sourceReceipt?.published?.complete !== true) failures.push("SOURCE_NOT_READY");
 const sourceRunId = String(sourceReceipt?.runId || sourceReceipt?.published?.runId || "");
 if (!sourceRunId || !new RegExp(`^strategy4-${compact(sourceDate)}-\\d{14}$`).test(sourceRunId)) failures.push("SOURCE_RUN_MISMATCH");
 const strategyVersion = String(sourceReceipt?.strategy_version || sourceReceipt?.strategyVersion || sourceReceipt?.published?.strategy_version || "strategy4");
 if (strategyVersion !== "strategy4") failures.push("SOURCE_STRATEGY_VERSION_MISMATCH");
 const expectedCanonical = `strategy4:${compact(sourceDate)}:canonical`;
 const suppliedCanonical = String(sourceReceipt?.canonical_run_id || sourceReceipt?.canonicalRunId || "");
 const canonical = suppliedCanonical || expectedCanonical;
 if (suppliedCanonical && suppliedCanonical !== expectedCanonical) failures.push("SOURCE_CANONICAL_MISMATCH");
 const checkedAt = Date.parse(sourceReceipt?.checked_at || sourceReceipt?.finishedAt || sourceReceipt?.published?.checked_at || "");
 const maxAgeDays = Number(process.env.STRATEGY4_HANDOFF_MAX_AGE_DAYS || 3);
 if (!Number.isFinite(checkedAt)) failures.push("SOURCE_TIMESTAMP_MISSING");
 else if ((now.getTime()-checkedAt) > maxAgeDays*86400000) failures.push("STALE_SOURCE");
 return {
   contract: "strategy4_morning_handoff_v1",
   ok: failures.length===0,
   status: failures.length===0 ? "READY" : "BLOCKED",
   reason_code: failures[0] || null,
   failed_checks: [...new Set(failures)],
   strategy_source_date: sourceDate || null,
   handoff_trade_date: execution,
   handoff_run_id: `morning-handoff:${compact(execution)}:${sourceRunId || "missing"}`,
   source_run_id: sourceRunId || null,
   source_strategy_version: strategyVersion,
   source_canonical_run_id: canonical || null,
   checked_at: now.toISOString(),
   source_checked_at: Number.isFinite(checkedAt) ? new Date(checkedAt).toISOString() : null,
   previous_completed_trade_date: expectedSource || null,
 };
}
module.exports={targetDate,validateReplay,resolveMorningHandoff};
