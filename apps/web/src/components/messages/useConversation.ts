"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import type { ConversationSummary } from "@/lib/types";
import type { RealtimeEvent } from "./types";

export function useConversation(id: string) {
  return useQuery({ queryKey: ["conversation", id], queryFn: () => get<ConversationSummary>(`/conversations/${id}`), enabled: !!id });
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL;

/**
 * Realtime subscription. Fetches a short-lived participant-scoped token, opens the socket and reconnects
 * with backoff. Returns `connected` so callers can fall back to polling while the socket is down.
 */
export function useRealtime(onEvent: (e: RealtimeEvent) => void, enabled = true) {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!enabled || !WS_URL || typeof window === "undefined") return;
    let alive = true;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    let attempt = 0;

    const schedule = () => {
      if (!alive) return;
      attempt += 1;
      const delay = Math.min(30_000, 2_000 * 2 ** Math.min(attempt, 4));
      retry = setTimeout(connect, delay);
    };

    const connect = async () => {
      if (!alive) return;
      let token: string;
      try {
        token = (await get<{ token: string }>("/realtime/token")).token;
      } catch {
        schedule();
        return;
      }
      if (!alive) return;
      try {
        ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
      } catch {
        schedule();
        return;
      }
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
      };
      ws.onmessage = (ev: MessageEvent<string>) => {
        try {
          const data = JSON.parse(ev.data) as RealtimeEvent;
          if (data && typeof data.type === "string" && data.type !== "pong") handler.current(data);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (ping) clearInterval(ping);
        ping = null;
        schedule();
      };
      ws.onerror = () => {
        /* onclose follows and schedules the reconnect */
      };
    };

    connect();
    return () => {
      alive = false;
      if (retry) clearTimeout(retry);
      if (ping) clearInterval(ping);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      setConnected(false);
    };
  }, [enabled]);

  return { connected };
}
