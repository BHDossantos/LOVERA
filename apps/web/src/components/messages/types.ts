import type { ConversationSummary, Message } from "@/lib/types";

/** GET /conversations */
export type ConversationList = { items: ConversationSummary[]; pilot_cap: number };

/** GET /conversations/{id}/messages?cursor=&limit= (items ascending by sequence) */
export type History = { items: Message[]; next_cursor: number | null; has_more: boolean };

/** POST /conversations/{id}/ai-drafts */
export type Draft = {
  draft_id: string;
  text: string;
  requires_member_review: boolean;
  can_auto_send: boolean;
  model_version: string;
  safety_labels: string[];
  provenance: string;
};

/** POST /conversations/{id}/translations */
export type TranslationResult = {
  translation_id: string;
  source: { lang: string; text: string };
  translated: { lang: string; text: string };
  confidence: number;
  low_confidence: boolean;
  note: string | null;
  requires_member_review: boolean;
  can_auto_send: boolean;
  model_version: string;
  created_at: string;
};

/** POST /conversations/{id}/close */
export type CloseResult = { conversation_id: string; status: string; blocked: boolean };

export type SendPayload = { client_message_id: string; text: string; translation_id?: string; source_lang?: string; draft_id?: string };

/** A message the member composed that has not (yet) been confirmed by the server. */
export type PendingMessage = { client_message_id: string; text: string; state: "sending" | "failed"; error?: string; translation_id?: string; source_lang?: string };

export type RealtimeEvent =
  | { type: "conversation.message.created"; conversation_id: string; message: Message; sequence: number; occurred_at?: string }
  | { type: "conversation.closed"; conversation_id: string; public_reason_code?: string }
  | { type: "date_plan.updated"; date_plan_id: string; status: string; version?: number; changed_fields?: string[] }
  | { type: "introduction.updated"; introduction_id?: string }
  | { type: "pong" }
  | { type: string };

export const TONES: { value: "natural" | "warm" | "playful" | "direct"; label: string; body: string }[] = [
  { value: "natural", label: "Natural", body: "Sounds like an ordinary message from you." },
  { value: "warm", label: "Warm", body: "A little more openness and encouragement." },
  { value: "playful", label: "Playful", body: "Light, with a gentle sense of humour." },
  { value: "direct", label: "Direct", body: "Clear and to the point." },
];

export const GOALS: { value: "opener" | "respond" | "suggest_public_date" | "reconnect"; label: string; body: string }[] = [
  { value: "opener", label: "Say hello", body: "A first message grounded in their own prompt answers." },
  { value: "respond", label: "Reply to their last message", body: "Continue the thread they started." },
  { value: "suggest_public_date", label: "Suggest a public date", body: "Propose a safe public place and an overlapping time." },
  { value: "reconnect", label: "Pick things back up", body: "A gentle restart after a quiet spell." },
];

export const TRANSLATION_LANGS = ["en", "it", "es", "pt"] as const;
export type TranslationLang = (typeof TRANSLATION_LANGS)[number];

export const CLOSE_REASONS: { code: "not_for_me" | "timing" | "met_someone" | "no_reply" | "other" | "safety"; label: string; body: string }[] = [
  { code: "not_for_me", label: "Not the right fit for me", body: "Private. Never shown to them." },
  { code: "timing", label: "Timing isn't right", body: "Private. Never shown to them." },
  { code: "met_someone", label: "I've met someone", body: "Private. Never shown to them." },
  { code: "no_reply", label: "The conversation went quiet", body: "Private. Never shown to them." },
  { code: "other", label: "Something else", body: "Private. Never shown to them." },
  { code: "safety", label: "I felt unsafe or uncomfortable", body: "Routed to the safety team, never to matching." },
];

export const CONVERSATION_STATUS_LABEL: Record<string, string> = { active: "Active", closed: "Ended", safety_hold: "Paused for safety review" };
