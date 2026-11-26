# Business agent (ported from Jennifer)

This folder is Jennifer's agent core, ported to Python so this app can run the same business agent Jennifer runs. Source: github.com/BHDossantos/jennifer. Change it there first, then copy it here again.

- `core.py`: the department agents, Jennifer's agent rules, the strict output envelope and `run_business_task`, which works one business task the way Jennifer's department shift does.
- `charter.py`: this business's agent, with its tasks, guardrails, measures and the daily Claude routine it works alongside.
- `untrusted.py`, `redaction.py`, `claims.py`: Jennifer's guards. Outside text is wrapped as untrusted data. Secrets are redacted from errors. Claims that something was paid, sent or signed are flagged.

The agent can only propose. Nothing here sends, posts, pays or writes. Every proposal comes back with `"needsApproval": True`, and nothing is wired to a page or an API route yet.

To turn it on, the app needs a server-side AI key and a model provider that calls the model (for example through `app/ai/gateway.py`). Until then `run_business_task` returns `blocked` with "Add an AI key on the server to turn this agent on".
