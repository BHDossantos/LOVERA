"""Adaptive interview bank. Non-negotiables first, then scenarios ordered by information value."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Question:
    key: str
    phase: str  # non_negotiable | scenario
    category: str
    prompt: str
    help: str
    input: str  # choice | choice_or_text | range | number | multi_choice
    signal_key: str | None = None  # signal about the member
    preference_key: str | None = None  # partner preference collected alongside
    options: list[tuple[str, str]] = field(default_factory=list)  # (value, label)
    priority: int = 50
    skippable: bool = False
    special_category: bool = False
    tier_choice: bool = False  # ask Must / Prefer / Open for the partner preference


QUESTIONS: list[Question] = [
    Question(
        "children",
        "non_negotiable",
        "life_plan",
        "Where do you stand on children?",
        "This is one of the few things we treat as a hard gate when you tell us to. Your answer is used for matching only.",
        "choice",
        signal_key="life_plan.children",
        preference_key="children",
        options=[("want", "I want children"), ("open", "I'm open to children"), ("no", "I don't want children"), ("have_and_open", "I have children and I'm open to more"), ("have_and_done", "I have children and my family is complete")],
        priority=100,
        tier_choice=True,
    ),
    Question(
        "relationship_structure",
        "non_negotiable",
        "life_plan",
        "What relationship structure are you looking for?",
        "Matching only. We never relax a Must without you.",
        "choice",
        signal_key="life_plan.relationship_structure",
        preference_key="relationship_structure",
        options=[("monogamous", "Monogamous"), ("open_to_discuss", "Open to discussing structure")],
        priority=99,
        tier_choice=True,
    ),
    Question(
        "age_range",
        "non_negotiable",
        "logistics",
        "What age range feels right for a partner?",
        "A Must by default. You can loosen it later and see how it changes your inventory.",
        "range",
        preference_key="age_range",
        priority=98,
    ),
    Question(
        "distance",
        "non_negotiable",
        "logistics",
        "How far is realistic for regular dates?",
        "We only ever use your zone, never an exact location.",
        "number",
        preference_key="distance_km",
        priority=97,
    ),
    Question(
        "marriage",
        "non_negotiable",
        "life_plan",
        "How do you feel about marriage?",
        "Matching only.",
        "choice",
        signal_key="life_plan.marriage",
        preference_key="marriage",
        options=[("important", "Important to me"), ("open", "Open to it"), ("not_important", "Not important to me")],
        priority=96,
        tier_choice=True,
    ),
    Question(
        "smoking",
        "non_negotiable",
        "daily",
        "Do you smoke?",
        "Matching only.",
        "choice",
        signal_key="daily.smoking",
        preference_key="smoking",
        options=[("never", "Never"), ("socially", "Socially"), ("regularly", "Regularly")],
        priority=95,
        tier_choice=True,
    ),
    Question(
        "relocation",
        "non_negotiable",
        "life_plan",
        "Would you relocate for the right relationship?",
        "Matching only.",
        "choice",
        signal_key="life_plan.relocation",
        preference_key="relocation",
        options=[("open", "Yes, I'm open to it"), ("maybe", "Maybe, for the right reasons"), ("no", "No, my life is here")],
        priority=94,
        tier_choice=True,
    ),
    Question(
        "faith",
        "non_negotiable",
        "values",
        "Optional: how much does faith feature in your daily life?",
        "This is sensitive information. Answer only if you want it used for matching. You can skip.",
        "choice",
        signal_key="values.faith_importance",
        preference_key="faith_importance",
        options=[("central", "Central"), ("some", "Some importance"), ("none", "Not part of my life")],
        priority=90,
        skippable=True,
        special_category=True,
        tier_choice=True,
    ),
    Question(
        "weekend",
        "scenario",
        "daily",
        "It's Saturday morning and nothing is planned. Walk me through your ideal day.",
        "Answer naturally. We'll turn it into a couple of signals you can correct.",
        "choice_or_text",
        signal_key="daily.weekend_energy",
        options=[("calm", "Slow: coffee, a book, a long lunch"), ("mixed", "A bit of both"), ("active", "Full: a hike, a market, friends, something new")],
        priority=80,
    ),
    Question(
        "weeknight_party",
        "scenario",
        "daily",
        "A friend invites you to a big party on a Wednesday. What do you do?",
        "This tells us about your social rhythm, not whether you're fun.",
        "choice_or_text",
        signal_key="daily.social_rhythm",
        options=[("homebody", "Politely pass; I keep weeknights quiet"), ("balanced", "Depends on the week and who's going"), ("social", "I'm there; I like being out")],
        priority=79,
    ),
    Question(
        "conflict",
        "scenario",
        "interaction",
        "You and a partner had a tense disagreement over dinner. What happens next for you?",
        "There is no right answer. Knowing how each of you repairs helps.",
        "choice_or_text",
        signal_key="interaction.conflict_repair",
        options=[("talk_now", "I want to talk it through right away"), ("cool_off_then_talk", "I need some space, then I come back to it"), ("avoid", "I tend to let it pass")],
        priority=78,
    ),
    Question(
        "contact",
        "scenario",
        "interaction",
        "In the first weeks, how much contact between dates feels right?",
        "Mismatched pace is one of the most common early frictions.",
        "choice_or_text",
        signal_key="interaction.communication_pace",
        options=[("daily", "A daily check-in"), ("few_times_week", "A few times a week"), ("flexible", "Flexible, no rules")],
        priority=77,
    ),
    Question(
        "spontaneous_trip",
        "scenario",
        "interaction",
        "A partner suggests a spontaneous weekend trip, leaving tomorrow. Honest reaction?",
        "Planning style.",
        "choice_or_text",
        signal_key="interaction.planning_style",
        options=[("planner", "I'd love it planned a bit further ahead"), ("mixed", "Depends what's on my calendar"), ("spontaneous", "Bags packed already")],
        priority=76,
    ),
    Question(
        "affection",
        "scenario",
        "interaction",
        "How do you tend to show that you care?",
        "Affection style.",
        "choice_or_text",
        signal_key="interaction.affection",
        options=[("high", "Very affectionate and expressive"), ("moderate", "Warm, in a measured way"), ("reserved", "Reserved; I show it through actions")],
        priority=75,
    ),
    Question(
        "family",
        "scenario",
        "values",
        "How present is your family in a normal week?",
        "Family closeness.",
        "choice_or_text",
        signal_key="values.family_closeness",
        options=[("very_close", "Very present; we see each other weekly"), ("close", "Close; we talk often and meet monthly"), ("independent", "Independent; we're close in our own way")],
        priority=74,
    ),
    Question(
        "movement",
        "scenario",
        "daily",
        "Describe a typical week of movement, food, and rest.",
        "Health lifestyle.",
        "choice_or_text",
        signal_key="daily.health_lifestyle",
        options=[("active", "Training most days"), ("moderate", "Some sport, mostly balanced"), ("relaxed", "Relaxed about it")],
        priority=73,
    ),
    Question(
        "bonus",
        "scenario",
        "values",
        "An unexpected bonus lands in your account. What happens to it?",
        "Money style.",
        "choice_or_text",
        signal_key="values.money_style",
        options=[("saver", "Mostly saved or invested"), ("balanced", "Some saved, some enjoyed"), ("spender", "A trip or something I've wanted")],
        priority=72,
    ),
    Question(
        "career",
        "scenario",
        "values",
        "How central is work to your next five years?",
        "Career drive.",
        "choice_or_text",
        signal_key="values.career_drive",
        options=[("ambitious", "Very central; I have big goals"), ("balanced", "Important, but balanced"), ("relaxed", "Work is not the centre")],
        priority=71,
    ),
    Question(
        "drinking",
        "scenario",
        "daily",
        "Where does alcohol fit in your life?",
        "Drinking.",
        "choice",
        signal_key="daily.drinking",
        preference_key="drinking",
        options=[("never", "I don't drink"), ("socially", "Socially"), ("regularly", "Regularly")],
        priority=70,
        tier_choice=True,
    ),
    Question(
        "pets",
        "scenario",
        "daily",
        "Pets?",
        "Pets.",
        "choice",
        signal_key="daily.pets",
        options=[("has", "I have pets"), ("wants", "I'd like pets"), ("none", "None, fine either way"), ("allergic", "Allergic or prefer none")],
        priority=60,
    ),
    Question(
        "sleep",
        "scenario",
        "daily",
        "Early riser or night owl?",
        "Sleep rhythm.",
        "choice",
        signal_key="daily.sleep",
        options=[("early", "Early riser"), ("flexible", "Flexible"), ("night", "Night owl")],
        priority=59,
    ),
    Question(
        "readiness",
        "scenario",
        "readiness",
        "Realistically, when could you meet someone for a first date?",
        "We only introduce people who can actually meet.",
        "choice",
        signal_key="readiness.meet_within_days",
        options=[("7", "Within a week"), ("14", "Within two weeks"), ("30", "Within a month")],
        priority=58,
    ),
]

QUESTION_BY_KEY = {q.key: q for q in QUESTIONS}
MIN_SCENARIOS_FOR_REVIEW = 6
MAX_SCENARIOS = 10


def next_question(answered_keys: set[str], skipped_keys: set[str]) -> Question | None:
    done = answered_keys | skipped_keys
    remaining = [q for q in QUESTIONS if q.key not in done]
    non_neg = [q for q in remaining if q.phase == "non_negotiable"]
    if non_neg:
        return sorted(non_neg, key=lambda q: -q.priority)[0]
    scenarios_answered = len([k for k in answered_keys if QUESTION_BY_KEY[k].phase == "scenario"])
    if scenarios_answered >= MAX_SCENARIOS:
        return None
    scenarios = [q for q in remaining if q.phase == "scenario"]
    if not scenarios:
        return None
    return sorted(scenarios, key=lambda q: -q.priority)[0]


def review_ready(answered_keys: set[str]) -> bool:
    scenarios_answered = len([k for k in answered_keys if k in QUESTION_BY_KEY and QUESTION_BY_KEY[k].phase == "scenario"])
    non_neg_needed = {q.key for q in QUESTIONS if q.phase == "non_negotiable" and not q.skippable}
    return non_neg_needed.issubset(answered_keys) and scenarios_answered >= MIN_SCENARIOS_FOR_REVIEW
