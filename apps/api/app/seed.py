"""Seed a synthetic, verified pilot cohort so the concierge console and the member journey have inventory.

python -m app.seed [--run-batch]
"""
from __future__ import annotations

import random
import sys
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import session_factory
from app.core.timeutil import utcnow
from app.main import create_schema
from app.models.account import Member, ConsentRecord
from app.models.availability import AvailabilityVersion
from app.models.blueprint import BlueprintSignal, BlueprintVersion, Preference
from app.models.profile import Profile
from app.models.verification import Verification
from app.catalog.cities import zones_for_city
from app.catalog.signals import PREFERENCES, SIGNALS
from app.modules.dates.venues import seed_venues
import hashlib

FIRST = {
    "woman": ["Giulia", "Sara", "Chiara", "Elena", "Martina", "Francesca", "Laura", "Alessia", "Beatrice", "Valentina", "Noor", "Amira", "Sofía", "Lucía", "Inés"],
    "man": ["Marco", "Luca", "Andrea", "Matteo", "Davide", "Lorenzo", "Alessandro", "Simone", "Tommaso", "Federico", "Karim", "Diego", "Pablo", "Joao", "Nikhil"],
    "non_binary": ["Ari", "Sam", "Alex", "Noa", "Kai"],
}
BIOS = [
    "Architect who cooks too much on Sundays. Looking for someone to build a calm, honest life with.",
    "Teacher, runner, terrible at karaoke and unbothered by it. I want the real thing, not a pen pal.",
    "Product manager by day, ceramics by night. Family matters to me and so does having my own space.",
    "Doctor with an irregular schedule and a very regular coffee habit. I'm ready for something serious.",
    "Translator between three languages and two cities. Slow mornings, long walks, direct conversations.",
    "Engineer who plans trips in spreadsheets and then abandons them. Looking for a partner, not a project.",
]
PROMPTS = [
    ("second_date", ["A long walk that ends somewhere with good bread.", "A market, then cooking what we bought.", "Something neither of us has done before."]),
    ("ordinary_tuesday", ["Gym, a call with my sister, pasta, an episode of something.", "Late at the office, then a bike ride home along the river.", "Cooking with a podcast on and my cat judging me."]),
    ("repair", ["say what I felt, then listen properly.", "need an hour, then I come back and talk.", "make tea and start with the easy part."]),
]


def seed(n: int = 30, run_batch: bool = False) -> None:
    create_schema()
    db: Session = session_factory()()
    try:
        seed_venues(db)
        if db.execute(select(Member).where(Member.email.like("seed-%@example.test")).limit(1)).first():
            print("seed cohort already present")
        else:
            rng = random.Random(42)
            zones = zones_for_city("rome")
            for i in range(n):
                gender = "woman" if i % 2 == 0 else "man"
                if i % 10 == 9:
                    gender = "non_binary"
                seeking = {"woman": ["man"], "man": ["woman"], "non_binary": ["non_binary", "woman", "man"]}[gender]
                if i % 7 == 6:
                    seeking = [gender]  # same-gender seeking members
                name = FIRST[gender][i % len(FIRST[gender])]
                email = f"seed-{i:02d}@example.test"
                zone = rng.choice(zones)
                m = Member(email=email, email_hash=hashlib.sha256(email.encode()).hexdigest(), status="active", onboarding_step="done", birth_date=date(rng.randint(1981, 1998), rng.randint(1, 12), rng.randint(1, 28)), locale=rng.choice(["en", "it"]), timezone="Europe/Rome", market_id="rome", home_city_id="rome", home_zone_id=zone.id, gender=gender, seeking=seeking, intent=rng.choice(["long_term", "life_partner"]), max_distance_km=rng.choice([15, 25, 40]), date_ready=True, roles=["member"], last_active_at=utcnow())
                db.add(m)
                db.flush()
                for purpose in ("terms", "privacy", "community", "ai_processing"):
                    db.add(ConsentRecord(member_id=m.id, purpose=purpose, policy_version="2026-09", status="granted", granted_at=utcnow(), source="seed"))
                db.add(Verification(member_id=m.id, provider="sandbox", provider_ref=f"seed_{i:02d}", status="verified", age_over_18=True, liveness_passed=True, country_code="IT", verified_at=utcnow(), expires_at=utcnow() + timedelta(days=365)))
                langs = rng.choice([["it", "en"], ["en"], ["it"], ["en", "es"], ["it", "en", "pt"]])
                db.add(Profile(member_id=m.id, display_name=name, occupation=rng.choice(["Architect", "Teacher", "Product manager", "Doctor", "Translator", "Engineer", "Chef", "Lawyer", "Designer"]), bio=rng.choice(BIOS), languages=langs, prompts=[{"key": k, "answer": rng.choice(v)} for k, v in PROMPTS[:2]], completeness=75, version=2, updated_at=utcnow()))
                version = BlueprintVersion(member_id=m.id, version_no=1, status="confirmed", model_version="seed", confirmed_at=utcnow() - timedelta(days=rng.randint(1, 60)))
                db.add(version)
                db.flush()
                children = rng.choice(["want", "open", "no", "have_and_open"])
                for key, sig in SIGNALS.items():
                    if sig.special_category:
                        continue
                    value = children if key == "life_plan.children" else rng.choice(list(sig.options))
                    if key == "life_plan.relationship_structure":
                        value = "monogamous" if rng.random() < 0.9 else "open_to_discuss"
                    if key == "daily.smoking":
                        value = rng.choice(["never", "never", "never", "socially"])
                    db.add(BlueprintSignal(blueprint_version_id=version.id, category=sig.category, key=key, normalized_value={"value": value}, confidence=rng.choice(["strong", "strong", "promising"]), evidence_refs=[{"text": "seed"}], freshness_at=utcnow()))
                age = (utcnow().date() - m.birth_date).days // 365
                prefs = {
                    "age_range": ("must", {"min": max(18, age - 8), "max": age + 8}),
                    "distance_km": ("must", {"max": m.max_distance_km}),
                    "children": ("must" if rng.random() < 0.6 else "prefer", {"in": {"want": ["want", "open"], "open": ["want", "open", "no", "have_and_open"], "no": ["no", "open"], "have_and_open": ["want", "open", "have_and_open"]}[children]}),
                    "relationship_structure": ("must", {"in": ["monogamous"]}),
                    "smoking": ("prefer", {"in": ["never", "socially"]}),
                    "marriage": ("open", {"in": ["important", "open", "not_important"]}),
                    "languages": ("prefer", {"any_of": langs}),
                }
                for key, (tier, value) in prefs.items():
                    db.add(Preference(member_id=m.id, key=key, tier=tier, operator=PREFERENCES[key].operator, value=value, updated_at=utcnow()))
                windows = rng.sample([{"weekday": 1, "start": "18:30", "end": "22:00"}, {"weekday": 3, "start": "18:00", "end": "22:00"}, {"weekday": 4, "start": "19:00", "end": "23:00"}, {"weekday": 5, "start": "10:00", "end": "16:00"}, {"weekday": 6, "start": "11:00", "end": "18:00"}], k=3)
                db.add(AvailabilityVersion(member_id=m.id, timezone="Europe/Rome", recurring_windows=windows, date_styles=rng.sample(["coffee", "walk", "drinks", "dinner", "culture"], k=2)))
            db.commit()
            print(f"seeded {n} verified members in rome")
        if run_batch:
            from app.modules.matching.service import run_batch as _run, run_payload

            run = _run(db, "rome", auto_publish=True)
            db.commit()
            print(run_payload(run))
    finally:
        db.close()


if __name__ == "__main__":
    seed(run_batch="--run-batch" in sys.argv)
