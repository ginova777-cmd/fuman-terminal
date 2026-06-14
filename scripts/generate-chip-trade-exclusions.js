const fs = require("fs");
const path = require("path");

const { dataPath } = require("./runtime-paths");
const { loadChipTradeBlacklist, MIN_AVG_VOLUME_LOTS_5, MIN_INNER_OUTER_LOTS } = require("../lib/chip-trade-exclusions");

const OUT_FILE = dataPath("chip-trade-exclusions.json");

function main() {
  const blacklistCodes = [...loadChipTradeBlacklist()].sort();
  const payload = {
    ok: true,
    source: "chip-trade-exclusions",
    generatedAt: new Date().toISOString(),
    criteria: {
      excludedProducts: "ETF / 00開頭 / 權證 / 可轉債 / 黑名單 / 水泥 / 軍工",
      minFiveDayAvgVolumeLots: MIN_AVG_VOLUME_LOTS_5,
      minInnerOuterLots: MIN_INNER_OUTER_LOTS,
      fallbackWhenInnerOuterMissing: "tradeVolume < 3000 lots",
    },
    blacklistCodes,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`chip trade exclusions generated: blacklist=${blacklistCodes.length} file=${OUT_FILE}`);
}

main();
