# Strategy5 Closed Loop Handoff - 2026-07-11

## Summary

Strategy5 is a night complete-scan strategy. Each Strategy5 sub-strategy scans independently. Cross-strategy confluence is a terminal ranking/view layer only and must not become a hard condition for any single sub-strategy.

Current production baseline:

- latest Strategy5 runId: `strategy5-20260709-20260709102357`
- runDate: `20260709`
- resultCount: `40`
- scorecard snapshot tradeDate: `20260709`
- scorecard snapshot rows: `6696`
- Strategy5 sourceReport: `count=40`, `emittedRows=40`
- last runtime deploy that changed Strategy5 scanner: `dpl_3dZxSChGgds8UzRainkfVsz1vE3i`
- latest verifier commit: `cbe02954 Add strategy5 independence verifier`

## Strategy Independence Contract

Rules:

- Strategy1 to Strategy7 each generate their own results independently.
- Strategy5 sub-strategies each scan the full Strategy5 universe with their own conditions.
- `multi_strategy_confluence` is computed from terminal occurrence count.
- `strategy4Matched` is annotation only.
- Fire marker means display overlap with Strategy4, not Strategy5 filtering.
- A stock may appear in Strategy5 even if it does not match Strategy4.
- A stock may receive display fire if it also appears in Strategy4.

Verified by:

```bash
npm run verify:strategy5-independence
```

Latest verifier result:

- `ok=true`
- `strategy5_has_independent_base_strategy_rows=true`
- `scanner_does_not_publish_confluence_as_base_result=true`
- `volume_turnover_does_not_depend_on_strategy4_or_confluence=true`
- `strategy4_flame_is_display_only_on_terminal_and_mobile=true`
- `multi_strategy_confluence_uses_terminal_occurrence_count=true`

Observation for `20260709`:

- all 6 volume-turnover hits also matched Strategy4.
- this is overlap only; static scanner checks confirm Strategy4 is not a hard gate.

## Volume Turnover Breakout

Sub-strategy id:

```text
volume_turnover_breakout
```

Formal conditions:

```text
pct >= 3
turnoverRate > 5
volumeRatio >= 1
marginShortSameIncrease = true
previousVolumeExpansionRatio >= 1
marginShortSourceDate == runDate
```

No upper bound on pct.

Volume increase top 100:

```text
volumeIncreaseOrdinalRank <= 100
```

This is a score bonus only, not a hard filter.

Latest 20260709 readback:

```text
8039 台虹
8150 南茂
6202 盛群
2486 一詮
3149 正達
6285 啟碁
```

## Turnover Rate Formula

The current Strategy5 turnover formula follows the WantGoo-style interpretation:

```text
turnoverRate = today's traded shares / issued shares * 100
```

Implementation notes:

- use normalized traded shares, not lots.
- issued shares must be available for every formal calculation.
- if issued shares are missing, turnoverRate must not pass formal Strategy5 conditions.

## Volume Ratio Formula

```text
volumeRatio = today's traded shares / recent 5-day average traded shares
```

Current Strategy5 logic uses historical volume average map from the last trading date context. Weekend or holiday runs should resolve to the last valid trading day, not the calendar day.

## Margin and Short Same Increase

Formal definition:

```text
marginNetIncrease = marginBuy - marginSell - marginCashRepayment
shortNetIncrease = shortSell - shortBuy - shortCashRepayment
marginShortSameIncrease = marginNetIncrease > 0 && shortNetIncrease > 0
```

Date rule:

```text
marginShortSourceDate == lastTradingDay/runDate
```

Current source:

```text
finmind:institution+margin
```

FinMind is acceptable for Strategy5 night scan because Strategy5 is not an intraday low-latency scanner.

## Branch Flow / Main Force

Source:

```text
FinMind TaiwanStockTradingDailyReport
table fallback: finmind_chip_raw
preferred view: v_finmind_branch_flows_latest
```

Important rule:

Do not use all-branch net buy as main-force net buy, because total market branch buy and sell balances can net to zero.

Formal branch-flow calculation:

```text
topBranchNetBuy = sum(net > 0 for top 15 buyer branches)
topBranchNetSell = abs(sum(net < 0 for top 15 seller branches))
mainForceBranchNetBuy = topBranchNetBuy - topBranchNetSell
branchConcentrationRatio = topBranchNetBuy / totalBuy
branchPowerScore = clamp(round(branchConcentrationRatio * 70 + min(topBranchCount, 15) * 2), 0, 100)
```

Status:

```text
mainForceBranchNetBuy > 0 => branch_net_buy
mainForceBranchNetBuy < 0 => branch_net_sell
else branch_neutral
```

Known readback sample:

`6202` on `2026-07-09` had raw branch rows available from FinMind. Top buyer branches included Goldman Sachs, JP Morgan Taiwan, Nomura HK, Taishin, and JPMorgan.

## Bollinger Bandwidth

Formula:

```text
bollingerBandwidthRatio = (upperBand / lowerBand) - 1
bollingerBandwidthPct = bollingerBandwidthRatio * 100
```

Classification:

```text
<= 5%  => narrow
>= 20% => wide
else   => normal
```

Display labels:

```text
narrow => 窄
normal => 正常
wide   => 寬
```

The Bollinger KDJ sub-strategy payload includes:

```text
bollingerBandwidthFormula
bollingerBandwidthRatio
bollingerBandwidthPct
bollingerBandwidthState
bollingerBandwidthLabel
```

## Confluence and Fire Display

Multi-strategy confluence:

```text
terminal occurrence count across strategy surfaces
```

It affects:

- Strategy5 multi-strategy confluence tab.
- ranking inside the confluence view.
- visual emphasis.

It must not affect:

- `volume_turnover_breakout` filtering.
- any Strategy5 base sub-strategy pass/fail.
- Strategy5 scanner publish eligibility.

Fire marker:

```text
Strategy5 row + strategy4Matched => display fire
```

Fire appears in:

- desktop fast shell.
- mobile fragment.

Fire must remain display-only.

## Closed Loop Verification

Run these commands:

```bash
npm run verify:strategy5-volume-turnover
npm run verify:strategy5-independence
npm run verify:strategy5-protected-e2e-closure
```

Latest known results:

```text
verify:strategy5-volume-turnover => ok=true
verify:strategy5-independence => ok=true
verify:strategy5-protected-e2e-closure => ok=true
```

Production closed loop evidence:

```text
source writer/scanner: strategy5-20260709-20260709102357
scanner resultCount: 40
snapshot scorecard_latest tradeDate: 20260709
sourceReports strategy5 count: 40
sourceReports strategy5 emittedRows: 40
production /api/scorecard-health: status=200 ok=true
terminal-fast-bundle: status=200 membership protected partial shell ok
/88.html: status=200
mobile shell: status=200
desktop shell: status=200
```

Membership protection note:

`/api/scorecard`, `/api/source-reports`, and mobile fragment can return `401 membership_required` without breaking the computation closed loop. The verifier treats this as expected when membership protection is active.

## Files

Key implementation files:

```text
scripts/scan-strategy5-cache.js
scripts/sync-finmind-chip-data.js
scripts/verify-strategy5-volume-turnover.js
scripts/verify-strategy5-independence.js
scripts/verify-strategy5-protected-e2e-closure.js
api/strategy5-latest.js
api/mobile-fragment.js
terminal-desktop-fast-shell.js
ops/public-slot/FinMindChipAndIntradayFallback.sql
```

## Handoff Checklist

Before declaring Strategy5 healthy:

```text
1. run npm run verify:strategy5-volume-turnover
2. run npm run verify:strategy5-independence
3. run npm run verify:strategy5-protected-e2e-closure
4. confirm latest runId is the expected last trading day
5. confirm Strategy5 sourceReport count equals scanner resultCount
6. confirm scorecard snapshot tradeDate equals last trading day
7. confirm production scorecard-health is ok
8. confirm /88, mobile, and desktop shells load
```

Do not declare production changed unless runtime files were committed to main and deployed.
