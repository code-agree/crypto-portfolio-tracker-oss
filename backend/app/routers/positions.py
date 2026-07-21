"""Positions endpoint — cross-account view built from the latest snapshots.

No external API calls: this only reads what the last sync persisted. The
primary payload is the list of derivative/DeFi positions (`kind=pos`
holdings); spot exposure aggregated by symbol rides along as the secondary
block.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import db_models as m
from ..auth import current_user
from ..db import get_db
from ..models import PositionAssetRow, PositionRow, PositionsSummary
from ..services.sync import holding_key

router = APIRouter(prefix="/api/positions", tags=["positions"])


def _venue(account: m.AccountRow) -> str:
    if account.source == "exchange":
        return (account.addr or "").strip() or "exchange"
    if account.source == "onchain":
        return (account.chain or "EVM").strip() or "EVM"
    return "custom"


@router.get("", response_model=PositionsSummary)
def positions(
    user: m.UserRow = Depends(current_user),
    db: Session = Depends(get_db),
) -> PositionsSummary:
    accounts = db.query(m.AccountRow).filter(m.AccountRow.user_id == user.id).all()
    by_id = {a.id: a for a in accounts}
    snaps = (
        db.query(m.AccountSnapshotRow)
        .filter(m.AccountSnapshotRow.account_id.in_(list(by_id)))
        .all()
        if by_id
        else []
    )

    pos_rows: list[PositionRow] = []
    agg: dict[str, dict] = {}
    last_sync: datetime | None = None
    for snap in snaps:
        account = by_id[snap.account_id]
        excluded_keys = set(account.excluded_keys or [])
        synced = snap.synced_at
        if synced is not None:
            if synced.tzinfo is None:
                synced = synced.replace(tzinfo=timezone.utc)
            if last_sync is None or synced > last_sync:
                last_sync = synced
        for h in snap.holdings or []:
            if not isinstance(h, dict):
                continue
            usd = float(h.get("usd", 0.0) or 0.0)
            excluded = holding_key(h) in excluded_keys
            if h.get("kind") == "pos":
                pos_rows.append(
                    PositionRow(
                        account_id=account.id,
                        account_name=account.name,
                        venue=_venue(account),
                        sym=str(h.get("sym") or "?"),
                        name=str(h.get("name") or ""),
                        proto=str(h.get("proto") or "—"),
                        chain=str(h.get("chain") or ""),
                        amt=str(h.get("amt") or "—"),
                        price=str(h.get("price") or "—"),
                        usd=round(usd, 2),
                        apr=h.get("apr"),
                        excluded=excluded,
                    )
                )
            else:
                if excluded or usd <= 0:
                    continue
                sym = str(h.get("sym") or "").upper()
                if not sym:
                    continue
                cur = agg.setdefault(
                    sym,
                    {
                        "name": str(h.get("name") or sym),
                        "usd": 0.0,
                        "accounts": set(),
                        "chains": set(),
                    },
                )
                cur["usd"] += usd
                cur["accounts"].add(account.id)
                cur["chains"].add(str(h.get("chain") or ""))

    pos_rows.sort(key=lambda p: p.usd, reverse=True)
    positions_total = sum(p.usd for p in pos_rows if not p.excluded)

    assets_total = sum(v["usd"] for v in agg.values())
    asset_rows = [
        PositionAssetRow(
            sym=sym,
            name=info["name"],
            usd=round(info["usd"], 2),
            pct=round(info["usd"] / assets_total * 100, 1) if assets_total > 0 else 0.0,
            accounts=len(info["accounts"]),
            chains=len(info["chains"]),
        )
        for sym, info in agg.items()
    ]
    asset_rows.sort(key=lambda a: a.usd, reverse=True)

    return PositionsSummary(
        positions=pos_rows,
        positions_total_usd=round(positions_total, 2),
        assets=asset_rows,
        assets_total_usd=round(assets_total, 2),
        last_sync_at=last_sync,
    )
