from __future__ import annotations

import argparse
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = Path(
    os.environ.get(
        "FUMAN_SCORECARD_DUCKDB",
        r"C:\Users\ginov\Documents\Codex\2026-06-22\new-chat-7\outputs\backtest-scorecard\scorecard.duckdb",
    )
)
DEFAULT_OUT = ROOT / "data" / "scorecard-latest.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export Fuman scorecard DuckDB rows to a public JSON snapshot.")
    parser.add_argument("--db", default=str(DEFAULT_DB), help="Path to scorecard.duckdb")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="Output JSON path")
    parser.add_argument("--days", type=int, default=int(os.environ.get("FUMAN_SCORECARD_DAYS", "30")))
    return parser.parse_args()


def import_duckdb():
    try:
        import duckdb  # type: ignore

        return duckdb
    except Exception as error:  # pragma: no cover - message matters for the operator
        raise SystemExit(f"duckdb module is required to export scorecard snapshot: {error}") from error


def clean_text(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def clean_number(value) -> float:
    if value is None:
        return 0.0
    try:
        number = float(value)
        return number if math.isfinite(number) else 0.0
    except Exception:
        return 0.0


def row_to_record(row: dict) -> dict:
    return {
        "record_date": clean_text(row.get("record_date")),
        "strategy": clean_text(row.get("strategy") or "未分類"),
        "ticker": clean_text(row.get("ticker")),
        "name": clean_text(row.get("name")),
        "entry_time": clean_text(row.get("entry_time")),
        "entry_price": clean_number(row.get("entry_price")),
        "high_price": clean_number(row.get("high_price")),
        "pnl": clean_number(row.get("pnl")),
        "source_sheet": clean_text(row.get("source_sheet")),
        "reason": clean_text(row.get("reason")),
    }


def summarize(records: list[dict], daily_rows: list[dict], latest_date: str) -> dict:
    wins = sum(1 for row in records if clean_number(row.get("pnl")) > 0)
    losses = sum(1 for row in records if clean_number(row.get("pnl")) < 0)
    flats = sum(1 for row in records if clean_number(row.get("pnl")) == 0)
    total_pnl = sum(clean_number(row.get("pnl")) for row in records)
    grouped: dict[str, list[dict]] = {}
    for row in records:
        grouped.setdefault(clean_text(row.get("strategy") or "未分類"), []).append(row)
    by_strategy = []
    for strategy, rows in grouped.items():
        strategy_wins = sum(1 for row in rows if clean_number(row.get("pnl")) > 0)
        strategy_losses = sum(1 for row in rows if clean_number(row.get("pnl")) < 0)
        strategy_pnl = sum(clean_number(row.get("pnl")) for row in rows)
        by_strategy.append(
            {
                "strategy": strategy,
                "rows": len(rows),
                "wins": strategy_wins,
                "losses": strategy_losses,
                "flats": sum(1 for row in rows if clean_number(row.get("pnl")) == 0),
                "winRate": (strategy_wins / len(rows) * 100) if rows else 0,
                "pnl": strategy_pnl,
            }
        )
    by_strategy.sort(key=lambda item: (item["pnl"], item["rows"]), reverse=True)
    return {
        "latestDate": latest_date,
        "rows": len(records),
        "wins": wins,
        "losses": losses,
        "flats": flats,
        "winRate": (wins / len(records) * 100) if records else 0,
        "totalPnl": total_pnl,
        "byStrategy": by_strategy,
        "daily": daily_rows,
    }


def main() -> int:
    args = parse_args()
    db_path = Path(args.db)
    out_path = Path(args.out)
    if not db_path.exists():
        raise SystemExit(f"scorecard DuckDB not found: {db_path}")

    duckdb = import_duckdb()
    con = duckdb.connect(str(db_path), read_only=True)
    latest_date = con.execute("select max(record_date) from fuman_trade_records").fetchone()[0]
    if not latest_date:
        raise SystemExit("fuman_trade_records has no record_date")

    records = con.execute(
        """
        with source as (
          select
            record_date,
            strategy,
            ticker,
            name,
            entry_time,
            entry_price,
            high_price,
            pnl,
            source_sheet,
            reason,
            try_strptime(record_date, '%Y-%m-%d') as parsed_date
          from fuman_trade_records
        ),
        latest as (
          select max(parsed_date) as max_date from source
        )
        select
          record_date,
          strategy,
          ticker,
          name,
          entry_time,
          entry_price,
          high_price,
          pnl,
          source_sheet,
          reason
        from source, latest
        where parsed_date is null
           or parsed_date >= max_date - (?::int - 1) * interval '1 day'
        order by parsed_date desc nulls last, strategy, ticker
        """,
        [max(1, int(args.days))],
    ).fetchdf()
    records_list = [row_to_record(row) for row in records.to_dict(orient="records")]
    daily = con.execute("select * from fuman_scorecard_daily order by strategy").fetchdf()
    daily_rows = json.loads(daily.to_json(orient="records", force_ascii=False))

    payload = {
        "ok": True,
        "source": "duckdb-scorecard-export",
        "cacheSource": "json-snapshot",
        "exportSource": "local-duckdb-export",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "latestDate": clean_text(latest_date),
        "days": max(1, int(args.days)),
        "records": records_list,
        "summary": summarize(records_list, daily_rows, clean_text(latest_date)),
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "out": str(out_path),
        "latestDate": payload["latestDate"],
        "rows": len(records_list),
        "cacheSource": payload["cacheSource"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
