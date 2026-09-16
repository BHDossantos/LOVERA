"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { applyPrefs, loadPrefs } from "@/app/you/settings/prefs";
import { AuthProvider } from "./auth";
import { ApiError } from "./api";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
            refetchOnWindowFocus: true,
          },
          mutations: { retry: false },
        },
      }),
  );
  // Per-viewer accessibility conveniences (text size, motion, contrast) live in localStorage.
  useEffect(() => {
    try {
      applyPrefs(loadPrefs());
    } catch {
      /* storage unavailable */
    }
  }, []);
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
