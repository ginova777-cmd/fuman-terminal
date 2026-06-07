const fs = require("fs/promises");
const path = require("path");

const CBAS_BASE = "https://cbas16889.pscnet.com.tw/api/CbasQuote";
const OUT_FILE = path.join(__dirname, "..", "data", "cb-detect-latest.json");

const SOURCES = [
  { layer: "第一層：MOPS董事會決議", stage: "董事會決議", url: `${CBAS_BASE}/GetBoardAnnouncement` },
  { layer: "第二層：CBAS預計發行", stage: "生效後", url: `${CBAS_BASE}/GetRecentlyEffectively` },
  { layer: "第三層：CBAS已發行（近期掛牌）", stage: "已發行", url: `${CBAS_BASE}/GetRecentlyListed` },
];

function num(value) {
  if (value === undefined || value === null || value === "") return 0;
  return Number(String(value).replace(/[,%]/g, "").trim()) || 0;
}

function isAuction(text) {
  return String(text || "").includes("競拍");
}

function premiumValue(row) {
  const issuedPremium = num(row.premium_rate);
  if (issuedPremium) return issuedPremium;
  const raw = num(row.conversion_premium_rate || row.tentative_premium_rate);
  if (!raw) return 0;
  return raw > 100 ? raw - 100 : raw;
}

function scoreRow(row, source) {
  let score = 0;
  const tags = [];
  const circulation = num(row.circulation);
  const premium = premiumValue(row);
  const auction = isAuction(row.inquiry_auction);

  if (source.stage === "董事會決議") {
    score += 15;
    tags.push("最早期4~8週");
  } else if (source.stage === "生效後") {
    score += 20;
    tags.push("生效後確定性較高");
  } else {
    score += 10;
    tags.push("掛牌後追蹤");
  }

  if (auction) {
    score += 25;
    tags.push("競價拍賣 +25");
  } else if (row.inquiry_auction) {
    tags.push("詢價圈購");
  }

  if (circulation > 0 && circulation <= 10) {
    score += 15;
    tags.push("發行規模10億以下 +15");
  } else if (circulation > 20) {
    tags.push("發行規模偏大");
  }

  if (premium > 0 && premium <= 20) {
    score += 15;
    tags.push("轉換溢價20%以下 +15");
  } else if (premium > 30) {
    tags.push("溢價偏高");
  }

  tags.push("技術面待確認");
  tags.push("MA200未確認，不能積極進場");

  return { score: Math.min(105, score), tags };
}

function normalize(row, source) {
  const code = String(row.code || row.convert_target_code || "").trim();
  const cbCode = String(row.cb_code || row.bond_code || "").trim();
  const cbName = String(row.cb_name || row.underlying_bond || "").trim();
  const premium = premiumValue(row);
  const scored = scoreRow(row, source);
  return {
    sourceLayer: source.layer,
    stage: source.stage,
    code,
    cbCode,
    name: code || cbCode,
    cbName,
    issueAmount: row.circulation || "",
    auctionType: row.inquiry_auction || "",
    convertPrice: num(row.conversion_price),
    stockPrice: num(row.underlying_stock_market_price),
    premium,
    date: row.announcement_day || row.expected_effective_date || row.listing_day || row.issue_date || "",
    tcri: row.tcri || row.guarantee_situation || "",
    baseScore: scored.score,
    score: scored.score,
    aboveMa200: null,
    maAlignedUp: null,
    macdBullish: null,
    veto: false,
    tags: scored.tags,
    raw: row,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  const json = await response.json();
  if (json.statusClass !== 1 || !Array.isArray(json.result)) {
    throw new Error(`${url} unexpected response`);
  }
  return json.result;
}

async function main() {
  const rows = [];
  const sourceCounts = {};
  for (const source of SOURCES) {
    const data = await fetchJson(source.url);
    sourceCounts[source.layer] = data.length;
    rows.push(...data.map((row) => normalize(row, source)));
  }

  const candidates = rows
    .filter((row) => row.code || row.cbCode)
    .sort((a, b) => b.score - a.score || num(a.issueAmount) - num(b.issueAmount));

  const payload = {
    ok: true,
    source: "CBAS",
    updatedAt: new Date().toISOString(),
    sourceCounts,
    scoringNote: "CBAS only supplies CB source/issuance terms. Technical indicators are marked pending until MA200/MA/MACD data is connected.",
    rows: candidates,
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`wrote ${OUT_FILE} (${candidates.length} rows)`);
  console.log(candidates.slice(0, 12).map((row) => `${row.score} ${row.sourceLayer} ${row.code} ${row.cbName} ${row.tags.join(" / ")}`).join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
