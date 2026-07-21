import { useState } from "react";
import { api, ApiError } from "../api";
import type { TradeItem } from "../types";
import { BarList, Delta, LineChart } from "../lib/charts";
import { fmt$k } from "../lib/format";
import { useApi } from "../hooks/useApi";
import { useTranslation } from "../i18n/useTranslation";
import { markTradesSeen } from "../components/TradeNotifier";

const RANGES = [7, 30, 90];
const PAGE = 50;

function fmtNum(n: number): string {
  if (n === 0) return "0";
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (Math.abs(n) >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function fmtPnl(v: number): string {
  if (v === 0) return "—";
  return (v > 0 ? "+" : "") + v.toFixed(2);
}

export function Trades() {
  const t = useTranslation();
  const [days, setDays] = useState(30);
  const [limit, setLimit] = useState(PAGE);
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState<string | null>(null);

  const stats = useApi(() => api.tradeStats(days), [days], `trades:stats:${days}`);
  const list = useApi(
    () =>
      api.listTrades({ limit, days }).then((d) => {
        if (d.items.length > 0) markTradesSeen(d.items[0].id);
        return d;
      }),
    [limit, days],
    `trades:list:${days}:${limit}`,
  );

  const pull = async () => {
    if (pulling) return;
    setPulling(true);
    setPullMsg(null);
    try {
      const res = await api.syncTrades();
      setPullMsg(
        res.accounts.length === 0
          ? t.trades.pullNoAccounts
          : t.trades.pullResult(res.new_trades),
      );
      stats.refetch();
      list.refetch();
    } catch (e) {
      setPullMsg(e instanceof ApiError ? e.message : t.common.failed);
    } finally {
      setPulling(false);
    }
  };

  const s = stats.data;
  const feeLine =
    s && s.fees.length > 0
      ? s.fees
          .slice(0, 3)
          .map((f) => `${fmtNum(f.amount)} ${f.asset}`)
          .join(" · ")
      : "—";

  return (
    <div className="sheet">
      <div className="sheet-head">
        <div>
          <h2>{t.trades.title}</h2>
          <div className="tiny mt-8">{t.trades.subtitle}</div>
        </div>
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          {pullMsg && <span className="tiny muted">{pullMsg}</span>}
          <button className="btn" onClick={pull} disabled={pulling}>
            {pulling ? t.trades.pulling : t.trades.pull}
          </button>
        </div>
      </div>

      <div className="col" style={{ gap: 12 }}>
        <div className="row between">
          <div className="row" style={{ gap: 6 }}>
            {RANGES.map((r) => (
              <span
                key={r}
                className={"pill" + (days === r ? " active" : "")}
                onClick={() => {
                  setDays(r);
                  setLimit(PAGE);
                }}
              >
                {r}D
              </span>
            ))}
          </div>
        </div>

        <div className="grid g-3" style={{ gap: 10 }}>
          <div className="sketch-box p-12">
            <div className="mono-xs mb-8">{t.trades.statVolume}</div>
            <div style={{ fontFamily: "var(--head)", fontSize: 24 }}>
              {fmt$k(s?.volume_usd ?? 0)}
            </div>
            <div className="tiny muted">
              {t.trades.statBuySell(s?.buy_count ?? 0, s?.sell_count ?? 0)} ·{" "}
              {s?.total_trades ?? 0} {t.trades.statTrades.toLowerCase()}
            </div>
          </div>
          <div className="sketch-box p-12">
            <div className="mono-xs mb-8">{t.trades.statPnl}</div>
            <div style={{ fontFamily: "var(--head)", fontSize: 24 }}>
              <Delta v={s?.realized_pnl ?? 0} suffix="" />
            </div>
            <div className="tiny muted">
              {t.trades.statWinRate}:{" "}
              {s?.win_rate != null ? `${s.win_rate.toFixed(1)}%` : t.trades.noWinRate}{" "}
              ({t.trades.statWinLoss(s?.win_count ?? 0, s?.loss_count ?? 0)})
            </div>
          </div>
          <div className="sketch-box p-12">
            <div className="mono-xs mb-8">{t.trades.statFees}</div>
            <div style={{ fontFamily: "var(--head)", fontSize: 24 }}>{feeLine}</div>
            <div className="tiny muted">{t.trades.daysWithFills(s?.by_day.length ?? 0)}</div>
          </div>
        </div>

        <div className="grid g-2" style={{ gap: 12 }}>
          <div className="sketch-box p-16">
            <div className="mono-xs mb-8">{t.trades.dailyVolume}</div>
            <div style={{ height: 160 }}>
              <LineChart
                fill="#2e8b6b"
                series={(s?.by_day ?? []).map((d) => ({ t: d.t, v: d.volume }))}
              />
            </div>
          </div>
          <div className="sketch-box p-16">
            <div className="mono-xs mb-8">{t.trades.bySymbol}</div>
            <BarList
              items={(s?.by_symbol ?? [])
                .slice(0, 8)
                .map((x) => ({ k: x.symbol, v: x.volume }))}
            />
          </div>
        </div>

        <div className="sketch-box p-16">
          <div className="row between mb-8">
            <span className="mono-xs">{t.trades.recentTitle}</span>
            <span className="tiny">{list.data?.total ?? 0}</span>
          </div>
          {(list.data?.items.length ?? 0) > 0 ? (
            <>
              <table className="sk" style={{ fontSize: 11 }}>
                <thead>
                  <tr>
                    <th>{t.trades.colTime}</th>
                    <th>{t.trades.colMarket}</th>
                    <th>{t.trades.colSymbol}</th>
                    <th>{t.trades.colSide}</th>
                    <th className="num">{t.trades.colPrice}</th>
                    <th className="num">{t.trades.colQty}</th>
                    <th className="num">{t.trades.colValue}</th>
                    <th className="num">{t.trades.colFee}</th>
                    <th className="num">{t.trades.colPnl}</th>
                    <th>{t.trades.colAccount}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data!.items.map((tr: TradeItem) => (
                    <tr key={tr.id}>
                      <td className="tiny">{new Date(tr.ts).toLocaleString()}</td>
                      <td>
                        <span className="chip">{tr.market}</span>
                      </td>
                      <td>
                        <b>{tr.symbol}</b>
                      </td>
                      <td
                        style={{
                          color: tr.side === "buy" ? "#2e8b6b" : "#d64933",
                          fontWeight: 600,
                        }}
                      >
                        {tr.side.toUpperCase()}
                      </td>
                      <td className="num">{fmtNum(tr.price)}</td>
                      <td className="num">{fmtNum(tr.qty)}</td>
                      <td className="num">{fmt$k(tr.quote_qty)}</td>
                      <td className="num tiny">
                        {tr.fee > 0 ? `${fmtNum(tr.fee)} ${tr.fee_asset}` : "—"}
                      </td>
                      <td
                        className="num"
                        style={{
                          color:
                            tr.realized_pnl > 0
                              ? "#2e8b6b"
                              : tr.realized_pnl < 0
                                ? "#d64933"
                                : undefined,
                        }}
                      >
                        {fmtPnl(tr.realized_pnl)}
                      </td>
                      <td className="tiny">{tr.account_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(list.data?.total ?? 0) > limit && (
                <div className="row" style={{ justifyContent: "center", marginTop: 10 }}>
                  <button className="btn" onClick={() => setLimit((l) => Math.min(l + PAGE, 200))}>
                    {t.trades.loadMore}
                  </button>
                </div>
              )}
            </>
          ) : (
            !list.loading && <div className="tiny muted">{t.trades.noTrades}</div>
          )}
        </div>
      </div>
    </div>
  );
}
