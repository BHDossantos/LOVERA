"""Canonical Dating Blueprint signals and partner preferences.

Every matching feature is a member-confirmed structured signal. Nothing here is inferred from photos,
biometrics, private messages, or safety reports.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Signal:
    key: str
    category: str  # life_plan | daily | values | interaction | logistics | readiness
    label: str
    options: dict[str, str]  # value -> label
    similarity_weight: float = 0.0  # symmetric similarity contribution when both members share this signal
    special_category: bool = False  # requires explicit consent; declared only; never inferred
    synonyms: dict[str, tuple[str, ...]] = field(default_factory=dict)


SIGNALS: dict[str, Signal] = {
    s.key: s
    for s in [
        Signal(
            "life_plan.children",
            "life_plan",
            "Children",
            {
                "want": "Want children",
                "open": "Open to children",
                "no": "Do not want children",
                "have_and_open": "Have children and open to more",
                "have_and_done": "Have children and done",
            },
            synonyms={"want": ("want kids", "want children", "definitely want"), "no": ("don't want kids", "no kids", "childfree", "child-free"), "open": ("open to kids", "not sure", "maybe kids")},
        ),
        Signal("life_plan.marriage", "life_plan", "Marriage", {"important": "Important to me", "open": "Open to it", "not_important": "Not important"}, synonyms={"important": ("want to get married", "marriage matters"), "not_important": ("don't need marriage", "marriage isn't important")}),
        Signal("life_plan.relationship_structure", "life_plan", "Relationship structure", {"monogamous": "Monogamous", "open_to_discuss": "Open to discussing structure"}, synonyms={"monogamous": ("monogamy", "exclusive", "monogamous")}),
        Signal("life_plan.relocation", "life_plan", "Relocation", {"open": "Open to relocating", "maybe": "Maybe, for the right reasons", "no": "Not relocating"}, synonyms={"open": ("would move", "happy to relocate"), "no": ("won't move", "staying put", "not moving")}),
        Signal("daily.social_rhythm", "daily", "Social rhythm", {"homebody": "Mostly home and close friends", "balanced": "A mix of home and out", "social": "Out and social most weeks"}, 1.0, synonyms={"homebody": ("homebody", "stay in", "quiet night", "cozy"), "social": ("go out", "party", "very social", "out most nights"), "balanced": ("mix", "balance", "depends")}),
        Signal("daily.weekend_energy", "daily", "Weekend energy", {"calm": "Calm and slow", "mixed": "A bit of both", "active": "Active and full"}, 0.8, synonyms={"calm": ("slow morning", "relax", "lazy", "calm", "sleep in", "read"), "active": ("hike", "run", "gym", "adventure", "packed", "active"), "mixed": ("bit of both", "mix")}),
        Signal("daily.sleep", "daily", "Sleep rhythm", {"early": "Early riser", "flexible": "Flexible", "night": "Night owl"}, 0.4, synonyms={"early": ("early riser", "morning person", "up early"), "night": ("night owl", "late night", "stay up")}),
        Signal("daily.health_lifestyle", "daily", "Health and movement", {"active": "Very active", "moderate": "Moderately active", "relaxed": "Relaxed about it"}, 0.6, synonyms={"active": ("train", "gym", "run", "cycle", "very active", "sport"), "relaxed": ("not sporty", "relaxed", "don't exercise")}),
        Signal("daily.pets", "daily", "Pets", {"has": "Have pets", "wants": "Want pets", "none": "No pets, fine either way", "allergic": "Allergic or prefer none"}, 0.3, synonyms={"has": ("my dog", "my cat", "have a dog", "have a cat"), "allergic": ("allergic",), "wants": ("want a dog", "want a cat")}),
        Signal("daily.smoking", "daily", "Smoking", {"never": "Never", "socially": "Socially", "regularly": "Regularly"}, synonyms={"never": ("don't smoke", "non-smoker", "never smoke"), "socially": ("social smoker", "sometimes smoke"), "regularly": ("smoke daily", "smoker")}),
        Signal("daily.drinking", "daily", "Drinking", {"never": "Never", "socially": "Socially", "regularly": "Regularly"}, 0.4, synonyms={"never": ("don't drink", "sober", "teetotal"), "socially": ("social drinker", "wine with dinner", "occasionally"), "regularly": ("drink most days",)}),
        Signal("values.family_closeness", "values", "Family closeness", {"very_close": "Very close, weekly", "close": "Close, monthly", "independent": "Independent"}, 0.7, synonyms={"very_close": ("every week", "sunday lunch", "very close"), "independent": ("independent", "rarely see", "not close")}),
        Signal("values.money_style", "values", "Money style", {"saver": "Saver", "balanced": "Balanced", "spender": "Enjoys spending"}, 0.5, synonyms={"saver": ("save", "invest", "careful"), "spender": ("spend", "treat", "enjoy it")}),
        Signal("values.career_drive", "values", "Career drive", {"ambitious": "Ambitious", "balanced": "Balanced", "relaxed": "Work is not central"}, 0.5, synonyms={"ambitious": ("ambitious", "career first", "big goals"), "relaxed": ("work-life balance", "not central", "not ambitious")}),
        Signal("values.faith_importance", "values", "Faith in daily life", {"central": "Central", "some": "Some importance", "none": "Not part of my life"}, 0.6, special_category=True),
        Signal("interaction.communication_pace", "interaction", "Contact between dates", {"daily": "Daily check-ins", "few_times_week": "A few times a week", "flexible": "Flexible"}, 0.7, synonyms={"daily": ("every day", "daily", "good morning text"), "few_times_week": ("few times a week", "couple of times"), "flexible": ("flexible", "no rules")}),
        Signal("interaction.conflict_repair", "interaction", "Repair after conflict", {"talk_now": "Talk it through right away", "cool_off_then_talk": "Cool off, then talk", "avoid": "Let it pass"}, 0.9, synonyms={"talk_now": ("talk right away", "resolve immediately", "talk it out now"), "cool_off_then_talk": ("cool off", "space then talk", "sleep on it"), "avoid": ("let it go", "move on", "avoid")}),
        Signal("interaction.affection", "interaction", "Affection", {"high": "Very affectionate", "moderate": "Moderately affectionate", "reserved": "Reserved"}, 0.6, synonyms={"high": ("very affectionate", "touchy", "lots of affection"), "reserved": ("reserved", "private", "not touchy")}),
        Signal("interaction.planning_style", "interaction", "Planning style", {"planner": "Planner", "mixed": "Mixed", "spontaneous": "Spontaneous"}, 0.8, synonyms={"planner": ("plan ahead", "calendar", "planner"), "spontaneous": ("spontaneous", "last minute", "wing it")}),
        Signal("readiness.meet_within_days", "readiness", "Ready to meet", {"7": "Within a week", "14": "Within two weeks", "30": "Within a month"}, synonyms={"7": ("this week", "soon"), "14": ("two weeks", "couple of weeks")}),
    ]
}

CATEGORIES = ("life_plan", "daily", "values", "interaction", "logistics", "readiness")


@dataclass(frozen=True)
class PreferenceDef:
    key: str
    label: str
    target: str  # signal key, or "member.age" | "member.distance" | "profile.languages"
    default_tier: str
    operator: str  # in | range | any_of
    description: str


PREFERENCES: dict[str, PreferenceDef] = {
    p.key: p
    for p in [
        PreferenceDef("age_range", "Age range", "member.age", "must", "range", "Ages you would date."),
        PreferenceDef("distance_km", "Distance", "member.distance", "must", "range", "How far is realistic for regular dates."),
        PreferenceDef("children", "Children plans", "life_plan.children", "must", "in", "Partner's children plans you can build a life with."),
        PreferenceDef("relationship_structure", "Relationship structure", "life_plan.relationship_structure", "must", "in", "Structure you want."),
        PreferenceDef("marriage", "Marriage", "life_plan.marriage", "prefer", "in", "How the partner sees marriage."),
        PreferenceDef("relocation", "Relocation", "life_plan.relocation", "open", "in", "Openness to relocating."),
        PreferenceDef("smoking", "Smoking", "daily.smoking", "prefer", "in", "Smoking habits you accept."),
        PreferenceDef("drinking", "Drinking", "daily.drinking", "open", "in", "Drinking habits you accept."),
        PreferenceDef("faith_importance", "Faith", "values.faith_importance", "open", "in", "How faith features in a partner's life. Only used if you set it."),
        PreferenceDef("languages", "Shared language", "profile.languages", "prefer", "any_of", "Languages you want to share."),
        PreferenceDef("social_rhythm", "Social rhythm", "daily.social_rhythm", "open", "in", "Social pace that fits yours."),
        PreferenceDef("planning_style", "Planning style", "interaction.planning_style", "open", "in", "Planning style that fits yours."),
    ]
}

TIER_WEIGHTS = {"must": 0.0, "prefer": 1.0, "open": 0.35}
