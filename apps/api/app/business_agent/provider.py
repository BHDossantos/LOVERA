"""Wiring for the business agent.

It stays off until the server has both an AI key and
BUSINESS_AGENT_ENABLED=true, and only admins can run it. The agent only
proposes: nothing here sends, posts, pays or writes.
"""
from __future__ import annotations

import json
import os
from typing import Any, Callable, Dict, Mapping, Optional

from .core import ModelProvider

DEFAULT_MODEL = "claude-sonnet-5-5"


def agent_off_reason(env: Optional[Mapping[str, str]] = None) -> Optional[str]:
    """Why the agent is off, or None when it can run."""
    env = os.environ if env is None else env
    if env.get("BUSINESS_AGENT_ENABLED") != "true":
        return "Set MM_BUSINESS_AGENT_ENABLED=true on the server to turn the business agent on."
    if not env.get("ANTHROPIC_API_KEY"):
        return "Add MM_ANTHROPIC_API_KEY on the server to turn the business agent on."
    return None


def anthropic_provider(client: Any, model: Optional[str] = None) -> ModelProvider:
    """A ModelProvider on the Claude Messages API.

    The schema is passed as the only tool and the model is made to call it,
    so the reply is the JSON the schema asks for.
    """

    def complete(req: Dict[str, Any]) -> str:
        name = req["json_schema"]["name"][:64]
        res = client.messages.create(
            model=model or DEFAULT_MODEL,
            max_tokens=req["max_output_tokens"],
            system=req["system"],
            messages=[{"role": "user", "content": req["input"]}],
            tools=[{"name": name, "description": "Return the shift result.", "input_schema": req["json_schema"]["schema"]}],
            tool_choice={"type": "tool", "name": name},
        )
        for block in getattr(res, "content", None) or []:
            if getattr(block, "type", None) == "tool_use":
                return json.dumps(getattr(block, "input", None))
        raise RuntimeError("model returned no result")

    return complete


def provider_from_env(
    env: Optional[Mapping[str, str]] = None,
    client_factory: Optional[Callable[[str], Any]] = None,
) -> Optional[ModelProvider]:
    """The provider when the agent is on, otherwise None (run_business_task then returns blocked)."""
    env = os.environ if env is None else env
    if agent_off_reason(env):
        return None
    if client_factory is None:
        from anthropic import Anthropic

        def client_factory(key: str) -> Any:
            return Anthropic(api_key=key)

    return anthropic_provider(client_factory(env["ANTHROPIC_API_KEY"]), env.get("BUSINESS_AGENT_MODEL"))
