import { api } from "../api";
import { BarList } from "../lib/charts";
import { fmt$, fmt$k } from "../lib/format";
import { useApi } from "../hooks/useApi";
import { SYNC_ALL_CONFIRM, SyncButton } from "../components/SyncButton";
import { useTranslation } from "../i18n/useTranslation";

export function Positions() {
  const t = useTranslation();
  const summary = useApi(() => api.positions(), [], "positions:summary");

  const data = summary.data;
  const lastSync = data?.last_sync_at
    ? t.positions.lastSync(new Date(data.last_sync_at).toLocaleString())
    : t.positions.notSynced;

  return (
    <div className="sheet">
      <div className="sheet-head">
        <div>
          <h2>{t.positions.title}</h2>
          <div className="tiny mt-8">
            {t.positions.subtitle} · {lastSync}
          </div>
        </div>
        <SyncButton
          sync={() => api.syncAll()}
          onDone={() => summary.refetch()}
          label={t.balance.syncAll}
          confirm={SYNC_ALL_CONFIRM}
        />
      </div>

      <div className="col" style={{ gap: 12 }}>
        <div className="sketch-box p-16">
          <div className="row between mb-8">
            <span className="mono-xs">{t.positions.derivTitle}</span>
            <span className="tiny">
              {t.positions.derivTotal(fmt$(data?.positions_total_usd ?? 0))}
            </span>
          </div>
          {(data?.positions.length ?? 0) > 0 ? (
            <table className="sk" style={{ fontSize: 11 }}>
              <thead>
                <tr>
                  <th>{t.positions.colAccount}</th>
                  <th>{t.positions.colVenue}</th>
                  <th>{t.positions.colPosition}</th>
                  <th>{t.positions.colProto}</th>
                  <th className="num">{t.positions.colAmt}</th>
                  <th className="num">{t.positions.colPrice}</th>
                  <th className="num">{t.positions.colValue}</th>
                  <th className="num">{t.positions.colApr}</th>
                </tr>
              </thead>
              <tbody>
                {data!.positions.map((p, i) => (
                  <tr key={i} style={p.excluded ? { opacity: 0.45 } : undefined}>
                    <td>{p.account_name}</td>
                    <td>
                      <span className="chip">{p.venue}</span>
                    </td>
                    <td>
                      {p.name}
                      {p.excluded && (
                        <span className="tiny muted"> · {t.positions.excludedTag}</span>
                      )}
                    </td>
                    <td>{p.proto}</td>
                    <td className="num">{p.amt}</td>
                    <td className="num">{p.price}</td>
                    <td className="num">{fmt$k(p.usd)}</td>
                    <td className="num">{p.apr ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            !summary.loading && (
              <div className="tiny muted">{t.positions.noPositions}</div>
            )
          )}
        </div>

        <div className="grid g-2" style={{ gap: 12 }}>
          <div className="sketch-box p-16">
            <div className="row between mb-8">
              <span className="mono-xs">{t.positions.spotTitle}</span>
              <span className="tiny">
                {t.positions.spotTotal(fmt$(data?.assets_total_usd ?? 0))}
              </span>
            </div>
            {(data?.assets.length ?? 0) > 0 ? (
              <table className="sk" style={{ fontSize: 11 }}>
                <thead>
                  <tr>
                    <th>{t.positions.colAsset}</th>
                    <th className="num">{t.positions.colValue}</th>
                    <th className="num">{t.positions.colPct}</th>
                    <th className="num">{t.positions.colAccounts}</th>
                    <th className="num">{t.positions.colChains}</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.assets.slice(0, 20).map((a) => (
                    <tr key={a.sym}>
                      <td>
                        <b>{a.sym}</b>{" "}
                        <span className="tiny muted">{a.name !== a.sym ? a.name : ""}</span>
                      </td>
                      <td className="num">{fmt$k(a.usd)}</td>
                      <td className="num">{a.pct.toFixed(1)}%</td>
                      <td className="num">{a.accounts}</td>
                      <td className="num">{a.chains}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              !summary.loading && (
                <div className="tiny muted">{t.positions.noAssets}</div>
              )
            )}
          </div>
          <div className="sketch-box p-16">
            <div className="mono-xs mb-8">{t.dashboard.assetBreakdown}</div>
            <BarList
              items={(data?.assets ?? [])
                .slice(0, 10)
                .map((a) => ({ k: a.sym, v: a.usd }))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
