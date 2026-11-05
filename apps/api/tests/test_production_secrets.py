"""Production must not accept tokens or webhooks signed with committed defaults."""
import pytest

from app.core.config import Settings
from app.main import check_production_secrets

FIELDS = ("secret_key", "identity_webhook_secret", "payments_webhook_secret")


@pytest.mark.parametrize("field", FIELDS)
@pytest.mark.parametrize("invalid", [None, "", "short", " " * 40])
def test_production_rejects_default_or_short_secrets(monkeypatch, field, invalid):
    values = {name: "test-only-private-signing-value-123456789" for name in FIELDS}
    if invalid is None:
        values.pop(field)
    else:
        values[field] = invalid
    settings = Settings(env="production", **values)
    monkeypatch.setattr("app.main.get_settings", lambda: settings)
    with pytest.raises(RuntimeError, match=f"MM_{field.upper()}"):
        check_production_secrets()


def test_production_accepts_configured_secrets(monkeypatch):
    settings = Settings(env="production", **{name: "test-only-private-signing-value-123456789" for name in FIELDS})
    monkeypatch.setattr("app.main.get_settings", lambda: settings)
    check_production_secrets()


def test_local_defaults_remain_usable(monkeypatch):
    monkeypatch.setattr("app.main.get_settings", lambda: Settings(env="local"))
    check_production_secrets()


@pytest.mark.parametrize("env", ["prod", "Production", "production "])
def test_misspelled_environment_cannot_disable_production_guards(env):
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        Settings(env=env)
