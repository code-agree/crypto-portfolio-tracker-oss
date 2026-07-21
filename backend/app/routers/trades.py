"""Trade endpoints — pull fills from the exchange, list them, aggregate stats.

``quote_qty`` is treated as USD in the aggregates. That's accurate for
every pair we ingest today: the spot poller only asks for USDT/USDC-quoted
symbols and USDⓈ-M futures are stable-margined by construction.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc
from sqlalchemy.orm import Session

from .. import db_models as m
from .. import ratelimit
from ..auth import current_user
from ..db import get_db
from ..models import (
    TradeDayPoint,
    TradeFee,
    TradeList,
    TradeOut,
    TradeStats,
    TradeSymbolStat,
    TradeSyncSummary,
)
from ..services import trades as trades_service

router = APIRouter(prefix="/api/trades", tags=["trades"])


def _as_utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


@router.post("/sync", response_model=TradeSyncSummary)
def sync_trades(
    user: m.UserRow = Depends(current_user),
    db: Session = Depends(get_db),
) -> TradeSyncSummary:
    try:
        ratelimit.check_trades_allowed(user.id)
    except ratelimit.RateLimited as rl:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Trade sync throttled. Try again in {rl.retry_after_seconds} seconds.",
            headers={"Retry-After": str(rl.retry_after_seconds)},
        )
    return trades_service.sync_user_trades(db, user.id)


@router.get("", response_model=TradeList)
def list_trades(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    market: str | None = Query(default=None, pattern="^(spot|futures)$"),
    symbol: str | None = Query(default=None, max_length=32),
    days: int = Query(default=0, ge=0, le=365, description="0 = no time filter"),
    user: m.UserRow = Depends(current_user),
    db: Session = Depends(get_db),
) -> TradeList:
    q = db.query(m.TradeRow).filter(m.TradeRow.user_id == user.id)
    if market:
        q = q.filter(m.TradeRow.market == market)
    if symbol:
        q = q.filter(m.TradeRow.symbol == symbol.strip().upper())
    if days > 0:
        q = q.filter(
            m.TradeRow.ts >= datetime.now(timezone.utc) - timedelta(days=days)
        )
    total = q.count()
    rows = (
        q.order_by(desc(m.TradeRow.ts), desc(m.TradeRow.id))
        .offset(offset)
        .limit(limit)
        .all()
    )
    names = {
        a.id: a.name
        for a in db.query(m.AccountRow).filter(m.AccountRow.user_id == user.id).all()
    }
    items = [
        TradeOut(
            id=r.id,
            account_id=r.account_id,
            account_name=names.get(r.account_id, "?"),
            exchange=r.exchange,
            market=r.market,
            symbol=r.symbol,
            side=r.side,
            price=r.price,
            qty=r.qty,
            quote_qty=r.quote_qty,
            fee=r.fee,
            fee_asset=r.fee_asset,
            realized_pnl=r.realized_pnl,
            is_maker=r.is_maker,
            ts=_as_utc(r.ts),
        )
        for r in rows
    ]
    return TradeList(items=items, total=total)


@router.get("/stats", response_model=TradeStats)
def trade_stats(
    days: int = Query(default=30, ge=1, le=365),
    user: m.UserRow = Depends(current_user),
    db: Session = Depends(get_db),
) -> TradeStats:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (
        db.query(m.TradeRow)
        .filter(m.TradeRow.user_id == user.id, m.TradeRow.ts >= since)
        .order_by(m.TradeRow.ts.asc())
        .all()
    )
    buy = sell = win = loss = 0
    volume = pnl_total = 0.0
    fees: dict[str, float] = {}
    by_day: dict[str, dict[str, float]] = {}
    by_symbol: dict[tuple[str, str], dict[str, float]] = {}
    for r in rows:
        if r.side == "buy":
            buy += 1
        else:
            sell += 1
        volume += r.quote_qty
        pnl_total += r.realized_pnl
        if r.realized_pnl > 0:
            win += 1
        elif r.realized_pnl < 0:
            loss += 1
        if r.fee:
            fees[r.fee_asset or "?"] = fees.get(r.fee_asset or "?", 0.0) + r.fee
        day = _as_utc(r.ts).strftime("%Y-%m-%d")
        d = by_day.setdefault(day, {"volume": 0.0, "pnl": 0.0, "count": 0})
        d["volume"] += r.quote_qty
        d["pnl"] += r.realized_pnl
        d["count"] += 1
        s = by_symbol.setdefault(
            (r.symbol, r.market), {"trades": 0, "volume": 0.0, "pnl": 0.0}
        )
        s["trades"] += 1
        s["volume"] += r.quote_qty
        s["pnl"] += r.realized_pnl

    closed = win + loss
    return TradeStats(
        days=days,
        total_trades=len(rows),
        buy_count=buy,
        sell_count=sell,
        volume_usd=round(volume, 2),
        realized_pnl=round(pnl_total, 2),
        win_count=win,
        loss_count=loss,
        win_rate=round(win / closed * 100, 1) if closed > 0 else None,
        fees=[
            TradeFee(asset=a, amount=round(v, 8))
            for a, v in sorted(fees.items(), key=lambda kv: -kv[1])
        ],
        by_day=[
            TradeDayPoint(
                t=day,
                volume=round(v["volume"], 2),
                pnl=round(v["pnl"], 2),
                count=int(v["count"]),
            )
            for day, v in sorted(by_day.items())
        ],
        by_symbol=sorted(
            (
                TradeSymbolStat(
                    symbol=sym,
                    market=market,
                    trades=int(v["trades"]),
                    volume=round(v["volume"], 2),
                    pnl=round(v["pnl"], 2),
                )
                for (sym, market), v in by_symbol.items()
            ),
            key=lambda s: -s.volume,
        )[:12],
    )
