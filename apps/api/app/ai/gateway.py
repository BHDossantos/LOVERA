"""LLM gateway for bounded language tasks.

The model never ranks pairs, never overrides Must preferences, never sends a message. Every task
receives only approved structured context, returns a validated JSON object, and degrades to a
deterministic provider (or AI_UNAVAILABLE) without disabling any manual path.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Protocol

from app.catalog.signals import SIGNALS
from app.core.config import get_settings

log = logging.getLogger("ai")


class AIUnavailable(Exception):
    pass


@dataclass
class AIResult:
    data: dict[str, Any]
    model_version: str
    provider: str


class Provider(Protocol):
    name: str

    def complete_json(self, task: str, system: str, user: str, schema: dict[str, Any]) -> AIResult: ...


# ---------------------------------------------------------------------------
# Deterministic provider: keyword and rule based so every path works offline
# ---------------------------------------------------------------------------
class DeterministicProvider:
    name = "deterministic"
    version = "deterministic-2026-09"

    def complete_json(self, task: str, system: str, user: str, schema: dict[str, Any]) -> AIResult:
        payload = json.loads(user)
        handler = getattr(self, f"_{task}", None)
        if handler is None:
            raise AIUnavailable(f"no deterministic handler for {task}")
        return AIResult(data=handler(payload), model_version=self.version, provider=self.name)

    def _extract_signals(self, payload: dict[str, Any]) -> dict[str, Any]:
        text = (payload.get("answer") or "").lower()
        candidates = payload.get("candidate_signal_keys") or []
        found: list[dict[str, Any]] = []
        for key in candidates:
            signal = SIGNALS.get(key)
            if not signal:
                continue
            best_value, best_hits = None, 0
            for value, words in signal.synonyms.items():
                hits = sum(1 for w in words if w in text)
                if hits > best_hits:
                    best_value, best_hits = value, hits
            if best_value is None:
                for value, label in signal.options.items():
                    if label.lower() in text or value.replace("_", " ") in text:
                        best_value, best_hits = value, 1
                        break
            if best_value is not None:
                found.append({"key": key, "value": best_value, "confidence": "promising" if best_hits == 1 else "strong", "evidence": text[:160]})
        return {"signals": found, "prohibited_inferences_used": False}

    def _draft(self, payload: dict[str, Any]) -> dict[str, Any]:
        goal = payload.get("goal", "reply")
        mode = payload.get("mode", "natural")
        other = payload.get("other_display_name", "there")
        facts = payload.get("shared_facts") or []
        last = (payload.get("recent_messages") or [{}])[-1].get("text", "") if payload.get("recent_messages") else ""
        hook = f" You mentioned {facts[0]}." if facts else ""
        if goal == "opener":
            text = f"Hi {other}! The matchmaker flagged that we both care about {facts[0] if facts else 'building something real'} — what's drawn you to that lately?"
        elif goal == "suggest_public_date":
            venue = payload.get("suggested_venue") or "a café in the centre"
            window = payload.get("suggested_window") or "this weekend"
            text = f"I'm enjoying this. Would you like to meet for a coffee at {venue} {window}? Happy to adjust if another time suits you better."
        elif goal == "respond":
            text = f"That made me smile.{hook} What did that look like for you?" if last else f"How has your week been going?{hook}"
        else:
            text = f"Thanks for sharing that.{hook} I'd like to hear more."
        if mode == "playful":
            text = text.replace("I'm enjoying this.", "Okay, I'm officially curious.")
        elif mode == "direct":
            text = text.replace("Would you like to", "Let's").replace("? Happy to adjust", ". Happy to adjust")
        return {"text": text, "safety_labels": []}

    def _translate(self, payload: dict[str, Any]) -> dict[str, Any]:
        text = payload.get("text", "")
        src, tgt = payload.get("source_lang", "en"), payload.get("target_lang", "en")
        table = {
            ("en", "it"): {"hello": "ciao", "hi": "ciao", "coffee": "caffè", "saturday": "sabato", "sunday": "domenica", "thanks": "grazie", "would you like": "ti va", "tomorrow": "domani", "yes": "sì", "no": "no"},
            ("en", "es"): {"hello": "hola", "hi": "hola", "coffee": "café", "saturday": "sábado", "sunday": "domingo", "thanks": "gracias", "would you like": "te apetece", "tomorrow": "mañana", "yes": "sí"},
            ("en", "pt"): {"hello": "olá", "hi": "olá", "coffee": "café", "saturday": "sábado", "sunday": "domingo", "thanks": "obrigado", "would you like": "queres", "tomorrow": "amanhã", "yes": "sim"},
        }
        words = table.get((src, tgt)) or {v: k for k, v in table.get((tgt, src), {}).items()}
        out = text
        for k, v in sorted(words.items(), key=lambda kv: -len(kv[0])):
            out = re.sub(rf"\b{re.escape(k)}\b", v, out, flags=re.IGNORECASE)
        confidence = 0.55 if out == text and src != tgt else 0.7
        return {"text": out, "confidence": confidence, "low_confidence_note": "Sandbox translation preserves words it does not know." if confidence < 0.7 else None}

    def _explain(self, payload: dict[str, Any]) -> dict[str, Any]:
        # Deterministic explanation is produced by the matching explanation module directly.
        raise AIUnavailable("explain handled deterministically")


# ---------------------------------------------------------------------------
# Anthropic provider
# ---------------------------------------------------------------------------
class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str, model: str) -> None:
        import anthropic

        self._anthropic = anthropic
        self._client = anthropic.Anthropic(api_key=api_key, max_retries=1, timeout=30.0)
        self._model = model

    @property
    def version(self) -> str:
        return f"{self._model}:{get_settings().ai_prompt_version}"

    def complete_json(self, task: str, system: str, user: str, schema: dict[str, Any]) -> AIResult:
        anthropic = self._anthropic
        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=2000,
                system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": user}],
                output_config={"format": {"type": "json_schema", "schema": schema}, "effort": "low"},
            )
        except (anthropic.RateLimitError, anthropic.APIStatusError, anthropic.APIConnectionError) as exc:
            log.warning("anthropic unavailable for %s: %s", task, type(exc).__name__)
            raise AIUnavailable(str(exc)) from exc
        if response.stop_reason == "refusal":
            raise AIUnavailable("model declined the request")
        text = next((b.text for b in response.content if b.type == "text"), "{}")
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise AIUnavailable("model returned invalid JSON") from exc
        return AIResult(data=data, model_version=self.version, provider=self.name)


class UnavailableProvider:
    name = "unavailable"

    def complete_json(self, task: str, system: str, user: str, schema: dict[str, Any]) -> AIResult:
        raise AIUnavailable("AI provider disabled")


_provider: Provider | None = None
_override: Provider | None = None


def set_provider_override(provider: Provider | None) -> None:
    """Test hook: force a provider (for example UnavailableProvider to simulate an outage)."""
    global _override
    _override = provider


def get_provider() -> Provider:
    global _provider
    if _override is not None:
        return _override
    if _provider is not None:
        return _provider
    settings = get_settings()
    choice = settings.ai_provider
    if choice == "auto":
        choice = "anthropic" if settings.anthropic_api_key else "deterministic"
    if choice == "anthropic" and settings.anthropic_api_key:
        _provider = AnthropicProvider(settings.anthropic_api_key, settings.anthropic_model)
    elif choice == "unavailable":
        _provider = UnavailableProvider()
    else:
        _provider = DeterministicProvider()
    return _provider


def run(task: str, system: str, payload: dict[str, Any], schema: dict[str, Any]) -> AIResult:
    provider = get_provider()
    try:
        return provider.complete_json(task, system, json.dumps(payload, ensure_ascii=False), schema)
    except AIUnavailable:
        if provider.name == "anthropic":
            log.info("falling back to deterministic provider for %s", task)
            return DeterministicProvider().complete_json(task, system, json.dumps(payload, ensure_ascii=False), schema)
        raise
