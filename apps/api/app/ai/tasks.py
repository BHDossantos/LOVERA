"""Bounded AI tasks with schemas, prompts and deterministic validators."""
from __future__ import annotations

import re
from typing import Any

from app.ai import gateway
from app.ai.gateway import AIUnavailable
from app.catalog.signals import SIGNALS

PROHIBITED_TOPICS = re.compile(
    r"\b(race|ethnic|religio|muslim|christian|jewish|hindu|buddhis|disab|diagnos|mental (health|illness)|depress|anxiet|attractive|ugly|hot|sexy|pregnan|hiv|std|therap|medic)\w*",
    re.IGNORECASE,
)
MANIPULATION = re.compile(
    r"\b(you owe me|if you really cared|don't tell anyone|send (me )?(money|crypto|gift)|wire|bitcoin|whatsapp me|my number is|prove you|you'd be stupid|nobody else will|guilt|beg)\b",
    re.IGNORECASE,
)
CONTACT_OR_ADDRESS = re.compile(r"(\+?\d[\d\s().-]{7,}\d|@[a-z0-9_.]{3,}|\b\d{1,4}\s+(via|calle|carrer|street|rue|st\.)\b)", re.IGNORECASE)


class ValidationFailed(Exception):
    pass


# --- Blueprint extraction --------------------------------------------------
EXTRACT_SCHEMA = {
    "type": "object",
    "properties": {
        "signals": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "key": {"type": "string"},
                    "value": {"type": "string"},
                    "confidence": {"type": "string", "enum": ["strong", "promising", "low_evidence"]},
                    "evidence": {"type": "string"},
                },
                "required": ["key", "value", "confidence", "evidence"],
                "additionalProperties": False,
            },
        },
        "prohibited_inferences_used": {"type": "boolean"},
    },
    "required": ["signals", "prohibited_inferences_used"],
    "additionalProperties": False,
}
EXTRACT_SYSTEM = (
    "You turn a dating-intake answer into structured lifestyle signals. Only use the candidate signal keys and their allowed "
    "values supplied in the input. Quote the member's own words as evidence. Never infer race, ethnicity, religion, health, "
    "disability, sexuality, attractiveness or emotion; set prohibited_inferences_used to true and return no signals if the "
    "answer would require that. Do not invent facts; if unsure, omit the signal or mark it low_evidence."
)


def extract_signals(question_key: str, answer: str, candidate_keys: list[str]) -> tuple[list[dict[str, Any]], str]:
    allowed = {k: list(SIGNALS[k].options.keys()) for k in candidate_keys if k in SIGNALS}
    result = gateway.run(
        "extract_signals",
        EXTRACT_SYSTEM,
        {"question_key": question_key, "answer": answer[:1500], "candidate_signal_keys": candidate_keys, "allowed_values": allowed},
        EXTRACT_SCHEMA,
    )
    data = result.data
    if data.get("prohibited_inferences_used"):
        return [], result.model_version
    clean: list[dict[str, Any]] = []
    for item in data.get("signals", []):
        key, value = item.get("key"), item.get("value")
        if key in allowed and value in allowed[key]:
            clean.append({"key": key, "value": value, "confidence": item.get("confidence", "promising"), "evidence": str(item.get("evidence", ""))[:200]})
    return clean, result.model_version


# --- Drafts ----------------------------------------------------------------
DRAFT_SCHEMA = {
    "type": "object",
    "properties": {"text": {"type": "string"}, "safety_labels": {"type": "array", "items": {"type": "string"}}},
    "required": ["text", "safety_labels"],
    "additionalProperties": False,
}
DRAFT_SYSTEM = (
    "You draft ONE short message (max 60 words) that a dating-app member may edit and send themselves. Ground it only in the "
    "recent messages and shared facts provided. Never invent experiences, never pressure, guilt, sexualise, love-bomb, ask for "
    "money, or suggest moving off the platform. Suggest public places only. Match the requested tone. Return plain text without "
    "quotes or sign-offs."
)


def generate_draft(payload: dict[str, Any]) -> tuple[str, list[str], str]:
    result = gateway.run("draft", DRAFT_SYSTEM, payload, DRAFT_SCHEMA)
    text = str(result.data.get("text", "")).strip()
    labels = validate_draft(text, payload)
    if "rejected" in labels:
        raise ValidationFailed("Draft did not pass the safety validator.")
    return text, labels, result.model_version


def validate_draft(text: str, payload: dict[str, Any]) -> list[str]:
    labels: list[str] = []
    if not text or len(text.split()) > 90:
        labels.append("rejected")
    if MANIPULATION.search(text):
        labels += ["manipulation", "rejected"]
    if CONTACT_OR_ADDRESS.search(text):
        labels += ["contact_sharing", "rejected"]
    if PROHIBITED_TOPICS.search(text):
        labels.append("sensitive_topic")
    return sorted(set(labels))


# --- Translation -----------------------------------------------------------
TRANSLATE_SCHEMA = {
    "type": "object",
    "properties": {"text": {"type": "string"}, "confidence": {"type": "number"}, "low_confidence_note": {"type": ["string", "null"]}},
    "required": ["text", "confidence", "low_confidence_note"],
    "additionalProperties": False,
}
TRANSLATE_SYSTEM = (
    "Translate the message faithfully between the two languages given, preserving tone and meaning. Do not add or remove "
    "content. Report confidence between 0 and 1 and a short note when slang or ambiguity lowers confidence."
)
SUPPORTED_LANGS = ("en", "it", "es", "pt")


def translate(text: str, source_lang: str, target_lang: str) -> tuple[str, float, str | None, str]:
    if source_lang not in SUPPORTED_LANGS or target_lang not in SUPPORTED_LANGS:
        raise ValidationFailed("Only EN, IT, ES and PT are supported in the pilot.")
    result = gateway.run("translate", TRANSLATE_SYSTEM, {"text": text[:2000], "source_lang": source_lang, "target_lang": target_lang}, TRANSLATE_SCHEMA)
    out = str(result.data.get("text", "")).strip()
    if not out:
        raise AIUnavailable("empty translation")
    confidence = float(result.data.get("confidence", 0.7))
    return out, max(0.0, min(1.0, confidence)), result.data.get("low_confidence_note"), result.model_version
