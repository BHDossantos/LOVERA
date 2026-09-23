import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

/**
 * Typed API transport, the phone counterpart of apps/web/src/lib/api.ts.
 *
 * Two differences from the web client, both deliberate:
 *   - the refresh token lives in the platform keychain / keystore via SecureStore,
 *     not in localStorage, because on a phone the device is the shared surface;
 *   - the base URL is absolute, since there is no Next.js proxy in front of us.
 *
 * Everything else — the in-memory access token, single-flight refresh, idempotency
 * keys on retryable commands, If-Match on optimistic updates, machine error codes —
 * matches the web client so the two cannot drift in behaviour.
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

const REFRESH_KEY = "mm.refresh";

function baseUrl(): string {
  const origin = (Constants.expoConfig?.extra as { apiOrigin?: string } | undefined)?.apiOrigin;
  if (!origin) throw new Error("apiOrigin is not configured; check app.config.ts and the EAS profile.");
  return `${origin.replace(/\/$/, "")}/v1`;
}

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

export async function setTokens(access: string | null, refresh: string | null) {
  accessToken = access;
  try {
    if (refresh) await SecureStore.setItemAsync(REFRESH_KEY, refresh);
    else await SecureStore.deleteItemAsync(REFRESH_KEY);
  } catch {
    // A keychain that refuses to store is a signed-out session, not a crash.
  }
  emit();
}

export async function hasStoredSession() {
  try {
    return !!(await SecureStore.getItemAsync(REFRESH_KEY));
  } catch {
    return false;
  }
}

export async function clearSession() {
  await setTokens(null, null);
}

export async function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    let refresh: string | null = null;
    try {
      refresh = await SecureStore.getItemAsync(REFRESH_KEY);
    } catch {
      return false;
    }
    if (!refresh) return false;
    try {
      const res = await fetch(`${baseUrl()}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) {
        await clearSession();
        return false;
      }
      const data = await res.json();
      await setTokens(data.access_token, data.refresh_token);
      return true;
    } catch {
      // Offline: keep the stored token so the session survives a tunnel or a flight.
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export function newIdempotencyKey() {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
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
    res = await fetch(`${baseUrl()}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
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
export const post = <T,>(path: string, body?: unknown, extra?: Omit<Options, "method" | "body">) =>
  api<T>(path, { method: "POST", body: body ?? {}, ...extra });
export const put = <T,>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body });
export const patch = <T,>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body });
export const del = <T,>(path: string) => api<T>(path, { method: "DELETE" });
