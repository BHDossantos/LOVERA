"use client";

/**
 * Typed API transport. Access token stays in memory; the rotating refresh token is stored in
 * localStorage (the web pilot's secure-storage equivalent). Every retryable command sends an
 * Idempotency-Key. Errors are machine-coded (spec Section E).
 */
export type ApiErrorBody = {
  code: string;
  message: string;
  field_errors?: Record<string, string>;
  retryable?: boolean;
  retry_after?: number;
  request_id?: string;
  onboarding_step?: string;
  capability?: string;
  consent_required?: string;
};

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
  get code() {
    return this.body.code;
  }
}

const BASE = "/api";
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

export function onAuthChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit() {
  listeners.forEach((fn) => fn());
}

export function getAccessToken() {
  return accessToken;
}

export function setTokens(access: string | null, refresh: string | null) {
  accessToken = access;
  if (typeof window !== "undefined") {
    if (refresh) window.localStorage.setItem("mm.refresh", refresh);
    else window.localStorage.removeItem("mm.refresh");
  }
  emit();
}

export function hasStoredSession() {
  return typeof window !== "undefined" && !!window.localStorage.getItem("mm.refresh");
}

export function clearSession() {
  setTokens(null, null);
}

/**
 * A stable id for this browser, kept in localStorage.
 *
 * It lives beside the token storage rather than beside the sign-in screen because the refresh path
 * needs it too. It is not a secret and is not meant to be one — the point is only that it is not
 * carried *in* the token, so a token that escapes on its own does not bring it along.
 */
export function deviceId() {
  try {
    let id = window.localStorage.getItem("mm.device");
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem("mm.device", id);
    }
    return id;
  } catch {
    return "web";
  }
}

export async function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const refresh = typeof window !== "undefined" ? window.localStorage.getItem("mm.refresh") : null;
    if (!refresh) return false;
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The device id goes with it so the server can tell this retry from a replay of a token that
        // leaked: a refresh interrupted by a full page load is retried with a token the server has
        // already seen, and without something tying the request to this browser the two look identical.
        body: JSON.stringify({ refresh_token: refresh, device_id: deviceId() }),
      });
      if (!res.ok) {
        clearSession();
        return false;
      }
      const data = await res.json();
      setTokens(data.access_token, data.refresh_token);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type Options = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  ifMatch?: string | number;
  headers?: Record<string, string>;
  retry?: boolean;
};

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  if (opts.ifMatch !== undefined) headers["If-Match"] = `"${opts.ifMatch}"`;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  } catch {
    throw new ApiError(0, { code: "OFFLINE", message: "You appear to be offline. Nothing was lost.", retryable: true });
  }
  if (res.status === 401 && opts.retry !== false) {
    const ok = await refreshSession();
    if (ok) return api<T>(path, { ...opts, retry: false });
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: { code: "INTERNAL", message: "Unexpected response." } };
  }
  if (!res.ok) {
    const err = (data as { error?: ApiErrorBody })?.error ?? { code: "INTERNAL", message: "Something went wrong." };
    throw new ApiError(res.status, err);
  }
  return data as T;
}

export const get = <T,>(path: string) => api<T>(path);
export const post = <T,>(path: string, body?: unknown, extra?: Omit<Options, "method" | "body">) => api<T>(path, { method: "POST", body: body ?? {}, ...extra });
export const put = <T,>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body });
export const patch = <T,>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body });
export const del = <T,>(path: string) => api<T>(path, { method: "DELETE" });
