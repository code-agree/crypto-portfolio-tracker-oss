"""Binance trade-history (fills) fetchers.

Reuses the request/signing helpers from ``integrations.cex``. Two markets:

- **Spot** — ``GET /api/v3/myTrades`` requires a ``symbol``, so callers must
  supply the symbols to poll (we derive them from the account's synced
  holdings — see ``services.trades``).
- **USDⓈ-M futures** — ``GET /fapi/v1/userTrades`` also requires a symbol,
  but ``GET /fapi/v1/income`` does NOT, and every fill produces income
  records (REALIZED_PNL / COMMISSION) tagged with their symbol. We use
  income as the symbol-discovery pass, then pull per-symbol fills.

All fetchers return the raw Binance rows; normalisation into our ``trades``
table shape happens in ``services.trades``.
"""
from __future__ import annotations

from typing import Any

from .cex import _binance_headers, _binance_signed_params, _now_ms, _request_json

_SPOT_BASE = "https://api.binance.com"
_FUTURES_BASE = "https://fapi.binance.com"


def _signed_get(
    base: str, path: str, api_key: str, api_secret: str, params: dict[str, Any]
) -> Any:
    payload = {k: v for k, v in params.items() if v is not None}
    payload["timestamp"] = _now_ms()
    payload["recvWindow"] = 10_000
    return _request_json(
        f"{base}{path}",
        headers=_binance_headers(api_key),
        params=_binance_signed_params(api_secret, payload),
    )


def fetch_spot_my_trades(
    api_key: str, api_secret: str, symbol: str, start_ms: int, limit: int = 1000
) -> list[dict[str, Any]]:
    """Spot fills for one symbol since ``start_ms`` (inclusive), oldest first."""
    rows = _signed_get(
        _SPOT_BASE,
        "/api/v3/myTrades",
        api_key,
        api_secret,
        {"symbol": symbol, "startTime": start_ms, "limit": limit},
    )
    return rows if isinstance(rows, list) else []


def fetch_futures_income(
    api_key: str, api_secret: str, start_ms: int, limit: int = 1000
) -> list[dict[str, Any]]:
    """USDⓈ-M income records since ``start_ms`` — used only to discover which
    futures symbols had activity, so we don't have to guess symbols."""
    rows = _signed_get(
        _FUTURES_BASE,
        "/fapi/v1/income",
        api_key,
        api_secret,
        {"startTime": start_ms, "limit": limit},
    )
    return rows if isinstance(rows, list) else []


def fetch_futures_user_trades(
    api_key: str, api_secret: str, symbol: str, start_ms: int, limit: int = 1000
) -> list[dict[str, Any]]:
    """USDⓈ-M fills for one symbol since ``start_ms``, oldest first."""
    rows = _signed_get(
        _FUTURES_BASE,
        "/fapi/v1/userTrades",
        api_key,
        api_secret,
        {"symbol": symbol, "startTime": start_ms, "limit": limit},
    )
    return rows if isinstance(rows, list) else []


def discover_futures_symbols(
    api_key: str, api_secret: str, start_ms: int
) -> set[str]:
    symbols: set[str] = set()
    for row in fetch_futures_income(api_key, api_secret, start_ms):
        if not isinstance(row, dict):
            continue
        sym = str(row.get("symbol") or "").strip().upper()
        if sym:
            symbols.add(sym)
    return symbols
