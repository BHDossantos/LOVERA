"""Typed, allowlisted analytics (specification Section D). Unregistered properties are rejected, never silently stored."""
from __future__ import annotations

import hashlib
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.privacy import AnalyticsEvent

ALLOWED: dict[str, set[str]] = {
    "account_created": {"locale", "market", "acquisition_channel"},
    "verification_started": {"vendor_type", "market"},
    "verification_completed": {"status", "duration_bucket"},
    "blueprint_answered": {"question_id", "input_mode", "latency_bucket"},
    "blueprint_confirmed": {"version", "signal_count", "must_count", "prefer_count", "open_count"},
    "profile_completed": {"completion_categories"},
    "availability_updated": {"window_count", "calendar_connected"},
    "introduction_offered": {"intro_id", "run_id", "rules_version", "model_version", "rank", "propensity"},
    "introduction_opened": {"intro_id", "latency_bucket"},
    "explanation_viewed": {"intro_id", "sections"},
    "intro_decision": {"intro_id", "decision", "reason_codes", "latency_bucket"},
    "mutual_accept": {"intro_id", "latency_bucket_a", "latency_bucket_b"},
    "message_sent": {"type", "length_bucket", "moderation_state"},
    "ai_draft_generated": {"mode", "model_version", "latency_bucket", "safety_labels"},
    "ai_draft_used": {"edit_distance_bucket", "time_to_send_bucket"},
    "translation_previewed": {"language_pair", "confidence_bucket"},
    "date_proposed": {"time_distance_bucket", "venue_category"},
    "date_confirmed": {"lead_time_bucket", "venue_category"},
    "checkin_enabled": {"share_scope", "lead_time_bucket"},
    "postdate_submitted": {"attendance", "answer_present", "safety_flag"},
    "mutual_second_date": {"market", "cohort", "time_from_intro_bucket"},
    "safety_report_started": {"entry_surface", "category"},
    "safety_report_submitted": {"category", "severity", "evidence_count"},
    "protective_action_applied": {"action_type", "automated"},
    "appeal_submitted": {"action_type", "days_since_action"},
    "subscription_started": {"plan", "price", "currency", "channel", "cadence"},
    "credit_changed": {"delta", "reason", "balance"},
    "data_right_exercised": {"type"},
}


class AnalyticsPropertyError(ValueError):
    pass


def anon_key(member_id: str | None) -> str | None:
    if not member_id:
        return None
    return hashlib.sha256(f"analytics:{get_settings().secret_key}:{member_id}".encode("utf-8")).hexdigest()[:32]


def track(db: Session, event: str, member_id: str | None = None, **properties: Any) -> None:
    allowed = ALLOWED.get(event)
    if allowed is None:
        raise AnalyticsPropertyError(f"unregistered analytics event {event}")
    illegal = set(properties) - allowed
    if illegal:
        raise AnalyticsPropertyError(f"properties not allowed for {event}: {sorted(illegal)}")
    db.add(AnalyticsEvent(event=event, anon_member_key=anon_key(member_id), properties=properties))


def bucket(seconds: float) -> str:
    if seconds < 60:
        return "<1m"
    if seconds < 3600:
        return "<1h"
    if seconds < 86400:
        return "<1d"
    return ">=1d"
