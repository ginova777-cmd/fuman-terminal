function buildDaytradeIndustryPrewarm(config, activeUniverseSymbols = []) {
  if (!config || config.contract !== "daytrade_industry_prewarm_v1" || !Array.isArray(config.industries)) {
    throw new Error("daytrade_industry_prewarm_config_invalid");
  }
  const activeUniverse = new Set(activeUniverseSymbols.map((value) => String(value || "").trim()).filter((value) => /^\d{4}$/.test(value)));
  const bySymbol = new Map();
  const missingSymbols = new Set();
  for (const industry of config.industries) {
    const industryName = String(industry?.name || "").trim();
    for (const member of Array.isArray(industry?.members) ? industry.members : []) {
      const symbol = String(member?.symbol || "").trim();
      const tier = String(member?.tier || "").trim().toUpperCase();
      if (!/^\d{4}$/.test(symbol) || !["A", "B", "C"].includes(tier) || !industryName) continue;
      if (!activeUniverse.has(symbol)) {
        missingSymbols.add(symbol);
        continue;
      }
      const entry = bySymbol.get(symbol) || { symbol, tiers: [], industries: [] };
      if (!entry.tiers.includes(tier)) entry.tiers.push(tier);
      if (!entry.industries.some((item) => item.name === industryName)) entry.industries.push({ name: industryName, tier });
      bySymbol.set(symbol, entry);
    }
  }
  const contractSafe = config.mode === "priority_prewarm_only"
    && config.formal_candidate_allowed === false
    && config.publish_allowed === false;
  return {
    contract: config.contract,
    mode: config.mode,
    formalCandidateAllowed: config.formal_candidate_allowed,
    publishAllowed: config.publish_allowed,
    symbols: [...bySymbol.values()]
      .sort((a, b) => Number(!a.tiers.includes("A")) - Number(!b.tiers.includes("A")))
      .map((entry) => entry.symbol),
    bySymbol: Object.fromEntries(bySymbol),
    missingSymbols: [...missingSymbols],
    status: !contractSafe ? "blocked" : (missingSymbols.size === 0 ? "ready" : "degraded"),
  };
}

module.exports = { buildDaytradeIndustryPrewarm };
