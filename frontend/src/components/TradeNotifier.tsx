import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { useTranslation } from "../i18n/useTranslation";

// Poll cadence for new fills while the app is open. The backend throttles
// /api/trades/sync per user anyway (TRADES_MIN_INTERVAL_SECONDS), so an
// extra tab just gets cheap 429s.
const POLL_MS = 180_000;

// Last trade id the user has "seen", persisted so a page refresh doesn't
// re-announce old fills. Key is scoped per user id.
let activeUserId: string | null = null;

const seenKey = (userId: string) => `portfolio:trades:lastseen:${userId}`;

function readSeen(userId: string): number | null {
  try {
    const raw = localStorage.getItem(seenKey(userId));
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

/** Record the newest trade id as seen. Called by the Trades page whenever
 * it renders a fresh list, and by the toast's view/dismiss actions. */
export function markTradesSeen(newestId: number): void {
  if (activeUserId == null) return;
  try {
    const prev = readSeen(activeUserId);
    if (prev == null || newestId > prev) {
      localStorage.setItem(seenKey(activeUserId), String(newestId));
    }
  } catch {
    // storage disabled — notifications just repeat, which is harmless
  }
}

interface Toast {
  count: number;
  newestId: number;
  label: string;
}

/** Background poller + toast for new exchange fills. Mounted once in Layout
 * so it runs on every page while the app is open (in-app notifications
 * only — nothing leaves the browser). */
export function TradeNotifier() {
  const { user } = useAuth();
  const t = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [toast, setToast] = useState<Toast | null>(null);
  const onTradesPage = location.pathname === "/trades";
  const onTradesRef = useRef(onTradesPage);
  onTradesRef.current = onTradesPage;

  useEffect(() => {
    activeUserId = user?.id ?? null;
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    let stop = false;

    const check = async () => {
      try {
        // Best-effort pull; 429 (throttled) and "no binance accounts" are
        // both fine — we still diff against whatever is stored.
        await api.syncTrades().catch(() => null);
        const list = await api.listTrades({ limit: 20 });
        if (stop || list.items.length === 0) return;
        const newest = list.items[0];
        const seen = readSeen(user.id);
        if (seen == null || onTradesRef.current) {
          // First run (nothing seen yet) or already looking at the page:
          // record silently instead of announcing history.
          markTradesSeen(newest.id);
          return;
        }
        if (newest.id > seen) {
          const count = list.items.filter((i) => i.id > seen).length;
          setToast({
            count,
            newestId: newest.id,
            label: `${newest.symbol} ${newest.side.toUpperCase()}`,
          });
        }
      } catch {
        // network hiccup — retry on the next tick
      }
    };

    check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!toast) return null;

  const dismiss = () => {
    markTradesSeen(toast.newestId);
    setToast(null);
  };

  return (
    <div
      className="sketch-box p-12"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 200,
        background: "var(--paper, #fbfbfa)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
      }}
    >
      <div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
          <b>{t.trades.toastNew(toast.count)}</b>
        </div>
        <div className="tiny muted">{toast.label}</div>
      </div>
      <button
        className="btn"
        onClick={() => {
          dismiss();
          navigate("/trades");
        }}
      >
        {t.trades.toastView}
      </button>
      <span className="hand tiny muted" onClick={dismiss} style={{ cursor: "pointer" }}>
        ✕
      </span>
    </div>
  );
}
