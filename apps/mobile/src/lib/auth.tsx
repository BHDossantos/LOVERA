import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { registerForPush, unregisterPush } from "@/lib/push";
import {
  ApiError,
  clearSession,
  get,
  hasStoredSession,
  newIdempotencyKey,
  onAuthChange,
  post,
  refreshSession,
  setTokens,
} from "@/api/client";
import type { Me } from "@/api/types";

/** Mirrors apps/web/src/lib/auth.tsx; storage and navigation are the only platform pieces. */
type AuthState = {
  me: Me | null;
  loading: boolean;
  error: ApiError | null;
  refresh: () => Promise<Me | null>;
  signOut: () => Promise<void>;
  signIn: (challengeId: string, code: string) => Promise<Me | null>;
};

const Ctx = createContext<AuthState | null>(null);
const DEVICE_KEY = "mm.device";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Reachable because QueryClientProvider wraps this provider in app/_layout.tsx.
  const qc = useQueryClient();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await get<Me>("/me");
      setMe(data);
      setError(null);
      return data;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else setError(e as ApiError);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await hasStoredSession();
      if (cancelled) return;
      if (stored && (await refreshSession())) await refresh();
      else setLoading(false);
    })();
    const off = onAuthChange(() => {
      void hasStoredSession().then((stored) => {
        if (!stored) setMe(null);
      });
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [refresh]);

  const signIn = useCallback(
    async (challengeId: string, code: string) => {
      const data = await post<{ access_token: string; refresh_token: string }>("/auth/verify", {
        challenge_id: challengeId,
        code,
        device_id: await deviceId(),
      });
      await setTokens(data.access_token, data.refresh_token);
      // And on the way in, for the same reason from the other side: a session can end without
      // signOut running (an expired refresh token, a force-quit), so whatever is cached at this
      // point may belong to somebody else.
      qc.clear();
      return refresh();
    },
    [refresh, qc],
  );

  const signOut = useCallback(async () => {
    // Retire this handset's push tokens first: whoever holds the phone next must not
    // be shown who wants to meet the person who just signed out.
    await unregisterPush(await deviceId());
    try {
      await post("/auth/logout");
    } catch {
      /* session already gone */
    }
    await clearSession();
    // Then the cache. `clearSession()` takes the tokens, which stops new requests, but every
    // answer already fetched stays in the QueryClient — safety case categories and receipt codes,
    // blocked members' names, conversations, the Blueprint. `staleTime` does not help: a stale
    // query renders its cached data while it refetches, and on a handset two people share, the
    // next person to sign in sees the last person's for as long as that takes. The comment above
    // is the rule; this is the rest of keeping it.
    qc.clear();
    setMe(null);
  }, [qc]);

  // Registration happens once we have a member and is safe to repeat: the endpoint is
  // idempotent on the token, and the platform can reissue a token at any launch.
  const memberId = me?.id;
  useEffect(() => {
    if (!memberId) return;
    void deviceId().then((id) => registerForPush(id));
  }, [memberId]);

  const value = useMemo(
    () => ({ me, loading, error, refresh, signOut, signIn }),
    [me, loading, error, refresh, signOut, signIn],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

export const ONBOARDING_PATHS: Record<string, string> = {
  account: "/onboarding/account",
  verification: "/onboarding/verification",
  intent: "/onboarding/intent",
  blueprint: "/onboarding/blueprint/interview",
  blueprint_review: "/onboarding/blueprint/interview",
  profile: "/onboarding/profile",
  availability: "/onboarding/availability",
  done: "/today",
};

export function nextOnboardingPath(me: Me) {
  if (me.status === "restricted") return "/account/review";
  return ONBOARDING_PATHS[me.onboarding_step] ?? "/today";
}

/** Route guard for member screens: send to sign-in, or to the first incomplete step. */
export function useRequireMember(opts: { allowOnboarding?: boolean; allowRestricted?: boolean } = {}) {
  const { me, loading } = useAuth();
  const router = useRouter();
  const { allowOnboarding, allowRestricted } = opts;
  useEffect(() => {
    if (loading) return;
    if (!me) {
      router.replace("/welcome");
      return;
    }
    if (me.status === "restricted" && !allowRestricted) {
      router.replace("/account/review");
      return;
    }
    const onboarding = ["pending_consent", "pending_verification", "onboarding"].includes(me.status);
    if (onboarding && !allowOnboarding) router.replace(nextOnboardingPath(me) as never);
  }, [me, loading, router, allowOnboarding, allowRestricted]);
  return { me, loading };
}
