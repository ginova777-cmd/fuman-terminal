"use strict";

function parseChannels(value, fallback = []) {
  const channels = String(value || "")
    .split(",")
    .map((channel) => channel.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(channels.length ? channels : fallback)];
}

function parseChannelLimits(value) {
  const limits = {};
  for (const item of String(value || "").split(",")) {
    const match = item.trim().match(/^([^=]+)=([0-9]+)$/);
    if (!match) continue;
    limits[match[1].trim().toLowerCase()] = Math.max(0, Number(match[2]));
  }
  return limits;
}

function buildSubscriptionBudget(options = {}) {
  const channels = parseChannels(options.channels, []);
  const explicitLimits = options.channelLimits && typeof options.channelLimits === "object"
    ? Object.fromEntries(Object.entries(options.channelLimits).map(([key, value]) => [String(key).toLowerCase(), Math.max(0, Number(value) || 0)]))
    : parseChannelLimits(options.channelLimitsText);
  const maxSymbols = Math.max(0, Number(options.maxSymbols || 0) || 0);
  const maxTotalSubscriptions = Math.max(0, Number(options.maxTotalSubscriptions || 0) || 0);
  const planLimit = Math.max(1, Number(options.planLimit || 2000) || 2000);
  const safetyMargin = Math.max(0, Number(options.safetyMargin ?? 50) || 0);
  const connectionLimit = Math.max(1, Number(options.connectionLimit || 2) || 2);
  const connections = Math.max(1, Number(options.connections || 1) || 1);
  const channelSymbolLimits = {};
  for (const channel of channels) {
    channelSymbolLimits[channel] = Object.prototype.hasOwnProperty.call(explicitLimits, channel)
      ? explicitLimits[channel]
      : maxSymbols;
  }
  const plannedSubscriptions = channels.reduce((sum, channel) => sum + channelSymbolLimits[channel], 0);
  const safeOperationalLimit = Math.max(0, planLimit - safetyMargin);
  const remainingSubscriptions = Math.max(0, planLimit - plannedSubscriptions);
  const budgetOk = plannedSubscriptions <= planLimit
    && (maxTotalSubscriptions === 0 || maxTotalSubscriptions <= planLimit)
    && connections <= connectionLimit;
  const operationalBudgetOk = plannedSubscriptions <= safeOperationalLimit
    && connections <= connectionLimit;
  return {
    rule: "1 symbol x 1 channel",
    channels,
    channelSymbolLimits,
    plannedSubscriptions,
    configuredMaxTotalSubscriptions: maxTotalSubscriptions || plannedSubscriptions,
    planLimit,
    safetyMargin,
    safeOperationalLimit,
    remainingSubscriptions,
    connectionLimit,
    connections,
    budgetOk,
    operationalBudgetOk,
  };
}

module.exports = { parseChannels, parseChannelLimits, buildSubscriptionBudget };