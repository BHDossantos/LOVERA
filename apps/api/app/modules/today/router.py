"""T01 Today: one prioritized task ranked by member outcome, never engagement minutes."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import Principal, current_principal
from app.core.timeutil import iso, utcnow
from app.models.conversations import Conversation
from app.models.dates import DatePlan, PostDateFeedback
from app.models.introductions import IntroDecision, Introduction
from app.modules.account.service import me_payload
from app.modules.billing.service import entitlements_for
from app.modules.blueprint.service import current_payload
from app.modules.introductions.service import expire_due

router = APIRouter(prefix="/today", tags=["today"])


@router.get("")
def today(principal: Principal = Depends(current_principal), db: Session = Depends(get_db, scope="function")) -> dict:
    m = principal.member
    expire_due(db)
    tasks: list[dict[str, Any]] = []
    me = me_payload(db, m)
    if m.status in ("pending_consent", "pending_verification", "onboarding"):
        tasks.append({"key": "onboarding", "priority": 100, "title": "Finish setting up", "body": "Your matchmaker needs a confirmed Blueprint before the first introduction.", "path": f"/onboarding/{m.onboarding_step if m.onboarding_step != 'blueprint' else 'blueprint/interview'}", "cta": "Continue setup"})
    if m.status == "restricted":
        tasks.append({"key": "review", "priority": 100, "title": "Your account is under review", "body": "You can read the decision, add context and appeal.", "path": "/account/review", "cta": "Open account review"})
    now = utcnow()
    my_id = m.id
    for intro in db.execute(select(Introduction).where(or_(Introduction.member_a_id == my_id, Introduction.member_b_id == my_id), Introduction.status == "offered")).scalars():
        decided = db.execute(select(IntroDecision.id).where(IntroDecision.introduction_id == intro.id, IntroDecision.member_id == my_id)).first()
        if not decided:
            hours_left = max(0, int((intro.expires_at - now).total_seconds() // 3600)) if intro.expires_at else None
            tasks.append({"key": f"intro:{intro.id}", "priority": 90, "title": "An introduction is waiting for your private decision", "body": f"Open the evidence, then say yes or pass. {hours_left} hours left; one extension available." if hours_left is not None else "Open the evidence, then say yes or pass.", "path": f"/introductions/{intro.id}", "cta": "Open the introduction", "deadline": iso(intro.expires_at)})
    for plan in db.execute(select(DatePlan).where(or_(DatePlan.member_a_id == my_id, DatePlan.member_b_id == my_id), DatePlan.status.in_(("proposed", "countered", "confirmed", "completed", "no_show")))).scalars():
        if plan.status in ("proposed", "countered") and my_id not in (plan.confirmations or []):
            tasks.append({"key": f"date_confirm:{plan.id}", "priority": 88, "title": "Confirm a proposed date", "body": f"{plan.venue_snapshot.get('name', 'A public venue')} was proposed. Confirm or suggest another time.", "path": f"/dates/{plan.id}", "cta": "Review the plan"})
        elif plan.status == "confirmed" and plan.starts_at and plan.starts_at > now:
            tasks.append({"key": f"date_upcoming:{plan.id}", "priority": 70, "title": "Upcoming date", "body": f"{plan.venue_snapshot.get('name', 'Public venue')} · {plan.starts_at.astimezone().strftime('%a %d %b %H:%M')}. Set up a check-in if you'd like.", "path": f"/dates/{plan.id}", "cta": "See details"})
        elif plan.starts_at and plan.starts_at <= now and plan.status in ("confirmed", "completed", "no_show"):
            fb = db.execute(select(PostDateFeedback.id).where(PostDateFeedback.date_plan_id == plan.id, PostDateFeedback.member_id == my_id)).first()
            if not fb:
                tasks.append({"key": f"feedback:{plan.id}", "priority": 85, "title": "Twenty seconds of private feedback", "body": "Did the date happen, did you feel respected, and would you like a second one? Only a mutual yes is ever revealed.", "path": f"/dates/{plan.id}/feedback", "cta": "Answer privately"})
    convs = db.execute(select(Conversation).where(or_(Conversation.member_a_id == my_id, Conversation.member_b_id == my_id), Conversation.status == "active")).scalars().all()
    for c in convs:
        plan = db.execute(select(DatePlan.id).where(DatePlan.conversation_id == c.id, DatePlan.status.in_(("proposed", "countered", "confirmed")))).first()
        if not plan:
            tasks.append({"key": f"conv:{c.id}", "priority": 60, "title": "Move a conversation toward a real date", "body": "You both said yes. Suggest a public place and a time that overlaps.", "path": f"/messages/{c.id}", "cta": "Open the conversation"})
    bp = current_payload(db, m) if me["blueprint_confirmed"] else None
    if bp and bp["freshness"]["stale"]:
        tasks.append({"key": "blueprint_refresh", "priority": 40, "title": "Your Blueprint is getting stale", "body": "Life changes. A short refresh keeps introductions accurate.", "path": "/you/blueprint", "cta": "Review your Blueprint"})
    if not m.date_ready and m.status == "active":
        tasks.append({"key": "readiness", "priority": 50, "title": "You're marked as not ready to date", "body": "Introductions pause while readiness is off.", "path": "/you/profile", "cta": "Update readiness"})
    ent = entitlements_for(db, m)
    if m.status == "active" and not tasks:
        tasks.append({"key": "waiting", "priority": 10, "title": "Nothing to do right now", "body": "Your next introductions arrive with the weekly batch. Less time in the app is fine.", "path": "/introductions/waiting", "cta": "See why"})
    tasks.sort(key=lambda t: -t["priority"])
    from app.modules.notifications.service import list_for

    unread = len([n for n in list_for(db, my_id, 100) if not n["read_at"]])
    return {"next_action": tasks[0], "tasks": tasks[:5], "readiness": {"date_ready": m.date_ready, "verification": me["verification_status"], "blueprint_fresh": bool(bp and not bp["freshness"]["stale"]), "plan": ent["plan"], "trial_introductions_remaining": ent["trial_introductions_remaining"]}, "introduction_timing": {"cadence": "weekly", "cap": ent["weekly_intro_cap"]}, "unread_notifications": unread, "safety_shortcut": "/safety"}
