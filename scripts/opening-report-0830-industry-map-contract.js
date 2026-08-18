"use strict";

const SOURCE = "opening_report_0830_industry_map_contract";
const CONTRACT = "opening-report-0830-industry-map-v1";

const FORBIDDEN_OVERSEAS_LEADERS = ["新光電工", "WCI", "SCFI", "BDI"];

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
    evidence_summary: "TSM、ASML、AMAT、LRCX、KLAC、東京威力作為先進製程 proxy。",
    overseas_leaders: [["TSM", "TSM"], ["ASML", "ASML"], ["AMAT", "AMAT"], ["LRCX", "LRCX"], ["KLAC", "KLAC"], ["東京威力", "8035.T"]],
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
    overseas_leaders: [["MEIKO", "6787.T"], ["CMK", "6958.T"], ["Daeduck", "353200.KS"], ["Simmtech", "222800.KQ"], ["藤倉", "5803.T"]],
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
    b: [["4991", "環宇-KY"], ["2455", "全新"], ["3234", "光環"], ["6451", "訊芯-KY"], ["3711", "日月光投控"], ["6223", "旺矽"], ["6515", "穎崴"], ["2345", "智邦"]],
  },
  {
    industry: "III_V_OPTICAL",
    display_name: "III-V 材料／光通訊",
    default_bias: "neutral_mixed",
    default_confidence: 0.54,
    evidence_summary: "AXTI、IQE、Coherent 作為 III-V proxy；3105 穩懋固定列入 A。",
    overseas_leaders: [["AXTI", "AXTI"], ["IQE", "IQEPF"], ["Coherent", "COHR"]],
    a: [["3105", "穩懋"], ["3081", "聯亞"], ["2455", "全新"], ["8086", "宏捷科"]],
    b: [["4991", "環宇-KY"], ["6426", "統新"], ["4971", "IET-KY"]],
  },
  {
    industry: "EV_AUTOMOTIVE",
    display_name: "車用／電動車",
    default_bias: "neutral_mixed",
    default_confidence: 0.51,
    evidence_summary: "TSLA、BYD、Denso、Aptiv、Nidec 作為車用/電動車 proxy。",
    overseas_leaders: [["TSLA", "TSLA"], ["BYD", "1211.HK"], ["Denso", "6902.T"], ["Aptiv", "APTV"], ["Nidec", "6594.T"]],
    a: [["2317", "鴻海"], ["3665", "貿聯-KY"], ["1536", "和大"], ["1319", "東陽"], ["2360", "致茂"]],
    b: [["2308", "台達電"], ["2301", "光寶科"], ["1524", "耿鼎"], ["6279", "胡連"]],
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
    evidence_summary: "LG Display、BOE、Samsung Display proxy 作為面板 proxy；等台股量價。",
    overseas_leaders: [["LG Display", "034220.KS"], ["BOE", "000725.SZ"], ["Samsung Display proxy", "005930.KS"]],
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
  {
    industry: "SHIPPING",
    display_name: "航運",
    default_bias: "neutral_mixed",
    default_confidence: 0.47,
    evidence_summary: "Maersk、Hapag-Lloyd、ZIM、Matson、BDRY ETF proxy 作為航運 proxy；WCI/SCFI/BDI 不列入 08:30 即時偵測。",
    overseas_leaders: [["Maersk", "MAERSK-B.CO"], ["Hapag-Lloyd", "HLAG.DE"], ["ZIM", "ZIM"], ["Matson", "MATX"], ["BDRY ETF proxy", "BDRY"]],
    a: [["2603", "長榮"], ["2609", "陽明"], ["2615", "萬海"]],
    b: [["2618", "長榮航"], ["2610", "華航"], ["2637", "慧洋-KY"]],
  },
  {
    industry: "MATERIALS",
    display_name: "原物料",
    default_bias: "neutral_mixed",
    default_confidence: 0.48,
    evidence_summary: "Brent、WTI、Copper、Steel、FCX、BHP、RIO 作為原物料背景。",
    overseas_leaders: [["Brent", "BZ=F"], ["WTI", "CL=F"], ["Copper", "HG=F"], ["Steel", "SLX"], ["FCX", "FCX"], ["BHP", "BHP"], ["RIO", "RIO"]],
    a: [["2002", "中鋼"], ["2009", "第一銅"], ["1605", "華新"]],
    b: [["1301", "台塑"], ["1303", "南亞"], ["1326", "台化"], ["6505", "台塑化"]],
  },
  {
    industry: "BIOTECH",
    display_name: "生技",
    default_bias: "neutral_mixed",
    default_confidence: 0.46,
    evidence_summary: "LLY、NVO、MRNA、XBI、IBB 作為生技 proxy；以事件股觀察。",
    overseas_leaders: [["LLY", "LLY"], ["NVO", "NVO"], ["MRNA", "MRNA"], ["XBI", "XBI"], ["IBB", "IBB"]],
    a: [["6446", "藥華藥"], ["6472", "保瑞"], ["6919", "康霈*"], ["6589", "台康生技"]],
    b: [["1795", "美時"], ["4105", "東洋"], ["4743", "合一"], ["4147", "中裕"]],
  },
].map((row, index) => ({
  ...row,
  priority_rank: index + 1,
  overseas_leaders: row.overseas_leaders.map(([name, yahoo_symbol]) => ({ name, yahoo_symbol })),
  a: row.a.map(([symbol, name]) => ({ symbol, name, tier: "A" })),
  b: row.b.map(([symbol, name]) => ({ symbol, name, tier: "B" })),
}));

const EXPECTED_INDUSTRIES = OPENING_REPORT_0830_INDUSTRY_MAP.map((row) => ({
  industry: row.industry,
  display_name: row.display_name,
  overseas: row.overseas_leaders.map((leader) => leader.name),
  a: row.a.map((stock) => stock.symbol),
  b: row.b.map((stock) => stock.symbol),
}));

function pairs(rows) {
  return rows.map((row) => [row.symbol, row.name]);
}

function leaderPairs(row) {
  return row.overseas_leaders.map((leader) => [leader.name, leader.yahoo_symbol]);
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
  if (!Array.isArray(rows) || rows.length !== 19) issues.push(`industry_map_count_mismatch:${Array.isArray(rows) ? rows.length : "not_array"}:expected_19`);
  const seen = new Set();
  rows.forEach((row, index) => {
    if (!row.industry) issues.push(`industry_missing_at_index:${index}`);
    if (seen.has(row.industry)) issues.push(`industry_duplicate:${row.industry}`);
    seen.add(row.industry);
    if (row.priority_rank !== index + 1) issues.push(`priority_rank_mismatch:${row.industry}:${row.priority_rank}:expected_${index + 1}`);
    if (!row.display_name) issues.push(`display_name_missing:${row.industry}`);
    if (!Array.isArray(row.overseas_leaders) || row.overseas_leaders.length === 0) issues.push(`overseas_leaders_missing:${row.industry}`);
    if (!Array.isArray(row.a) || row.a.length === 0) issues.push(`tier_a_missing:${row.industry}`);
    for (const leader of row.overseas_leaders || []) {
      if (!leader.name || !leader.yahoo_symbol) issues.push(`overseas_leader_identity_missing:${row.industry}:${leader.name || "unknown"}`);
      if (FORBIDDEN_OVERSEAS_LEADERS.includes(String(leader.name))) issues.push(`forbidden_overseas_leader:${row.industry}:${leader.name}`);
    }
    for (const stockRow of [...(row.a || []), ...(row.b || [])]) {
      if (!/^\d{4}$/.test(String(stockRow.symbol || ""))) issues.push(`taiwan_symbol_invalid:${row.industry}:${stockRow.symbol || "unknown"}`);
      if (!stockRow.name) issues.push(`taiwan_symbol_name_missing:${row.industry}:${stockRow.symbol || "unknown"}`);
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
  const robotics = byIndustry.get("ROBOTICS_AUTOMATION");
  if (!robotics || !hasSymbol(robotics, "B", "2464")) issues.push("hard_anchor_missing:ROBOTICS_AUTOMATION:B:2464");
  return { ok: issues.length === 0, issues };
}

module.exports = {
  CONTRACT,
  SOURCE,
  FORBIDDEN_OVERSEAS_LEADERS,
  OPENING_REPORT_0830_INDUSTRY_MAP,
  EXPECTED_INDUSTRIES,
  pairs,
  leaderPairs,
  validateIndustryMapContract,
};






