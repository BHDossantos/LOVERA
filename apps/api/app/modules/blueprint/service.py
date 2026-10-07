"""Adaptive Dating Blueprint: interview -> proposed signals -> member confirmation -> immutable version."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.gateway import AIUnavailable
from app.ai.tasks import extract_signals
from app.catalog.questions import MIN_SCENARIOS_FOR_REVIEW, QUESTION_BY_KEY, QUESTIONS, next_question, review_ready
from app.catalog.signals import PREFERENCES, SIGNALS
from app.core.analytics import track
from app.core.audit import audit
from app.core.errors import ApiError
from app.core.timeutil import iso, utcnow
from app.models.account import Member
from app.models.blueprint import BlueprintSession, BlueprintSignal, BlueprintVersion, Preference


def question_payload(q, member: Member) -> dict[str, Any]:
    return {
        "key": q.key,
        "phase": q.phase,
        "category": q.category,
        "prompt": q.prompt,
        "help": q.help,
        "input": q.input,
        "options": [{"value": v, "label": l} for v, l in q.options],
        "skippable": q.skippable,
        "special_category": q.special_category,
        "tier_choice": q.tier_choice,
        "preference_key": q.preference_key,
        "preference_label": PREFERENCES[q.preference_key].label if q.preference_key else None,
        "preference_options": [{"value": v, "label": l} for v, l in q.options] if q.preference_key and q.options else None,
        "data_use": "matching_only" if not q.special_category else "matching_only_with_explicit_consent",
    }


def get_or_create_session(db: Session, member: Member, mode: str = "initial") -> BlueprintSession:
    session = db.execute(select(BlueprintSession).where(BlueprintSession.member_id == member.id, BlueprintSession.status == "active").order_by(BlueprintSession.created_at.desc())).scalars().first()
    if session is None:
        session = BlueprintSession(member_id=member.id, mode=mode)
        db.add(session)
        db.flush()
    return session


def _answered(session: BlueprintSession) -> tuple[set[str], set[str]]:
    answered = {a["question_key"] for a in session.answers if not a.get("skipped")}
    skipped = {a["question_key"] for a in session.answers if a.get("skipped")}
    return answered, skipped


def session_payload(db: Session, session: BlueprintSession, member: Member) -> dict[str, Any]:
    answered, skipped = _answered(session)
    q = next_question(answered, skipped) if session.status == "active" else None
    scenarios_answered = len([k for k in answered if QUESTION_BY_KEY[k].phase == "scenario"])
    total_non_neg = len([x for x in QUESTIONS if x.phase == "non_negotiable"])
    progress = min(1.0, (len([k for k in answered | skipped if QUESTION_BY_KEY[k].phase == "non_negotiable"]) + scenarios_answered) / (total_non_neg + MIN_SCENARIOS_FOR_REVIEW))
    return {
        "session_id": session.id,
        "status": session.status,
        "mode": session.mode,
        "progress": round(progress, 2),
        "answered": sorted(answered),
        "next_question": question_payload(q, member) if q else None,
        "review_ready": review_ready(answered),
        "estimated_minutes_remaining": max(0, round((total_non_neg + MIN_SCENARIOS_FOR_REVIEW - len(answered | skipped)) * 0.6)),
    }


def answer(db: Session, member: Member, session: BlueprintSession, question_key: str, choice: str | None, text: str | None, tier: str | None, partner_values: list[str] | None, range_value: dict[str, Any] | None, skip: bool, input_mode: str) -> dict[str, Any]:
    q = QUESTION_BY_KEY.get(question_key)
    if q is None:
        raise ApiError("VALIDATION_ERROR", "Unknown question.", field_errors={"question_key": "unknown"})
    if session.status != "active":
        raise ApiError("CONFLICT", "This interview is already in review.")
    if q.special_category and not skip:
        from app.modules.account.service import has_consent

        if not has_consent(db, member.id, "special_category"):
            raise ApiError("FORBIDDEN", "This question needs your explicit consent for sensitive data. You can skip it.", extra={"consent_required": "special_category"})
    session.answers = [a for a in session.answers if a["question_key"] != question_key]
    proposed = [s for s in session.proposed_signals if s.get("question_key") != question_key]
    record: dict[str, Any] = {"question_key": question_key, "input_mode": input_mode, "skipped": skip, "answered_at": iso(utcnow())}
    if not skip:
        extracted: list[dict[str, Any]] = []
        if q.input in ("choice", "choice_or_text") and choice and q.signal_key:
            if choice not in SIGNALS[q.signal_key].options:
                raise ApiError("VALIDATION_ERROR", "Choose one of the offered answers.", field_errors={"choice": "invalid"})
            extracted.append({"key": q.signal_key, "value": choice, "confidence": "strong", "evidence": f"You chose “{SIGNALS[q.signal_key].options[choice]}”.", "source": "choice"})
        elif q.input == "choice_or_text" and text and q.signal_key:
            candidates = [q.signal_key]
            # Scenario answers often reveal a second daily-life signal
            extra = {"weekend": "daily.social_rhythm", "weeknight_party": "daily.weekend_energy", "movement": "daily.sleep"}.get(q.key)
            if extra:
                candidates.append(extra)
            try:
                signals, model_version = extract_signals(q.key, text, candidates)
                session.model_version = model_version
            except AIUnavailable:
                signals = []
            if not signals:
                extracted.append({"key": q.signal_key, "value": None, "confidence": "low_evidence", "evidence": text[:200], "source": "text", "needs_choice": True})
            for s in signals:
                extracted.append({**s, "source": "text"})
        elif q.input == "range" and range_value is not None:
            lo, hi = int(range_value.get("min", 25)), int(range_value.get("max", 45))
            if lo < 18 or hi < lo or hi > 99:
                raise ApiError("VALIDATION_ERROR", "Enter a valid age range (18+).", field_errors={"range": "invalid"})
            record["range"] = {"min": lo, "max": hi}
        elif q.input == "number" and range_value is not None:
            km = int(range_value.get("value", 25))
            if km < 1 or km > 200:
                raise ApiError("VALIDATION_ERROR", "Distance must be between 1 and 200 km.", field_errors={"value": "invalid"})
            record["value"] = km
        elif q.input == "choice" and choice and q.signal_key:
            if choice not in SIGNALS[q.signal_key].options:
                raise ApiError("VALIDATION_ERROR", "Choose one of the offered answers.", field_errors={"choice": "invalid"})
            extracted.append({"key": q.signal_key, "value": choice, "confidence": "strong", "evidence": f"You chose “{SIGNALS[q.signal_key].options[choice]}”.", "source": "choice"})
        else:
            raise ApiError("VALIDATION_ERROR", "Answer or skip the question.", field_errors={"choice": "required"})
        record["raw_text"] = (text or "")[:1500] if text else None
        record["choice"] = choice
        if q.preference_key:
            record["preference"] = {"key": q.preference_key, "tier": tier or PREFERENCES[q.preference_key].default_tier, "values": partner_values or ([choice] if choice and not partner_values else [])}
            if q.tier_choice and tier not in ("must", "prefer", "open", None):
                raise ApiError("VALIDATION_ERROR", "Tier must be Must, Prefer or Open.", field_errors={"tier": "invalid"})
        for s in extracted:
            proposed.append({**s, "question_key": question_key, "category": SIGNALS[s["key"]].category})
    session.answers = [*session.answers, record]
    session.proposed_signals = proposed
    session.updated_at = utcnow()
    track(db, "blueprint_answered", member.id, question_id=question_key, input_mode=input_mode, latency_bucket="<1m")
    answered, skipped = _answered(session)
    if next_question(answered, skipped) is None:
        session.status = "ready_for_review"
    return session_payload(db, session, member)


def finish_interview(db: Session, member: Member, session: BlueprintSession) -> dict[str, Any]:
    answered, _ = _answered(session)
    if not review_ready(answered):
        raise ApiError("CONFLICT", "Answer the remaining non-negotiables and a few scenarios first.")
    session.status = "ready_for_review"
    return review_payload(db, member, session)


def review_payload(db: Session, member: Member, session: BlueprintSession) -> dict[str, Any]:
    """Human readable Must / Prefer / Open summary the member confirms before matching starts."""
    signals = []
    for s in session.proposed_signals:
        sig = SIGNALS[s["key"]]
        signals.append({
            "key": s["key"],
            "category": sig.category,
            "label": sig.label,
            "value": s.get("value"),
            "value_label": sig.options.get(s.get("value") or "", None),
            "options": [{"value": v, "label": l} for v, l in sig.options.items()],
            "confidence": s.get("confidence"),
            "evidence": s.get("evidence"),
            "source": s.get("source"),
            "needs_choice": s.get("needs_choice", False),
            "special_category": sig.special_category,
        })
    prefs = []
    for a in session.answers:
        p = a.get("preference")
        if not p:
            continue
        pdef = PREFERENCES[p["key"]]
        value: dict[str, Any]
        if pdef.operator == "range" and a.get("range"):
            value = a["range"]
        elif pdef.key == "distance_km":
            value = {"max": a.get("value", member.max_distance_km)}
        else:
            value = {"in": p.get("values", [])}
        prefs.append({"key": p["key"], "label": pdef.label, "tier": p.get("tier") or pdef.default_tier, "operator": pdef.operator, "value": value, "description": pdef.description})
    return {
        "session_id": session.id,
        "status": session.status,
        "signals": signals,
        "preferences": prefs,
        "tiers": {"must": [p for p in prefs if p["tier"] == "must"], "prefer": [p for p in prefs if p["tier"] == "prefer"], "open": [p for p in prefs if p["tier"] == "open"]},
        "confidence_wording": {"strong": "Strong evidence: you told us directly.", "promising": "Promising: inferred from your words; please check it.", "low_evidence": "Low evidence: we could not tell; choose the value or leave it out."},
        "note": "Nothing here is used for matching until you confirm it. You can correct any inference.",
    }


def confirm(db: Session, member: Member, session: BlueprintSession, signal_edits: list[dict[str, Any]], preference_edits: list[dict[str, Any]], removed_signal_keys: list[str]) -> BlueprintVersion:
    if session.status not in ("ready_for_review", "active"):
        raise ApiError("CONFLICT", "This interview was already confirmed.")
    answered, _ = _answered(session)
    if not review_ready(answered):
        raise ApiError("CONFLICT", "Finish the interview before confirming.")
    edits = {e["key"]: e for e in signal_edits}
    final: dict[str, dict[str, Any]] = {}
    for s in session.proposed_signals:
        key = s["key"]
        if key in removed_signal_keys:
            continue
        value = s.get("value")
        corrected = False
        if key in edits:
            value = edits[key].get("value")
            corrected = True
        if value is None or value not in SIGNALS[key].options:
            continue
        final[key] = {"value": value, "confidence": "strong" if corrected or s.get("source") == "choice" else s.get("confidence", "promising"), "evidence": s.get("evidence"), "corrected": corrected, "category": SIGNALS[key].category}
    for e in signal_edits:
        if e["key"] in SIGNALS and e["key"] not in final and e.get("value") in SIGNALS[e["key"]].options:
            final[e["key"]] = {"value": e["value"], "confidence": "strong", "evidence": "Added by you during review.", "corrected": True, "category": SIGNALS[e["key"]].category}
    if not final:
        raise ApiError("VALIDATION_ERROR", "Confirm at least one signal so matching has something to work with.")

    previous = db.execute(select(BlueprintVersion).where(BlueprintVersion.member_id == member.id).order_by(BlueprintVersion.version_no.desc())).scalars().first()
    for old in db.execute(select(BlueprintVersion).where(BlueprintVersion.member_id == member.id, BlueprintVersion.status == "confirmed")).scalars():
        old.status = "superseded"
    version = BlueprintVersion(member_id=member.id, version_no=(previous.version_no + 1) if previous else 1, status="confirmed", source_session_id=session.id, model_version=session.model_version, confirmed_at=utcnow())
    db.add(version)
    db.flush()
    for key, s in final.items():
        db.add(BlueprintSignal(blueprint_version_id=version.id, category=s["category"], key=key, normalized_value={"value": s["value"]}, confidence=s["confidence"], evidence_refs=[{"session": session.id, "text": s.get("evidence")}], member_corrected=s["corrected"], freshness_at=utcnow()))

    # Preferences: interview defaults, then member edits
    review = review_payload(db, member, session)
    pref_edits = {e["key"]: e for e in preference_edits}
    for p in review["preferences"]:
        edit = pref_edits.get(p["key"], {})
        upsert_preference(db, member, p["key"], edit.get("tier", p["tier"]), edit.get("value", p["value"]))
    for key, e in pref_edits.items():
        if key in PREFERENCES and key not in {p["key"] for p in review["preferences"]}:
            upsert_preference(db, member, key, e.get("tier", PREFERENCES[key].default_tier), e.get("value", {}))
    session.status = "completed"
    counts = {"must": 0, "prefer": 0, "open": 0}
    for p in db.execute(select(Preference).where(Preference.member_id == member.id)).scalars():
        counts[p.tier] = counts.get(p.tier, 0) + 1
    track(db, "blueprint_confirmed", member.id, version=version.version_no, signal_count=len(final), must_count=counts["must"], prefer_count=counts["prefer"], open_count=counts["open"])
    audit(db, actor_type="member", actor_id=member.id, action="blueprint.confirmed", resource_type="blueprint_version", resource_id=version.id, metadata={"version_no": version.version_no, "signals": len(final)})
    from app.core.events import publish

    publish(db, "blueprint.confirmed", "member", member.id, {"version_id": version.id}, dedupe_key=f"blueprint.confirmed:{version.id}")
    from app.modules.account.service import advance_onboarding

    advance_onboarding(db, member)
    return version


def upsert_preference(db: Session, member: Member, key: str, tier: str, value: dict[str, Any]) -> Preference:
    pdef = PREFERENCES.get(key)
    if pdef is None:
        raise ApiError("VALIDATION_ERROR", "Unknown preference.", field_errors={"key": "unknown"})
    if tier not in ("must", "prefer", "open"):
        raise ApiError("VALIDATION_ERROR", "Tier must be Must, Prefer or Open.", field_errors={"tier": "invalid"})
    if pdef.operator == "in" and pdef.target in SIGNALS:
        allowed = set(SIGNALS[pdef.target].options)
        value = {"in": [v for v in value.get("in", []) if v in allowed]}
    elif pdef.operator == "any_of":
        value = {"any_of": [v for v in value.get("any_of", value.get("in", [])) if isinstance(v, str)]}
    elif key == "age_range":
        lo, hi = int(value.get("min", 25)), int(value.get("max", 45))
        if lo < 18 or hi < lo:
            raise ApiError("VALIDATION_ERROR", "Enter a valid age range (18+).", field_errors={"value": "invalid"})
        value = {"min": lo, "max": hi}
    elif key == "distance_km":
        value = {"max": max(1, min(200, int(value.get("max", 25))))}
        member.max_distance_km = value["max"]
    if pdef.target in SIGNALS and SIGNALS[pdef.target].special_category:
        from app.modules.account.service import has_consent

        # At every tier, Open included. The `tier != "open"` exemption let a member with no
        # consent save a faith preference that build_snapshot then dropped and the payload then
        # reported inactive — so the only thing the save accomplished was to record, about
        # somebody who had declined to let us hold it, that faith is a criterion for them.
        # That is the collection the consent exists to govern, and Open is not a lesser kind of
        # it: it is still processing special-category data to rank and to explain.
        if not has_consent(db, member.id, "special_category"):
            raise ApiError("FORBIDDEN", "Using faith for matching needs your explicit sensitive-data consent.", extra={"consent_required": "special_category"})
    pref = db.execute(select(Preference).where(Preference.member_id == member.id, Preference.key == key)).scalar_one_or_none()
    if pref is None:
        pref = Preference(member_id=member.id, key=key, tier=tier, operator=pdef.operator, value=value)
        db.add(pref)
    else:
        pref.tier, pref.value = tier, value
    pref.updated_at = utcnow()
    return pref


def current_payload(db: Session, member: Member) -> dict[str, Any]:
    from app.modules.account.service import has_consent

    sensitive_ok = has_consent(db, member.id, "special_category")
    version = db.execute(select(BlueprintVersion).where(BlueprintVersion.member_id == member.id, BlueprintVersion.status == "confirmed")).scalar_one_or_none()
    signals = []
    if version:
        for s in db.execute(select(BlueprintSignal).where(BlueprintSignal.blueprint_version_id == version.id)).scalars():
            sig = SIGNALS[s.key]
            signals.append({"key": s.key, "category": sig.category, "label": sig.label, "value": s.normalized_value.get("value"), "value_label": sig.options.get(s.normalized_value.get("value"), ""), "confidence": s.confidence, "evidence": (s.evidence_refs or [{}])[0].get("text"), "member_corrected": s.member_corrected, "freshness_at": iso(s.freshness_at), "special_category": sig.special_category, "correctable": sensitive_ok or not sig.special_category, "options": [{"value": v, "label": l} for v, l in sig.options.items()]})
    from app.core.config import get_settings

    settings = get_settings()
    age_days = (utcnow() - version.confirmed_at).days if version and version.confirmed_at else None
    coverage = {cat: len([s for s in signals if s["category"] == cat]) for cat in ("life_plan", "daily", "values", "interaction", "readiness")}
    # Signals the member has never answered. They are absent from `signals` because only
    # persisted rows are serialised, which left no way to supply one: the correction form could
    # offer only values that already existed, so the gap the matcher complained about was the
    # one thing the member could not fill. Kept separate from `signals` so neither `coverage`
    # nor the Blueprint screen changes meaning.
    answered = {s["key"] for s in signals}
    # A special-category signal is only offered to a member who has consented to that category.
    # Listing it unconditionally invited sensitive data from somebody who had declined or
    # withdrawn consent — `correct_signal` refuses it, and offering a control that is going to be
    # refused is its own kind of wrong.
    #
    # An already-answered one stays in `signals`, because a member is entitled to see what we
    # hold about them even after withdrawing consent to collect more. But it carries
    # `correctable: false`, because the same refusal applies to changing it: without the flag,
    # filtering only `unanswered` left the answered row selectable and the 403 was guaranteed.
    unanswered = [
        {
            "key": sig.key,
            "category": sig.category,
            "label": sig.label,
            "special_category": sig.special_category,
            "options": [{"value": v, "label": l} for v, l in sig.options.items()],
        }
        for sig in SIGNALS.values()
        if sig.key not in answered and (sensitive_ok or not sig.special_category)
    ]
    return {
        "version": {"id": version.id, "version_no": version.version_no, "confirmed_at": iso(version.confirmed_at), "model_version": version.model_version} if version else None,
        "signals": signals,
        "unanswered": unanswered,
        "preferences": preferences_payload(db, member)["preferences"],
        "coverage": coverage,
        "freshness": {"age_days": age_days, "stale": bool(age_days is not None and age_days > settings.blueprint_freshness_days), "refresh_after_days": settings.blueprint_freshness_days},
        "data_use": "Blueprint signals are matching-only. They are never shown publicly and never inferred from photos, biometrics, private messages or safety reports.",
    }


def preferences_payload(db: Session, member: Member) -> dict[str, Any]:
    from app.modules.account.service import has_consent
    from app.modules.matching.snapshot import is_sensitive_preference

    # A faith preference set while consented stays in the database after the consent is
    # withdrawn — correctly, so granting it again restores the member's own setting — but the
    # matcher stops applying it, because build_snapshot drops it. Reporting it with its tier and
    # nothing else told the member a Must criterion was still gating introductions while they
    # were being shown people it excludes. `active` is the one word that makes the row honest.
    sensitive_ok = has_consent(db, member.id, "special_category")
    rows = db.execute(select(Preference).where(Preference.member_id == member.id)).scalars().all()
    out = []
    for p in rows:
        pdef = PREFERENCES[p.key]
        options = [{"value": v, "label": l} for v, l in SIGNALS[pdef.target].options.items()] if pdef.target in SIGNALS else None
        # Exactly build_snapshot's rule, with no tier condition: it drops a sensitive preference
        # at every tier, Open included, because processing special-category data to rank or to
        # explain a match needs the same consent either way. Excusing Open here would have told
        # the member a criterion was in use that the matcher never sees.
        inactive = not sensitive_ok and is_sensitive_preference(p.key)
        out.append(
            {
                "id": p.id,
                "key": p.key,
                "label": pdef.label,
                "description": pdef.description,
                "tier": p.tier,
                "operator": p.operator,
                "value": p.value,
                "options": options,
                "active": not inactive,
                "inactive_reason": "special_category_consent_withdrawn" if inactive else None,
                "updated_at": iso(p.updated_at),
            }
        )
    known = {p["key"] for p in out}
    # And nothing offered that upsert_preference will refuse: a control whose one outcome is a
    # 403 is its own kind of wrong, the same reasoning as `unanswered` on the Blueprint payload.
    catalog = [
        {"key": k, "label": d.label, "description": d.description, "default_tier": d.default_tier, "operator": d.operator, "options": [{"value": v, "label": l} for v, l in SIGNALS[d.target].options.items()] if d.target in SIGNALS else None}
        for k, d in PREFERENCES.items()
        if k not in known and (sensitive_ok or not is_sensitive_preference(k))
    ]
    return {"preferences": out, "available": catalog, "tier_meaning": {"must": "Hard gate. Never relaxed without you.", "prefer": "Weighted in ranking.", "open": "Used lightly; mostly for explanations."}}


def impact_preview(db: Session, member: Member, key: str, tier: str, value: dict[str, Any]) -> dict[str, Any]:
    """Estimate how many verified, active, reciprocal members would remain eligible if this preference were saved."""
    from app.modules.matching.eligibility import candidate_pool, passes_hard_gate

    from app.modules.account.service import has_consent
    from app.modules.matching.snapshot import is_sensitive_preference

    # The same consent rule as build_snapshot. `prefs_a` overrides the snapshot's own filtered
    # list, so passing the raw rows counted a faith gate the real batches ignore: the preview
    # said "12 people" where matching would offer more, and the member was comparing a
    # hypothetical against a baseline that does not exist.
    sensitive_ok = has_consent(db, member.id, "special_category")

    def enforced(pref: Preference) -> bool:
        return sensitive_ok or not is_sensitive_preference(pref.key)

    # upsert_preference refuses this save outright at every tier, so previewing a number for it
    # would be a preview of a 403.
    if not sensitive_ok and is_sensitive_preference(key):
        raise ApiError(
            "FORBIDDEN",
            "Using faith for matching needs your explicit sensitive-data consent.",
            extra={"consent_required": "special_category"},
        )

    pool = candidate_pool(db, member)
    current_count = 0
    new_count = 0
    prefs = {p.key: p for p in db.execute(select(Preference).where(Preference.member_id == member.id)).scalars() if enforced(p)}
    from app.models.blueprint import Preference as P

    hypothetical = {**prefs}
    candidate = P(member_id=member.id, key=key, tier=tier, operator=PREFERENCES[key].operator, value=value)
    if enforced(candidate):
        hypothetical[key] = candidate
    for other in pool:
        if passes_hard_gate(db, member, other, prefs_a=list(prefs.values())):
            current_count += 1
        if passes_hard_gate(db, member, other, prefs_a=list(hypothetical.values())):
            new_count += 1
    return {"key": key, "tier": tier, "eligible_now": current_count, "eligible_after": new_count, "pool_size": len(pool), "message": "Estimates use the verified active pool after both sides' Must criteria. Safety and core values are yours to keep; we only show the trade-off."}
