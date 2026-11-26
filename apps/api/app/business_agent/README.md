# Business agent (ported from Jennifer)

This folder is Jennifer's agent core, ported to Python so this app can run the same business agent Jennifer runs. Source: github.com/BHDossantos/jennifer. Change it there first, then copy it here again.

- `core.py`: the department agents, Jennifer's agent rules, the strict output envelope and `run_business_task`, which works one business task the way Jennifer's department shift does.
- `charter.py`: this business's agent, with its tasks, guardrails, measures and the daily Claude routine it works alongside.
- `untrusted.py`, `redaction.py`, `claims.py`: Jennifer's guards. Outside text is wrapped as untrusted data. Secrets are redacted from errors. Claims that something was paid, sent or signed are flagged.

The agent can only propose. Nothing here sends, posts, pays or writes. Every proposal comes back with `"needsApproval": True`.

## Turning it on

`provider.py` wires the agent to Claude and `app/modules/admin/business_agent.py` exposes it to members with the `admin` role only.

1. Set `MM_ANTHROPIC_API_KEY` on the server (the AI gateway already uses it).
2. Set `MM_BUSINESS_AGENT_ENABLED=true`. Without it the run route answers 503 with the reason, and nothing calls the model.
3. `GET /v1/admin/business-agent` shows the charter. `POST /v1/admin/business-agent/run` with `{"taskId": "partners", "notes": "..."}` runs one task on member counts by status and market plus any notes, and returns the proposals. The model sees counts only, never names, contact details or profiles. Nothing is stored or sent.

`MM_BUSINESS_AGENT_MODEL` overrides the model; it falls back to `MM_ANTHROPIC_MODEL`.
