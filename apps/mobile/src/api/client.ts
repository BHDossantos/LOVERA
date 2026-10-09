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

/** A host that only ever means "this machine", which on a phone is the phone. */
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/i;
/** scheme, host (bracketed for IPv6), optional port — enough to swap the host and keep the rest. */
const ORIGIN = /^(https?:\/\/)(\[[^\]]+\]|[^/:]+)(:\d+)?$/i;

/**
 * The origin to actually call, with the development host resolved on the device.
 *
 * `app.config.ts` is evaluated by the Expo CLI on the developer's machine, so the origin it
 * bakes into `extra` cannot know anything about the device that will run the bundle. Its
 * development fallback is `http://127.0.0.1:8000`, which is right on a simulator sharing the
 * machine's loopback and wrong on every physical phone: there `127.0.0.1` is the phone itself,
 * nothing is listening on it, and every request fails before it leaves the handset. That is the
 * whole of "the API is failing" when the app is opened on a real device from `expo start`.
 *
 * The dev server already tells the app where it came from — `hostUri` on the manifest is the host
 * the bundle was fetched from — so a loopback origin is rewritten to that host, keeping the API's
 * own port rather than the dev server's. Outside a dev server `hostUri` is absent and nothing
 * changes, so a release build is untouched; an origin that is already reachable is never
 * rewritten, so `EXPO_PUBLIC_API_ORIGIN` still wins whenever it is set.
 *
 * Exported for the tests, which is also the only way to check this without a phone.
 */
export function resolveOrigin(origin: string, hostUri?: string): string {
  if (!hostUri) return origin;
  const parts = ORIGIN.exec(origin.replace(/\/$/, ""));
  if (!parts) return origin;
  const [, scheme, host, port = ""] = parts;
  if (!LOOPBACK.test(host)) return origin;
  // `hostUri` arrives as `192.168.1.10:8081`, and sometimes with a scheme in front of it. The
  // port is the dev server's, not the API's, so it is dropped.
  const devHost = hostUri
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .split("/")[0]
    .replace(/:\d+$/, "");
  if (!devHost || LOOPBACK.test(devHost)) return origin;
  return `${scheme}${devHost}${port}`;
}

function baseUrl(): string {
  const origin = (Constants.expoConfig?.extra as { apiOrigin?: string } | undefined)?.apiOrigin;
  if (!origin) throw new Error("apiOrigin is not configured; check app.config.ts and the EAS profile.");
  return `${resolveOrigin(origin, Constants.expoConfig?.hostUri).replace(/\/$/, "")}/v1`;
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
        // The device id goes with it so the server can tell this retry from a replay of a token that
        // leaked: a refresh interrupted by a cold start is retried with a token the server has already
        // seen, and without something tying the request to this handset the two look identical.
        body: JSON.stringify({ refresh_token: refresh, device_id: await deviceId() }),
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

const DEVICE_KEY = "mm.device";

/**
 * A stable id for this installation, kept in the keychain.
 *
 * It lives here rather than beside the sign-in screen because the transport needs it too: a refresh
 * sends it so the server can tell a retry of an interrupted refresh from a replay of a token that
 * leaked. It is not a secret and is not meant to be one — the point is only that it is not carried
 * *in* the token, so a token that escapes on its own does not bring it along.
 */
export async function deviceId() {
  try {
    let id = await SecureStore.getItemAsync(DEVICE_KEY);
    if (!id) {
      id = newIdempotencyKey();
      await SecureStore.setItemAsync(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "mobile";
  }
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

/**
 * A photo, as something `<Image>` can actually display.
 *
 * `GET /v1/media/{id}` is authorized per viewer — the owner, or somebody with a live introduction
 * or conversation with them — so it needs the access token, and it answers with the image as a
 * `data:` URL in a `text/plain` body rather than with image bytes.
 *
 * Neither of those survives being handed to `<Image source={{ uri }}>`, and the introduction screen
 * was doing exactly that with the relative path the API returns. React Native has no document to
 * resolve `/v1/media/...` against and sends no Authorization header, so **no photo has ever loaded
 * on the phone**: the request never left the handset, and `<Image>` fails silently, so it looked
 * like members simply had no photos. The web app has had its own fetch-then-render component for
 * this since the beginning; this is its counterpart.
 *
 * Returns null rather than throwing. A photo that will not load is a degraded card, not an error
 * banner across a screen that is otherwise fine.
 */
export async function mediaDataUrl(path: string, retry = true): Promise<string | null> {
  const url = `${baseUrl()}${path.replace(/^\/v1/, "")}`;
  try {
    const res = await fetch(url, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    });
    if (res.status === 401 && retry) {
      const ok = await refreshSession();
      if (ok) return mediaDataUrl(path, false);
      return null;
    }
    if (!res.ok) return null;
    const body = (await res.text()).trim();
    return body.startsWith("data:") ? body : null;
  } catch {
    return null;
  }
}

export const get = <T,>(path: string) => api<T>(path);
export const post = <T,>(path: string, body?: unknown, extra?: Omit<Options, "method" | "body">) =>
  api<T>(path, { method: "POST", body: body ?? {}, ...extra });
export const put = <T,>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body });
export const patch = <T,>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body });
export const del = <T,>(path: string) => api<T>(path, { method: "DELETE" });
