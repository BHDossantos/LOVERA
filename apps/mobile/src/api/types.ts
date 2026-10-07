export type Capabilities = {
  plan: string;
  entitlements: {
    plan: string;
    plan_name: string;
    paid: boolean;
    weekly_intro_cap: number;
    trial_introductions_remaining: number;
    ai_wingman: boolean;
    translation: boolean;
    date_concierge: boolean;
    adaptive_refresh: boolean;
    travel_mode: boolean;
    dating_passport: boolean;
    protected_credits: number;
    safety_tools: boolean;
    messaging: boolean;
    manual_date_planning: boolean;
    renews_at: string | null;
    cancel_at_period_end: boolean;
    status: string;
  };
  restrictions: string[];
};

export type Me = {
  id: string;
  email: string;
  status: string;
  onboarding_step: string;
  locale: string;
  timezone: string;
  market_id: string;
  home_city_id: string | null;
  home_zone_id: string | null;
  intent: string | null;
  gender: string | null;
  seeking: string[];
  max_distance_km: number;
  date_ready: boolean;
  roles: string[];
  verification_status: string;
  blueprint_confirmed: boolean;
  profile_complete: boolean;
  availability_set: boolean;
  capabilities: Capabilities;
  deletion_due_at: string | null;
  paused: boolean;
  created_at: string;
};

export type Strength = "strong" | "promising" | "low_evidence";

export type Reason = { label: string; strength: Strength; text: string; evidence_ids?: string[] };

export type Explanation = {
  reasons: Reason[];
  friction: { text: string; strength: Strength };
  unknown: { text: string; strength: Strength; missing_signal_keys?: string[] };
  data_categories: string[];
  generator_version: string;
  reviewed?: boolean;
};

export type ProfileSnapshot = {
  member_id: string | null;
  display_name: string;
  pronouns?: string | null;
  age?: number | null;
  city?: string | null;
  distance_band_km?: string;
  verified: boolean;
  intent?: string | null;
  languages?: string[];
  occupation?: string | null;
  bio?: string | null;
  prompts?: { key: string; answer: string }[];
  media: { id: string; type: string; url: string | null; alt_text?: string | null }[];
};

export type Introduction = {
  id: string;
  status: string;
  offered_at: string | null;
  expires_at: string | null;
  extension_available: boolean;
  is_trial: boolean;
  your_decision: string | null;
  mutual_interest_revealed: boolean;
  conversation_id: string | null;
  version: number;
  actions: { can_accept: boolean; can_decline: boolean; can_extend: boolean; can_correct: boolean };
  privacy: string;
  profile: ProfileSnapshot | null;
  explanation: Explanation | null;
};

export type ConversationSummary = {
  id: string;
  introduction_id: string;
  status: string;
  public_reason: string | null;
  other: ProfileSnapshot;
  last_message: { text: string; sent_at: string; mine: boolean } | null;
  unread: number;
  date: { date_plan_id: string; status: string; starts_at: string | null } | null;
  opened_at: string;
  safety_hold: boolean;
  /**
   * The block and report target, carried separately from `other` because `other` is
   * neutralised once the conversation closes (no name, no photo, no id) — which also took
   * away the only thing the safety actions could act on.
   */
  safety: { subject_id: string | null; blocked_by_you: boolean };
};

export type Message = {
  id: string;
  client_message_id: string;
  sequence: number;
  sender_id: string;
  mine: boolean;
  type: string;
  text: string;
  moderation_state: string;
  meta: Record<string, unknown>;
  sent_at: string;
};

export type Venue = {
  id: string;
  name: string;
  coarse_area: string;
  categories: string[];
  price_band: string;
  accessibility: Record<string, boolean>;
  atmosphere: string | null;
  public_place: boolean;
  travel?: { you_km_band: string; them_km_band: string };
};

export type DatePlan = {
  id: string;
  conversation_id: string;
  status: string;
  timezone: string;
  starts_at: string | null;
  ends_at: string | null;
  venue: Venue | null;
  date_style: string | null;
  proposed_by_you: boolean;
  you_confirmed: boolean;
  awaiting_your_confirmation: boolean;
  other_display_name: string;
  version: number;
  history: { by: string; action: string; at: string; changed_fields?: string[] }[];
  cancellation_rules: string;
  calendar_title: string;
  check_in: { state: string; share_scope: string; check_at: string; trusted_contact_name: string; expires_at: string } | null;
  feedback_submitted: boolean;
  feedback_open: boolean;
  safety: { emergency: string; guidance: string[] };
};

export type TodayTask = { key: string; priority: number; title: string; body: string; path: string; cta: string; deadline?: string };

export type Notification = { id: string; type: string; group: string; title: string; body: string; deep_link: string | null; read_at: string | null; created_at: string };

/** GET /blueprint/current */
export type BlueprintSignal = {
  key: string;
  category: string;
  label: string;
  value: string | null;
  value_label: string;
  confidence: string;
  evidence: string | null;
  member_corrected: boolean;
  freshness_at: string | null;
  special_category: boolean;
  /**
   * False for a special-category signal the member has withdrawn consent for. The row is still
   * returned — they are entitled to see what we hold — but `correct_signal` refuses to change it,
   * so anything offering an edit has to respect this or it offers a guaranteed 403.
   */
  correctable: boolean;
  options: { value: string; label: string }[];
};

/** A catalog signal the member has never answered: no value, but choosable. */
export type UnansweredSignal = {
  key: string;
  category: string;
  label: string;
  special_category: boolean;
  options: { value: string; label: string }[];
};

export type Blueprint = {
  version: { id: string; version_no: number; confirmed_at: string | null; model_version: string } | null;
  signals: BlueprintSignal[];
  /**
   * Kept separate from `signals` so `coverage` and the Blueprint screen keep their meaning,
   * but the correction form has to include them: a signal the matcher says it is missing is
   * precisely the one the member cannot otherwise supply.
   */
  unanswered: UnansweredSignal[];
  coverage: Record<string, number>;
  freshness: { age_days: number | null; stale: boolean; refresh_after_days: number };
  data_use: string;
};

/**
 * POST /introductions/{id}/correction
 *
 * `applied` is false when no replacement value was chosen: the correction is on record for a
 * reviewer, but nothing about matching changed, and the screen must not claim otherwise.
 */
export type CorrectionResult = { recorded: boolean; applied: boolean; message: string };
