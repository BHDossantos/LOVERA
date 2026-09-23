import type { Introduction } from "@/api/types";

export type WaitingPayload = {
  eligible_after_must: number;
  verified_pool: number;
  capacity: number;
  reasons: { code: string; text: string }[];
  protected_credits: number;
  next_batch: string;
  broaden_hint: string;
};

export type IntroductionList = {
  current: Introduction[];
  mutual: Introduction[];
  history: Introduction[];
  waiting: WaitingPayload | null;
};

export type DecisionResult = {
  introduction_id: string;
  your_decision: "accept" | "decline";
  status: string;
  mutual_interest_revealed: boolean;
  conversation_id: string | null;
  version: number;
};

/** Structured pass reasons (DECLINE_REASONS in introductions/service.py). */
export const DECLINE_REASONS: { code: string; label: string }[] = [
  { code: "timing", label: "Timing isn't right for me" },
  { code: "distance", label: "Distance would make regular dates hard" },
  { code: "life_plan", label: "Our life plans point different ways" },
  { code: "lifestyle", label: "Day-to-day lifestyle feels different" },
  { code: "no_spark", label: "I didn't feel drawn in" },
  { code: "prefer_not_to_say", label: "I'd rather not say" },
];

export const INTRO_STATUS_LABEL: Record<string, string> = {
  offered: "Waiting for your private decision",
  awaiting_other_member: "Your yes is private until they decide",
  mutual: "You both said yes",
  you_passed: "You passed",
  unavailable: "No longer available",
};

export const PROMPT_LABEL: Record<string, string> = {
  second_date: "A second date I'd say yes to looks like",
  ordinary_tuesday: "An ordinary Tuesday evening with me",
  learned_recently: "Something I learned recently",
};
