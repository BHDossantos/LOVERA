"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, clearSession, get, hasStoredSession, onAuthChange, post, refreshSession, setTokens } from "./api";
import type { Me } from "./types";

type AuthState = {
  me: Me | null;
  loading: boolean;
  error: ApiError | null;
  refresh: () => Promise<Me | null>;
  signOut: () => Promise<void>;
  signIn: (challengeId: string, code: string) => Promise<Me | null>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
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
    (async () => {
      if (hasStoredSession()) {
        const ok = await refreshSession();
        if (ok) await refresh();
        else setLoading(false);
      } else setLoading(false);
    })();
    const off = onAuthChange(() => {
      if (!hasStoredSession()) setMe(null);
    });
    return () => {
      off();
    };
  }, [refresh]);

  const signIn = useCallback(
    async (challengeId: string, code: string) => {
      const data = await post<{ access_token: string; refresh_token: string }>("/auth/verify", { challenge_id: challengeId, code, device_id: deviceId() });
      setTokens(data.access_token, data.refresh_token);
      return refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    try {
      await post("/auth/logout");
    } catch {
      /* session already gone */
    }
    clearSession();
    setMe(null);
  }, []);

  const value = useMemo(() => ({ me, loading, error, refresh, signOut, signIn }), [me, loading, error, refresh, signOut, signIn]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

function deviceId() {
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

/** Route guard for member routes: redirect to sign-in or the first incomplete onboarding step. */
export function useRequireMember(opts: { allowOnboarding?: boolean; allowRestricted?: boolean } = {}) {
  const { me, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!me) {
      router.replace("/welcome");
      return;
    }
    if (me.status === "restricted" && !opts.allowRestricted) {
      router.replace("/account/review");
      return;
    }
    const onboarding = ["pending_consent", "pending_verification", "onboarding"].includes(me.status);
    if (onboarding && !opts.allowOnboarding) router.replace(nextOnboardingPath(me));
  }, [me, loading, router, opts.allowOnboarding, opts.allowRestricted]);
  return { me, loading };
}
