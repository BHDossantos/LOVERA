import type { Introduction } from "@/lib/types";

/** GET /introductions/waiting and the `waiting` field of GET /introductions (I06). */
export type WaitingPayload = {
  eligible_after_must: number;
  verified_pool: number;
  capacity: number;
  reasons: { code: string; text: string }[];
  protected_credits: number;
  next_batch: string;
  broaden_hint: string;
};

/** GET /introductions */
export type IntroductionList = {
  current: Introduction[];
  mutual: Introduction[];
  history: Introduction[];
  waiting: WaitingPayload | null;
};

/** POST /introductions/{id}/decision (202) */
export type DecisionResult = {
  introduction_id: string;
  your_decision: "accept" | "decline";
  status: string;
  mutual_interest_revealed: boolean;
  conversation_id: string | null;
  version: number;
};

/** POST /introductions/{id}/correction */
export type CorrectionResult = { recorded: boolean; message: string };

/** Subset of GET /blueprint/current used by the correction form. */
export type BlueprintSignal = { key: string; category: string; label: string; value: string | null; value_label: string; options: { value: string; label: string }[]; special_category: boolean };
export type BlueprintCurrent = { signals: BlueprintSignal[] };

/** Structured pass reasons (DECLINE_REASONS in introductions/service.py). */
export const DECLINE_REASONS: { code: string; label: string }[] = [
  { code: "timing", label: "Timing isn't right for me" },
  { code: "distance", label: "Distance would make regular dates hard" },
  { code: "life_plan", label: "Our life plans point different ways" },
  { code: "lifestyle", label: "Day-to-day lifestyle feels different" },
  { code: "no_spark", label: "I didn't feel drawn in" },
  { code: "prefer_not_to_say", label: "I'd rather not say" },
];

export const PROMPT_LABEL: Record<string, string> = {
  second_date: "A second date I'd say yes to looks like",
  ordinary_tuesday: "An ordinary Tuesday evening with me",
  learned_recently: "Something I learned recently",
  home_city: "My favourite corner of my city",
  repair: "After a disagreement, I",
  languages: "The languages I dream in",
  dealbreaker_soft: "A small thing that matters more than it should",
};

export const DATA_CATEGORY_LABEL: Record<string, string> = {
  life_plan: "Life plans",
  daily: "Daily life",
  values: "Values",
  interaction: "How you connect",
  logistics: "Logistics",
  readiness: "Readiness",
  availability: "Availability overlap",
  preferences: "Your preference tiers",
  blueprint: "Dating Blueprint signals",
  profile: "Profile facts",
  languages: "Declared languages",
  distance: "Coarse distance",
};

export function distanceLabel(band: string | undefined | null) {
  if (!band || band === "unknown") return "Distance not shared";
  if (band.endsWith("+")) return `More than ${band.slice(0, -1)} km apart`;
  return `${band} km apart`;
}

export const INTRO_STATUS_LABEL: Record<string, string> = {
  offered: "Waiting for your private decision",
  awaiting_other_member: "Your yes is private until they decide",
  mutual: "You both said yes",
  you_passed: "You passed",
  unavailable: "No longer available",
};
