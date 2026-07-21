"""Trade-history sync — pulls fills from Binance into the ``trades`` table.

Only Binance is wired up for now. Spot has no "all my trades" endpoint, so
we derive candidate symbols from the account's last synced holdings; futures
symbols are discovered from the income stream (which doesn't need a symbol).
Everything is incremental: each (account, market) keeps its cursor implicitly
as ``max(trades.ts)`` and we only ask Binance for fills after it.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import db_models as m
from ..models import TradeSyncAccountResult, TradeSyncSummary

# First-ever pull looks back this far; later pulls resume from the last
# stored fill. Binance caps startTime lookups anyway (spot myTrades serves
# at most 24h per windowed query beyond certain ranges; recent windows are
# what matter for live fill tracking).
_FIRST_LOOKBACK_DAYS = 7
# Cap the number of spot symbols polled per sync so one account with a long
# tail of dust holdings can't fan out into dozens of signed requests.
_MAX_SPOT_SYMBOLS = 12

_STABLES = {"USD", "USD1", "USDT", "USDC", "FDUSD", "BUSD", "TUSD", "USDS", "DAI"}
_SPOT_QUOTES = ("USDT", "USDC")


def _spot_symbols(db: Session, account: m.AccountRow) -> list[str]:
    """Candidate spot symbols = non-stable assets from the account's last
    synced holdings (biggest first), paired against USDT and USDC."""
    snap = db.get(m.AccountSnapshotRow, account.id)
    if snap is None:
        return []
    ranked: list[tuple[float, str]] = []
    seen: set[str] = set()
    for h in snap.holdings or []:
        if not isinstance(h, dict) or h.get("kind") != "tok":
            continue
        sym = str(h.get("sym") or "").strip().upper()
        if not sym or not sym.isalnum() or sym in _STABLES or sym in seen:
            continue
        seen.add(sym)
        ranked.append((float(h.get("usd", 0.0) or 0.0), sym))
    ranked.sort(reverse=True)
    out: list[str] = []
    for _, sym in ranked[:_MAX_SPOT_SYMBOLS]:
        for quote in _SPOT_QUOTES:
            out.append(f"{sym}{quote}")
    return out


def _cursor_ms(db: Session, account_id: str, market: str) -> int:
    last: datetime | None = (
        db.query(func.max(m.TradeRow.ts))
        .filter(m.TradeRow.account_id == account_id, m.TradeRow.market == market)
        .scalar()
    )
    if last is None:
        start = datetime.now(timezone.utc) - timedelta(days=_FIRST_LOOKBACK_DAYS)
        return int(start.timestamp() * 1000)
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return int(last.timestamp() * 1000) + 1


def _normalize_spot(row: dict[str, Any]) -> dict[str, Any] | None:
    trade_id = str(row.get("id") or "")
    if not trade_id:
        return None
    return {
        "market": "spot",
        "symbol": str(row.get("symbol") or "").upper(),
        "trade_id": trade_id,
        "order_id": str(row.get("orderId") or ""),
        "side": "buy" if row.get("isBuyer") else "sell",
        "price": float(row.get("price", 0.0) or 0.0),
        "qty": float(row.get("qty", 0.0) or 0.0),
        "quote_qty": float(row.get("quoteQty", 0.0) or 0.0),
        "fee": float(row.get("commission", 0.0) or 0.0),
        "fee_asset": str(row.get("commissionAsset") or ""),
        "realized_pnl": 0.0,
        "is_maker": bool(row.get("isMaker")),
        "ts": datetime.fromtimestamp(int(row.get("time", 0) or 0) / 1000, tz=timezone.utc),
    }


def _normalize_futures(row: dict[str, Any]) -> dict[str, Any] | None:
    trade_id = str(row.get("id") or "")
    if not trade_id:
        return None
    return {
        "market": "futures",
        "symbol": str(row.get("symbol") or "").upper(),
        "trade_id": trade_id,
        "order_id": str(row.get("orderId") or ""),
        "side": str(row.get("side") or "").lower() or ("buy" if row.get("buyer") else "sell"),
        "price": float(row.get("price", 0.0) or 0.0),
        "qty": float(row.get("qty", 0.0) or 0.0),
        "quote_qty": float(row.get("quoteQty", 0.0) or 0.0),
        "fee": float(row.get("commission", 0.0) or 0.0),
        "fee_asset": str(row.get("commissionAsset") or ""),
        "realized_pnl": float(row.get("realizedPnl", 0.0) or 0.0),
        "is_maker": bool(row.get("maker")),
        "ts": datetime.fromtimestamp(int(row.get("time", 0) or 0) / 1000, tz=timezone.utc),
    }


def _insert_new(
    db: Session, account: m.AccountRow, rows: list[dict[str, Any]]
) -> int:
    """Insert fills that aren't stored yet. Dedup by (market, trade_id)
    within the account — cheap SELECT of just the candidate ids, so a
    re-poll of an overlapping window is a no-op."""
    if not rows:
        return 0
    by_market: dict[str, set[str]] = {}
    for r in rows:
        by_market.setdefault(r["market"], set()).add(r["trade_id"])
    existing: set[tuple[str, str]] = set()
    for market, ids in by_market.items():
        found = (
            db.query(m.TradeRow.trade_id)
            .filter(
                m.TradeRow.account_id == account.id,
                m.TradeRow.market == market,
                m.TradeRow.trade_id.in_(ids),
            )
            .all()
        )
        existing.update((market, tid) for (tid,) in found)
    inserted = 0
    for r in rows:
        if (r["market"], r["trade_id"]) in existing:
            continue
        db.add(
            m.TradeRow(
                user_id=account.user_id,
                account_id=account.id,
                exchange="binance",
                **r,
            )
        )
        inserted += 1
    return inserted


def sync_account_trades(db: Session, account: m.AccountRow) -> TradeSyncAccountResult:
    """Pull new Binance fills for one exchange account. Partial failures are
    tolerated per market/symbol; the result message says what happened."""
    from ..integrations.binance_trades import (
        discover_futures_symbols,
        fetch_futures_user_trades,
        fetch_spot_my_trades,
    )

    cred = db.get(m.CexCredentialRow, account.id)
    if cred is None or not cred.api_key or not cred.api_secret:
        return TradeSyncAccountResult(
            account_id=account.id, name=account.name, status="skipped",
            new_trades=0, message="binance credentials not set",
        )
    api_key, api_secret = cred.api_key, cred.api_secret
    new_rows: list[dict[str, Any]] = []
    errors: list[str] = []

    # Futures first — symbol discovery is a single request.
    fut_since = _cursor_ms(db, account.id, "futures")
    try:
        for symbol in sorted(discover_futures_symbols(api_key, api_secret, fut_since)):
            try:
                for raw in fetch_futures_user_trades(api_key, api_secret, symbol, fut_since):
                    norm = _normalize_futures(raw)
                    if norm is not None:
                        new_rows.append(norm)
            except Exception as exc:  # noqa: BLE001 — one bad symbol shouldn't kill the rest
                errors.append(f"futures {symbol}: {exc}")
    except Exception as exc:  # noqa: BLE001
        errors.append(f"futures: {exc}")

    spot_since = _cursor_ms(db, account.id, "spot")
    for symbol in _spot_symbols(db, account):
        try:
            for raw in fetch_spot_my_trades(api_key, api_secret, symbol, spot_since):
                norm = _normalize_spot(raw)
                if norm is not None:
                    new_rows.append(norm)
        except Exception:  # noqa: BLE001 — most failures here are just
            # "Invalid symbol" for a pair that doesn't trade on Binance.
            continue

    inserted = _insert_new(db, account, new_rows)
    if errors and inserted == 0 and not new_rows:
        return TradeSyncAccountResult(
            account_id=account.id, name=account.name, status="error",
            new_trades=0, message="; ".join(errors[:3]),
        )
    message = f"{inserted} new fills"
    if errors:
        message += f" ({len(errors)} lookups failed)"
    return TradeSyncAccountResult(
        account_id=account.id, name=account.name, status="ok",
        new_trades=inserted, message=message,
    )


def sync_user_trades(db: Session, user_id: str) -> TradeSyncSummary:
    """Pull fills for every Binance exchange account of ``user_id``."""
    accounts = (
        db.query(m.AccountRow)
        .filter(m.AccountRow.user_id == user_id, m.AccountRow.source == "exchange")
        .all()
    )
    results: list[TradeSyncAccountResult] = []
    for account in accounts:
        cred = db.get(m.CexCredentialRow, account.id)
        exchange = (cred.exchange if cred else "") or ""
        if exchange.strip().lower() != "binance":
            continue
        results.append(sync_account_trades(db, account))
    db.commit()
    return TradeSyncSummary(
        accounts=results,
        new_trades=sum(r.new_trades for r in results),
    )
