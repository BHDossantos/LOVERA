"""Business agent wiring: admins only, off until a key and flag are set."""
from __future__ import annotations

from types import SimpleNamespace

from app.business_agent import BUSINESS_AGENTS, run_business_task
from app.business_agent.provider import agent_off_reason, anthropic_provider, provider_from_env
from app.core.config import get_settings
from tests.conftest import staff

AGENT = BUSINESS_AGENTS[0]
OK = {
    "status": "completed",
    "summary": "s",
    "data": {"headline": "h", "skillsUsed": [], "findings": [], "proposals": [{"kind": "draft", "skillId": "copy", "title": "t", "detail": "d", "sourceId": "app:members"}], "questions": [], "notesForNextShift": ""},
    "sources": [{"sourceId": "app:members", "locator": "", "note": ""}],
    "assumptions": [],
    "proposed_actions": [],
    "blockers": [],
}


class FakeClient:
    def __init__(self, reply=None, error=None):
        self.sent: dict = {}
        self.messages = self
        self._reply, self._error = reply, error

    def create(self, **kw):
        self.sent = kw
        if self._error:
            raise self._error
        return SimpleNamespace(content=[SimpleNamespace(type="tool_use", input=self._reply)])


def test_off_without_flag_or_key():
    assert "BUSINESS_AGENT_ENABLED" in agent_off_reason({})
    assert "ANTHROPIC_API_KEY" in agent_off_reason({"BUSINESS_AGENT_ENABLED": "true"})
    assert agent_off_reason({"BUSINESS_AGENT_ENABLED": "true", "ANTHROPIC_API_KEY": "k"}) is None
    assert provider_from_env({"ANTHROPIC_API_KEY": "k"}) is None


def test_forced_tool_call_becomes_the_envelope_and_proposals_need_approval():
    fake = FakeClient(reply=OK)
    model = provider_from_env({"BUSINESS_AGENT_ENABLED": "true", "ANTHROPIC_API_KEY": "k"}, client_factory=lambda key: fake)
    r = run_business_task(AGENT, AGENT["tasks"][0]["id"], [{"sourceId": "app:members", "trusted": True, "text": "x"}], model=model)
    assert fake.sent["tool_choice"]["type"] == "tool"
    assert r["status"] == "completed"
    assert all(p["needsApproval"] is True for p in r["proposals"])


def test_failed_call_does_not_leak_the_key():
    fake = FakeClient(error=RuntimeError("401 for key sk-ant-abcdefghijklmnopqrstuvwxyz"))
    r = run_business_task(AGENT, AGENT["tasks"][0]["id"], [{"sourceId": "app:members", "trusted": True, "text": "x"}], model=anthropic_provider(fake))
    assert r["status"] == "failed"
    assert "abcdefghijklmnop" not in str(r)


def test_route_is_admin_only(client):
    assert client.get("/v1/admin/business-agent").status_code == 401
    concierge = staff(client, "concierge@example.test")
    assert concierge.get("/admin/business-agent").status_code == 403
    assert concierge.post("/admin/business-agent/run", json={"taskId": "partners"}).status_code == 403


def test_route_is_off_until_enabled(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "business_agent_enabled", False)
    admin = staff(client, "admin@example.test")
    res = admin.get("/admin/business-agent")
    assert res.status_code == 200
    assert "BUSINESS_AGENT_ENABLED" in res.json()["off"]
    assert admin.post("/admin/business-agent/run", json={"taskId": AGENT["tasks"][0]["id"]}).status_code == 503


def test_route_runs_on_counts_when_enabled(client, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "business_agent_enabled", True)
    monkeypatch.setattr(settings, "anthropic_api_key", "k")
    fake = FakeClient(reply=OK)
    monkeypatch.setattr("app.modules.admin.business_agent.provider_from_env", lambda env: anthropic_provider(fake))
    admin = staff(client, "admin@example.test")
    res = admin.post("/admin/business-agent/run", json={"taskId": AGENT["tasks"][0]["id"]})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "completed"
    prompt = fake.sent["messages"][0]["content"]
    assert "Members: " in prompt
    assert "admin@example.test" not in prompt
