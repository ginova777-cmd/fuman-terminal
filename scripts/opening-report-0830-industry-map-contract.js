"use strict";

const SOURCE = "opening_report_0830_industry_map_contract";
const CONTRACT = "opening-report-0830-industry-map-v2";
const MAPPING_REVIEWED_AT = "2026-09-09";
const MAPPING_EVIDENCE_AUTHORITIES = [
  "TWSE_MOPS_COMPANY_PROFILE_AND_ANNUAL_REPORT",
  "TPEx_MOPS_COMPANY_PROFILE_AND_ANNUAL_REPORT",
  "ISSUER_OFFICIAL_PRODUCT_AND_INVESTOR_RELATIONS",
];

const FORBIDDEN_OVERSEAS_LEADERS = ["新光電工", "WCI", "SCFI", "BDI"];

const INDUSTRY_REVIEW_BASIS = {
  AI_GPU_CLOUD: { A: "AI伺服器、GPU伺服器或雲端運算系統為直接產品", B: "晶片、電源或散熱零組件供應AI伺服器產業鏈" },
  AWS_AI_DATACENTER: { A: "CSP／AI資料中心運算板、伺服器或散熱為直接產品", B: "ASIC、電源或系統整合屬資料中心相鄰供應鏈" },
  FOUNDRY_ADVANCED_PROCESS: { A: "晶圓代工、廠務、設備、載具或再生晶圓直接服務先進製程", B: "測試與封裝為晶圓製造後段相鄰供應鏈" },
  IC_DESIGN: { A: "IC設計或ASIC設計服務為核心業務", B: "晶圓製造或封裝為IC設計的相鄰供應鏈" },
  MEMORY: { A: "記憶體晶片、控制器、模組或儲存產品為核心業務", B: "記憶體相關產品明確但產品組合較分散" },
  ABF_SUBSTRATE: { A: "ABF IC載板為直接產品", B: "高階CCL或PCB為ABF載板相鄰材料／板級供應鏈" },
  PCB_CCL: { A: "PCB、CCL或銅箔為直接產品", B: "IC載板、玻纖布或FCCL為相鄰板材供應鏈" },
  PASSIVE_COMPONENTS: { A: "電阻、電容或電感等被動元件為直接產品", B: "被動元件通路或產品組合中的相鄰供應" },
  THERMAL_POWER: { A: "散熱、風扇、電源或熱管理為直接產品", B: "電源模組、機構件或熱管理材料為相鄰供應鏈" },
  NETWORK_HIGH_SPEED: { A: "交換器、路由器、寬頻或網通設備為直接產品", B: "光通訊、連接或終端設備為高速網路相鄰供應鏈" },
  OPTICAL_COMM: { A: "光纖元件、光模組、雷射或光通訊設備為直接產品", B: "光電材料、封裝或交換設備為光通訊相鄰供應鏈", C: "僅具半導體測試／封裝題材，未證明光通訊為直接或相鄰主要業務" },
  III_V_OPTICAL: { A: "III-V晶圓、磊晶或化合物半導體製造為直接業務", B: "III-V材料、濾光片或磊晶基板為相鄰供應鏈" },
  ROBOTICS_AUTOMATION: { A: "傳動、氣動、機器視覺或自動化設備為直接產品", B: "馬達、控制器、系統製造或自動化整合為相鄰供應鏈" },
  PANEL: { A: "面板製造為核心業務", B: "背光、偏光片或顯示驅動IC為面板相鄰供應鏈" },
  APPLE_CONSUMER: { A: "消費電子組裝、鏡頭、機構件或觸控模組為直接產品", B: "晶片、被動元件或代工組裝為消費電子相鄰供應鏈" },
};

function reviewedStock(row, symbol, name, grade, relationshipType, mappingStatus) {
  const basis = INDUSTRY_REVIEW_BASIS[row.industry]?.[grade] || "產業關聯證據不足";
  return {
    symbol, name, tier: grade, mapping_grade: grade, relationship_type: relationshipType,
    mapping_status: mappingStatus, mapping_industry: row.industry,
    mapping_reason: `${name}（${symbol}）：${basis}`,
    mapping_reviewed_at: MAPPING_REVIEWED_AT,
    evidence_authorities: MAPPING_EVIDENCE_AUTHORITIES,
    evidence_urls: [
      `https://ic.tpex.org.tw/company_basic.php?stk_code=${symbol}`,
      "https://mops.twse.com.tw/mops/web/t100sb01_1",
    ],
  };
}

const OPENING_REPORT_0830_INDUSTRY_MAP = [
  {
    industry: "AI_GPU_CLOUD",
    display_name: "AI GPU／雲端",
    default_bias: "neutral_mixed",
    default_confidence: 0.66,
    evidence_summary: "NVDA、AMD、AVGO、DELL、SMCI 作為 AI GPU/雲端 proxy；正式進場仍等台股 evidence。",
    overseas_leaders: [["NVDA", "NVDA"], ["AMD", "AMD"], ["AVGO", "AVGO"], ["DELL", "DELL"], ["SMCI", "SMCI"]],
    a: [["2382", "廣達"], ["3231", "緯創"], ["6669", "緯穎"], ["2356", "英業達"], ["2376", "技嘉"], ["2317", "鴻海"]],
    b: [["2330", "台積電"], ["2308", "台達電"], ["3017", "奇鋐"], ["3324", "雙鴻"], ["3653", "健策"]],
  },
  {
    industry: "AWS_AI_DATACENTER",
    display_name: "AWS 雲端／AI 資料中心",
    default_bias: "neutral_mixed",
    default_confidence: 0.64,
    evidence_summary: "AMZN、MSFT、GOOGL、META 作為雲端/CSP proxy；只做母池 priority bias。",
    overseas_leaders: [["AMZN", "AMZN"], ["MSFT", "MSFT"], ["GOOGL", "GOOGL"], ["META", "META"]],
    a: [["3661", "世芯-KY"], ["2368", "金像電"], ["3017", "奇鋐"], ["3324", "雙鴻"], ["2382", "廣達"], ["6669", "緯穎"]],
    b: [["3443", "創意"], ["2308", "台達電"], ["2317", "鴻海"]],
  },
  {
    industry: "FOUNDRY_ADVANCED_PROCESS",
    display_name: "晶圓代工／先進製程",
    default_bias: "neutral_mixed",
    default_confidence: 0.70,
    evidence_summary: "TSM、ASML、AMAT、LRCX、KLAC 作為先進製程 proxy。",
    overseas_leaders: [["TSM", "TSM"], ["ASML", "ASML"], ["AMAT", "AMAT"], ["LRCX", "LRCX"], ["KLAC", "KLAC"]],
    a: [["2330", "台積電"], ["2404", "漢唐"], ["6196", "帆宣"], ["3680", "家登"], ["3131", "弘塑"], ["3583", "辛耘"], ["8028", "昇陽半導體"]],
    b: [["2360", "致茂"], ["6515", "穎崴"], ["6223", "旺矽"], ["3711", "日月光投控"]],
  },
  {
    industry: "IC_DESIGN",
    display_name: "IC 設計",
    default_bias: "neutral_mixed",
    default_confidence: 0.63,
    evidence_summary: "NVDA、AMD、QCOM、AVGO、MRVL 作為 IC 設計 proxy；等台股權值與 ASIC 同步。",
    overseas_leaders: [["NVDA", "NVDA"], ["AMD", "AMD"], ["QCOM", "QCOM"], ["AVGO", "AVGO"], ["MRVL", "MRVL"]],
    a: [["2454", "聯發科"], ["3661", "世芯-KY"], ["3443", "創意"], ["2379", "瑞昱"], ["3034", "聯詠"]],
    b: [["2330", "台積電"], ["3711", "日月光投控"], ["6415", "矽力*-KY"]],
  },
  {
    industry: "MEMORY",
    display_name: "記憶體",
    default_bias: "neutral_mixed",
    default_confidence: 0.74,
    evidence_summary: "MU、SK hynix、Samsung Electronics 作為記憶體 proxy；偏強時列前段觀察。",
    overseas_leaders: [["MU", "MU"], ["SK hynix", "000660.KS"], ["Samsung Electronics", "005930.KS"]],
    a: [["2408", "南亞科"], ["2344", "華邦電"], ["6770", "力積電"], ["8299", "群聯"], ["3260", "威剛"]],
    b: [["2337", "旺宏"], ["3006", "晶豪科"], ["5351", "鈺創"]],
  },
  {
    industry: "ABF_SUBSTRATE",
    display_name: "ABF 載板",
    default_bias: "neutral_mixed",
    default_confidence: 0.61,
    evidence_summary: "Ibiden、Samsung Electro-Mechanics、Daeduck 作為 ABF proxy；新光電工不得列入 08:30 偵測來源。",
    overseas_leaders: [["Ibiden", "4062.T"], ["Samsung Electro-Mechanics", "009150.KS"], ["Daeduck", "353200.KS"]],
    a: [["3037", "欣興"], ["8046", "南電"], ["3189", "景碩"]],
    b: [["2383", "台光電"], ["6274", "台燿"], ["2368", "金像電"]],
  },
  {
    industry: "PCB_CCL",
    display_name: "PCB／CCL",
    default_bias: "neutral_mixed",
    default_confidence: 0.78,
    evidence_summary: "MEIKO、CMK、Daeduck、Simmtech、藤倉作為 PCB/CCL proxy；8358 金居固定列入 A。",
    overseas_leaders: [["MEIKO", "6787.T"], ["CMK", "6958.T"], ["Daeduck", "353200.KS"], ["Simmtech", "222800.KQ"], ["藤倉", "5803.T", "yahoo_japan_quote"]],
    a: [["2383", "台光電"], ["6274", "台燿"], ["2368", "金像電"], ["3044", "健鼎"], ["4958", "臻鼎-KY"], ["2313", "華通"], ["8358", "金居"], ["6213", "聯茂"]],
    b: [["3037", "欣興"], ["8046", "南電"], ["3189", "景碩"], ["5469", "瀚宇博"], ["1815", "富喬"], ["8039", "台虹"]],
  },
  {
    industry: "PASSIVE_COMPONENTS",
    display_name: "被動元件",
    default_bias: "neutral_mixed",
    default_confidence: 0.55,
    evidence_summary: "Murata / 6981.T 作為日股被動元件唯一主錨；被動元件只看村田，不混太陽誘電、TDK、京瓷、Samsung Electro-Mechanics 或 Vishay。",
    overseas_leaders: [["Murata", "6981.T"]],
    a: [["2327", "國巨"], ["2492", "華新科"], ["3026", "禾伸堂"], ["6173", "信昌電"], ["2375", "凱美"]],
    b: [["2472", "立隆電"], ["2456", "奇力新"], ["6449", "鈺邦"], ["6284", "佳邦"], ["8043", "蜜望實"]],
  },
  {
    industry: "THERMAL_POWER",
    display_name: "散熱／電源",
    default_bias: "neutral_mixed",
    default_confidence: 0.60,
    evidence_summary: "Vertiv、Eaton、Nidec、Modine 作為散熱/電源 proxy；只看強者恆強與量能續航。",
    overseas_leaders: [["Vertiv", "VRT"], ["Eaton", "ETN"], ["Nidec", "6594.T"], ["Modine", "MOD"]],
    a: [["2308", "台達電"], ["2301", "光寶科"], ["3017", "奇鋐"], ["3324", "雙鴻"], ["2421", "建準"], ["3653", "健策"]],
    b: [["6412", "群電"], ["6282", "康舒"], ["6805", "富世達"], ["6271", "同欣電"]],
  },
  {
    industry: "NETWORK_HIGH_SPEED",
    display_name: "網通／高速傳輸",
    default_bias: "neutral_mixed",
    default_confidence: 0.58,
    evidence_summary: "ANET、AVGO、CSCO、MRVL、Nokia 作為網通/高速傳輸 proxy。",
    overseas_leaders: [["ANET", "ANET"], ["AVGO", "AVGO"], ["CSCO", "CSCO"], ["MRVL", "MRVL"], ["Nokia", "NOK"]],
    a: [["2345", "智邦"], ["6285", "啟碁"], ["5388", "中磊"], ["4906", "正文"], ["3380", "明泰"]],
    b: [["3450", "聯鈞"], ["3363", "上詮"], ["3596", "智易"], ["4908", "前鼎"]],
  },
  {
    industry: "OPTICAL_COMM",
    display_name: "光通訊／CPO／矽光子",
    default_bias: "neutral_mixed",
    default_confidence: 0.57,
    evidence_summary: "COHR、LITE、CIEN、AAOI、GLW 作為美股光通訊 proxy；光通訊只看美股，4979 華星光固定列入 A。",
    overseas_leaders: [["COHR", "COHR"], ["LITE", "LITE"], ["CIEN", "CIEN"], ["AAOI", "AAOI"], ["GLW", "GLW"]],
    a: [["3363", "上詮"], ["6442", "光聖"], ["4979", "華星光"], ["3163", "波若威"], ["3081", "聯亞"], ["3450", "聯鈞"], ["4977", "眾達-KY"], ["4908", "前鼎"]],
    b: [["4991", "環宇-KY"], ["2455", "全新"], ["3234", "光環"], ["6451", "訊芯-KY"], ["2345", "智邦"]],
    c: [["3711", "日月光投控"], ["6223", "旺矽"], ["6515", "穎崴"]],
  },
  {
    industry: "III_V_OPTICAL",
    display_name: "III-V 材料／光通訊",
    default_bias: "neutral_mixed",
    default_confidence: 0.54,
    evidence_summary: "AXTI、Coherent 作為 III-V proxy；3105 穩懋固定列入 A。",
    overseas_leaders: [["AXTI", "AXTI"], ["Coherent", "COHR"]],
    a: [["3105", "穩懋"], ["3081", "聯亞"], ["2455", "全新"], ["8086", "宏捷科"]],
    b: [["4991", "環宇-KY"], ["6426", "統新"], ["4971", "IET-KY"]],
  },
  {
    industry: "ROBOTICS_AUTOMATION",
    display_name: "機器人／自動化",
    default_bias: "neutral_mixed",
    default_confidence: 0.52,
    evidence_summary: "FANUC、安川、Keyence、SMC 作為機器人/自動化 proxy。",
    overseas_leaders: [["FANUC", "6954.T"], ["安川", "6506.T"], ["Keyence", "6861.T"], ["SMC", "6273.T"]],
    a: [["2049", "上銀"], ["1590", "亞德客-KY"], ["1597", "直得"], ["2359", "所羅門"], ["4540", "全球傳動"]],
    b: [["2308", "台達電"], ["1504", "東元"], ["2371", "大同"], ["2356", "英業達"], ["2464", "盟立"]],
  },
  {
    industry: "PANEL",
    display_name: "面板",
    default_bias: "neutral_mixed",
    default_confidence: 0.50,
    evidence_summary: "LG Display、Samsung Display proxy 作為面板 proxy；BOE／中國市場來源不列入正式晨報排序。",
    overseas_leaders: [["LG Display", "034220.KS"], ["Samsung Display proxy", "005930.KS"]],
    a: [["2409", "友達"], ["3481", "群創"], ["6116", "彩晶"]],
    b: [["4935", "茂林-KY"], ["4960", "誠美材"], ["3592", "瑞鼎"]],
  },
  {
    industry: "APPLE_CONSUMER",
    display_name: "蘋果／消費電子",
    default_bias: "neutral_mixed",
    default_confidence: 0.49,
    evidence_summary: "AAPL、QCOM、Sony、Hon Hai ADR proxy 作為蘋果/消費電子 proxy。",
    overseas_leaders: [["AAPL", "AAPL"], ["QCOM", "QCOM"], ["Sony", "SONY"], ["Hon Hai ADR proxy", "HNHPF"]],
    a: [["2317", "鴻海"], ["3008", "大立光"], ["2474", "可成"], ["3673", "TPK-KY"]],
    b: [["2330", "台積電"], ["2327", "國巨"], ["4938", "和碩"], ["2354", "鴻準"]],
  },
].map((row, index) => ({
  ...row,
  mapping_contract: CONTRACT,
  mapping_reviewed_at: MAPPING_REVIEWED_AT,
  mapping_evidence_authorities: MAPPING_EVIDENCE_AUTHORITIES,
  priority_rank: index + 1,
  overseas_leaders: row.overseas_leaders.map(([name, yahoo_symbol, source_provider = ""]) => ({ name, yahoo_symbol, source_provider })),
  review_basis: INDUSTRY_REVIEW_BASIS[row.industry],
  a: row.a.map(([symbol, name]) => reviewedStock(row, symbol, name, "A", "direct_product_or_revenue_exposure", "reviewed")),
  b: row.b.map(([symbol, name]) => reviewedStock(row, symbol, name, "B", "adjacent_supply_chain_or_end_demand", "reviewed")),
  c: (row.c || []).map(([symbol, name]) => reviewedStock(row, symbol, name, "C", "theme_only_or_unverified", "observation_only")),
}));

const EXPECTED_INDUSTRIES = OPENING_REPORT_0830_INDUSTRY_MAP.map((row) => ({
  industry: row.industry,
  display_name: row.display_name,
  overseas: row.overseas_leaders.map((leader) => leader.name),
  a: row.a.map((stock) => stock.symbol),
  b: row.b.map((stock) => stock.symbol),
  c: row.c.map((stock) => stock.symbol),
}));

function pairs(rows) {
  return rows.map((row) => [row.symbol, row.name]);
}

function leaderPairs(row) {
  return row.overseas_leaders.map((leader) => [leader.name, leader.yahoo_symbol, leader.source_provider || ""]);
}

function hasSymbol(row, tier, symbol) {
  const key = String(symbol);
  const rows = tier === "A" ? row.a : row.b;
  return rows.some((item) => String(item.symbol) === key);
}

function listEqual(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return expected.every((value, index) => String(actual[index]) === String(value));
}

function validateIndustryMapContract(rows = OPENING_REPORT_0830_INDUSTRY_MAP) {
  const issues = [];
  if (!Array.isArray(rows) || rows.length !== 15) issues.push(`industry_map_count_mismatch:${Array.isArray(rows) ? rows.length : "not_array"}:expected_15`);
  const seen = new Set();
  rows.forEach((row, index) => {
    if (!row.industry) issues.push(`industry_missing_at_index:${index}`);
    if (seen.has(row.industry)) issues.push(`industry_duplicate:${row.industry}`);
    seen.add(row.industry);
    if (row.priority_rank !== index + 1) issues.push(`priority_rank_mismatch:${row.industry}:${row.priority_rank}:expected_${index + 1}`);
    if (!row.display_name) issues.push(`display_name_missing:${row.industry}`);
    if (!Array.isArray(row.overseas_leaders) || row.overseas_leaders.length === 0) issues.push(`overseas_leaders_missing:${row.industry}`);
    if (!Array.isArray(row.a) || row.a.length === 0) issues.push(`tier_a_missing:${row.industry}`);
    if (!Array.isArray(row.b) || row.b.length === 0) issues.push(`tier_b_missing:${row.industry}`);
    for (const leader of row.overseas_leaders || []) {
      if (!leader.name || !leader.yahoo_symbol) issues.push(`overseas_leader_identity_missing:${row.industry}:${leader.name || "unknown"}`);
      if (FORBIDDEN_OVERSEAS_LEADERS.includes(String(leader.name))) issues.push(`forbidden_overseas_leader:${row.industry}:${leader.name}`);
    }
    for (const stockRow of [...(row.a || []), ...(row.b || [])]) {
      if (!/^\d{4}$/.test(String(stockRow.symbol || ""))) issues.push(`taiwan_symbol_invalid:${row.industry}:${stockRow.symbol || "unknown"}`);
      if (!stockRow.name) issues.push(`taiwan_symbol_name_missing:${row.industry}:${stockRow.symbol || "unknown"}`);
      if (stockRow.mapping_status !== "reviewed") issues.push(`mapping_not_reviewed:${row.industry}:${stockRow.symbol || "unknown"}`);
      if (!['A', 'B'].includes(stockRow.mapping_grade) || stockRow.mapping_grade !== stockRow.tier) issues.push(`mapping_grade_invalid:${row.industry}:${stockRow.symbol || "unknown"}`);
      if (stockRow.mapping_industry !== row.industry) issues.push(`mapping_industry_mismatch:${row.industry}:${stockRow.symbol || "unknown"}`);
      if (!stockRow.relationship_type) issues.push(`mapping_relationship_missing:${row.industry}:${stockRow.symbol || "unknown"}`);
      if (!stockRow.mapping_reason || !stockRow.mapping_reason.includes(stockRow.name) || !stockRow.mapping_reason.includes(stockRow.symbol)) issues.push(`mapping_reason_missing:${row.industry}:${stockRow.symbol || "unknown"}`);
      if (stockRow.mapping_reviewed_at !== MAPPING_REVIEWED_AT) issues.push(`mapping_review_date_invalid:${row.industry}:${stockRow.symbol || "unknown"}`);
      if (!Array.isArray(stockRow.evidence_authorities) || stockRow.evidence_authorities.length < 2) issues.push(`mapping_evidence_authority_missing:${row.industry}:${stockRow.symbol || "unknown"}`);
      if (!Array.isArray(stockRow.evidence_urls) || stockRow.evidence_urls.length < 2 || !stockRow.evidence_urls.every((url) => /^https:\/\//.test(url))) issues.push(`mapping_evidence_url_missing:${row.industry}:${stockRow.symbol || "unknown"}`);
    }
    for (const stockRow of row.c || []) {
      if (!/^\d{4}$/.test(String(stockRow.symbol || ""))) issues.push(`taiwan_symbol_invalid:${row.industry}:${stockRow.symbol || "unknown"}`);
      if (!stockRow.name) issues.push(`taiwan_symbol_name_missing:${row.industry}:${stockRow.symbol || "unknown"}`);
      if (stockRow.mapping_status !== "observation_only" || stockRow.mapping_grade !== "C" || stockRow.tier !== "C") issues.push(`tier_c_status_invalid:${row.industry}:${stockRow.symbol || "unknown"}`);
      if (stockRow.mapping_industry !== row.industry || stockRow.relationship_type !== "theme_only_or_unverified") issues.push(`tier_c_relationship_invalid:${row.industry}:${stockRow.symbol || "unknown"}`);
      if (!stockRow.mapping_reason || !Array.isArray(stockRow.evidence_urls) || stockRow.evidence_urls.length < 2) issues.push(`tier_c_evidence_missing:${row.industry}:${stockRow.symbol || "unknown"}`);
    }
    const tierA = new Set((row.a || []).map((stockRow) => String(stockRow.symbol || "")));
    const prioritized = new Set([...(row.a || []), ...(row.b || [])].map((stockRow) => String(stockRow.symbol || "")));
    for (const stockRow of row.b || []) {
      if (tierA.has(String(stockRow.symbol || ""))) issues.push(`tier_a_b_overlap:${row.industry}:${stockRow.symbol}`);
    }
    for (const stockRow of row.c || []) {
      if (prioritized.has(String(stockRow.symbol || ""))) issues.push(`tier_c_priority_overlap:${row.industry}:${stockRow.symbol}`);
    }
  });
  const byIndustry = new Map(rows.map((row) => [row.industry, row]));
  const optical = byIndustry.get("OPTICAL_COMM");
  if (!optical || !hasSymbol(optical, "A", "4979")) issues.push("hard_anchor_missing:OPTICAL_COMM:A:4979");
  const pcb = byIndustry.get("PCB_CCL");
  if (!pcb || !hasSymbol(pcb, "A", "8358")) issues.push("hard_anchor_missing:PCB_CCL:A:8358");
  const iiiV = byIndustry.get("III_V_OPTICAL");
  if (!iiiV || !hasSymbol(iiiV, "A", "3105")) issues.push("hard_anchor_missing:III_V_OPTICAL:A:3105");
  const passive = byIndustry.get("PASSIVE_COMPONENTS");
  if (!passive || !hasSymbol(passive, "B", "2472")) issues.push("hard_anchor_missing:PASSIVE_COMPONENTS:B:2472");
  if (passive) {
    const passiveLeaders = Array.isArray(passive.overseas_leaders) ? passive.overseas_leaders : [];
    const murataOnly = passiveLeaders.length === 1
      && passiveLeaders[0]?.name === "Murata"
      && passiveLeaders[0]?.yahoo_symbol === "6981.T";
    if (!murataOnly) issues.push("hard_anchor_invalid:PASSIVE_COMPONENTS:overseas_must_be_murata_6981T_only");
  }
  const panel = byIndustry.get("PANEL");
  if (panel && panel.overseas_leaders.some((leader) => leader.name === "BOE" || leader.yahoo_symbol === "000725.SZ")) issues.push("forbidden_panel_leader:BOE");
  const robotics = byIndustry.get("ROBOTICS_AUTOMATION");
  if (!robotics || !hasSymbol(robotics, "B", "2464")) issues.push("hard_anchor_missing:ROBOTICS_AUTOMATION:B:2464");
  return { ok: issues.length === 0, issues };
}

module.exports = {
  CONTRACT,
  MAPPING_REVIEWED_AT,
  MAPPING_EVIDENCE_AUTHORITIES,
  SOURCE,
  FORBIDDEN_OVERSEAS_LEADERS,
  OPENING_REPORT_0830_INDUSTRY_MAP,
  EXPECTED_INDUSTRIES,
  pairs,
  leaderPairs,
  validateIndustryMapContract,
};






