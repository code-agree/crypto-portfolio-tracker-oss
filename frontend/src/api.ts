import type {
  Account,
  AccountDetail,
  AccountInput,
  AutoSyncSettings,
  AutoSyncSettingsInput,
  BalanceHistory,
  CashflowSummary,
  CexCredentialInput,
  CexCredentialStatus,
  CredentialsStatus,
  DashboardSummary,
  Group,
  PositionsSummary,
  SyncEstimate,
  SyncResult,
  SyncSummary,
  TopAsset,
  TradeList,
  TradeStats,
  TradeSyncSummary,
  User,
} from "./types";

const BASE = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      // ignore
    }
    // FastAPI errors come back as {"detail": "..."} — surface that string.
    let message = body;
    try {
      const parsed = JSON.parse(body);
      if (parsed?.detail) message = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail);
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, message || `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  // Auth — signup creates the account and signs you in immediately.
  signup: (email: string, password: string) =>
    http<User>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string) =>
    http<User>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => http<void>("/api/auth/logout", { method: "POST" }),
  me: () => http<User>("/api/auth/me"),
  deleteMe: () => http<void>("/api/auth/me", { method: "DELETE" }),

  // Accounts
  listAccounts: (q?: { source?: string; group?: string }) => {
    const params = new URLSearchParams();
    if (q?.source) params.set("source", q.source);
    if (q?.group) params.set("group", q.group);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return http<Account[]>(`/api/accounts${suffix}`);
  },
  getAccount: (id: string) => http<AccountDetail>(`/api/accounts/${id}`),
  createAccount: (body: AccountInput) =>
    http<Account>("/api/accounts", { method: "POST", body: JSON.stringify(body) }),
  updateAccount: (id: string, body: Partial<AccountInput>) =>
    http<Account>(`/api/accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  setExcludedKeys: (id: string, excluded_keys: string[]) =>
    http<Account>(`/api/accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ excluded_keys }),
    }),
  deleteAccount: (id: string) =>
    http<void>(`/api/accounts/${id}`, { method: "DELETE" }),

  // Groups
  listGroups: () => http<Group[]>("/api/groups"),
  createGroup: (name: string, color: string) =>
    http<Group>("/api/groups", {
      method: "POST",
      body: JSON.stringify({ name, color }),
    }),
  updateGroup: (name: string, body: { name?: string; color?: string }) =>
    http<Group>(`/api/groups/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteGroup: (name: string) =>
    http<void>(`/api/groups/${name}`, { method: "DELETE" }),

  // Dashboard / balance / cashflow
  dashboardSummary: () => http<DashboardSummary>("/api/dashboard/summary"),
  topAssets: (minUsd: number = 1) =>
    http<TopAsset[]>(`/api/dashboard/top-assets?min_usd=${minUsd}`),
  balanceHistory: (range: string = "30D") =>
    http<BalanceHistory>(`/api/balance/history?range=${range}`),
  cashflow: () => http<CashflowSummary>("/api/cashflow"),

  // Credentials — CEX only (debank/coinstats are server-side env)
  credentialsStatus: () => http<CredentialsStatus>("/api/credentials"),
  setCexCredential: (accountId: string, body: CexCredentialInput) =>
    http<CexCredentialStatus>(`/api/credentials/cex/${accountId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteCexCredential: (accountId: string) =>
    http<void>(`/api/credentials/cex/${accountId}`, { method: "DELETE" }),

  // Sync
  syncAll: () => http<SyncSummary>("/api/sync/all", { method: "POST" }),
  syncAllEstimate: () => http<SyncEstimate>("/api/sync/all/estimate"),
  syncAccount: (id: string) =>
    http<SyncResult>(`/api/sync/account/${id}`, { method: "POST" }),

  // Prices — live spot lookup for custom-asset entry
  spotPrice: (symbol: string) =>
    http<{ symbol: string; price_usd: number; source: string }>(
      `/api/prices/${encodeURIComponent(symbol)}`,
    ),

  // Positions — cross-account view of the latest snapshots
  positions: () => http<PositionsSummary>("/api/positions"),

  // Trades — pull/list Binance fills + aggregates
  syncTrades: () => http<TradeSyncSummary>("/api/trades/sync", { method: "POST" }),
  listTrades: (q?: { limit?: number; offset?: number; market?: string; symbol?: string; days?: number }) => {
    const params = new URLSearchParams();
    if (q?.limit) params.set("limit", String(q.limit));
    if (q?.offset) params.set("offset", String(q.offset));
    if (q?.market) params.set("market", q.market);
    if (q?.symbol) params.set("symbol", q.symbol);
    if (q?.days) params.set("days", String(q.days));
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return http<TradeList>(`/api/trades${suffix}`);
  },
  tradeStats: (days: number = 30) => http<TradeStats>(`/api/trades/stats?days=${days}`),

  // Daily auto-sync
  autoSyncSettings: () => http<AutoSyncSettings>("/api/auto-sync/settings"),
  setAutoSyncSettings: (body: AutoSyncSettingsInput) =>
    http<AutoSyncSettings>("/api/auto-sync/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
};
