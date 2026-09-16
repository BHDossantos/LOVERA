"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import type { Introduction } from "@/lib/types";

export function useIntroduction(id: string) {
  return useQuery({ queryKey: ["introduction", id], queryFn: () => get<Introduction>(`/introductions/${id}`), enabled: !!id });
}

const viewed = new Set<string>();

/** Records which explanation sections the member actually saw (analytics only; never affects matching). */
export function useExplanationViewed(id: string, sections: string[], ready: boolean) {
  const key = `${id}:${sections.join(",")}`;
  useEffect(() => {
    if (!ready || !id || viewed.has(key)) return;
    viewed.add(key);
    post(`/introductions/${id}/explanation-viewed`, { sections }).catch(() => {
      /* analytics only; never blocks the member */
    });
  }, [id, key, ready, sections]);
}
