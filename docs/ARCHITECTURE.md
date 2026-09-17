# Architecture

The pilot runs as independently deployable services with a shared PostgreSQL cluster, following the
AI Matchmaker Implementation Specification v1.0: the backend enforces every trust boundary; the client
presents decisions but cannot create a conversation, reveal mutual interest, change safety state,
grant a credit, or activate a subscription.

## Services

| Service | Image | Role | Scales |
|---|---|---|---|
| `api` | `apps/api` | HTTP + WebSocket API (`/v1`), health at `/healthz` | horizontally behind a load balancer |
| `worker` | `apps/api` (same image, `python -m app.jobs loop`) | outbox drain, introduction expiry, reminders, missed check-ins, retention sweep, deletions, and the scheduled weekly match batch (once per cohort date) | one instance per market |
| `web` | `apps/web` | Next.js member app and staff console; proxies `/api/*` to the api service | horizontally |
| `db` | postgres:16 | transactional source of truth | managed Postgres in production |
| `redis` | redis:7 | presence / pub-sub fan-out for multi-instance realtime | managed Redis |

The API code is organised as domain modules (`app/modules/*`) that own their tables, routes and
events and communicate through application services or the transactional outbox. That boundary is
the extraction seam: a module (for example `safety` or `matching`) can become its own service with
its own image and database schema by moving its package, keeping its router prefix and publishing
its outbox events over Redis, without changing the web app. Extract only when a module needs an
independent release cadence, scaling profile or data residency; until then one image with two roles
(api, worker) keeps operational debt low.

## Automation

- `make up` builds and starts every service; `make seed` loads a verified cohort and publishes a batch.
- CI (`.github/workflows/ci.yml`): API tests on Postgres, web typecheck/lint/build, Playwright journey,
  and Docker image builds with smoke tests for both images.
- `.github/workflows/publish.yml` publishes `ghcr.io/<repo>/api` and `ghcr.io/<repo>/web` on every
  push to `main` and on `v*` tags. Set repository variables `API_ORIGIN` and `NEXT_PUBLIC_WS_URL`
  for the deployed origins.
- Dependabot keeps pip, npm, Docker base images and Actions current with weekly grouped PRs.
- The worker runs the weekly batch automatically (`MM_MATCH_BATCH_WEEKDAY`, `MM_MATCH_BATCH_HOUR`,
  market timezone). `MM_MATCH_AUTO_PUBLISH=false` keeps the concierge review step; `true` publishes
  immediately.

## Backend modules (`apps/api/app/modules`)

| Module | Owns | Notes |
|---|---|---|
| account | Member, Session, AuthChallenge, ConsentRecord | Email OTP, rotating refresh tokens, versioned consent ledger, pause, deletion grace period |
| verification | Verification | Vendor adapter (sandbox by default) returning a normalized result and token; signed webhook; human review path |
| profile | Profile, ProfileMedia, MediaBlob | Public presentation, media create → upload → complete → moderation, field-level visibility map |
| blueprint | BlueprintSession/Version/Signal, Preference | Adaptive interview (non-negotiables then scenarios), LLM extraction to a fixed signal catalog, member confirmation, immutable versions, Must/Prefer/Open with impact preview |
| availability | AvailabilityVersion | Coarse recurring windows and date styles only |
| matching | MatchRun, CandidatePair | Safety veto → bilateral hard gates → reciprocal harmonic score → capped allocation with exposure floor → rules-based faithful explanation → concierge review/publish; protected credits for unserved paid members |
| introductions | Introduction, IntroDecision, MatchExplanation | Private idempotent decisions with `FOR UPDATE` mutual transition creating the conversation exactly once; neutral "unavailable" state on decline/expiry |
| conversations | Conversation, Message, ReadCursor | Participant gate, `client_message_id` retry safety, scam/abuse heuristics, respectful close, in-process WebSocket hub |
| ai | AIDraft, Translation | Gateway with Anthropic provider (structured JSON output) and deterministic fallback; validators reject manipulation/contact sharing; `AI_UNAVAILABLE` never disables manual paths |
| dates | DatePlan, Venue, DateCheckIn, PostDateFeedback | Overlap intersection, balanced public venue shortlist (coordinates never serialized), proposal/reconfirmation with optimistic versions, scoped check-in, private feedback and mutual-only second-date reveal |
| safety | Block, SafetyReport, SafetyEvidence, SafetyAction, Appeal, CaseNote | Immediate protective action in the report transaction, severity routing (P0–P3), case status, independent appeal reviewer rule |
| billing | Subscription, CheckoutSession, CreditLedger, WebhookReceipt | Plan catalog (no boosts), sandbox/Stripe-shaped signed webhooks, append-only credit ledger |
| notifications | Notification | In-app, deduplicated |
| privacy | PrivacyRequest | Data map, export, deletion orchestration (jobs.erase_member) |
| today | – | Outcome-ranked next action |
| admin | – | Concierge, verification review, safety cases, appeals, support, audit; every sensitive read carries a purpose and is audited |

Cross-cutting: `core/errors.py` (Section E error catalog), `core/idempotency.py`, `core/audit.py`
(hash-chained audit events), `core/analytics.py` (allowlisted event properties; raw text rejected),
`core/events.py` (transactional outbox drained after each successful command), `jobs/` (expiry,
reminders, missed check-ins, retention sweep, deletion).

## Matching pipeline

1. Safety veto: restricted members and blocked pairs never enter candidate generation.
2. Hard gate (both directions): verification, 18+, active status, reciprocal orientation, intent lane,
   coarse distance within both limits, every Must preference; unknown children/structure signals fail closed.
3. Scoring: `directional_fit` per side (weighted Prefer/Open satisfaction + rhythm similarity),
   harmonic reciprocal blend, practical (availability overlap, distance, language), quality
   (freshness, completeness, readiness), penalties (uncertainty, stale evidence).
4. Allocation: per-member caps from plan/trial and pending/conversation capacity; exposure floor
   serves members with fewest options first; then fill by score; coverage and Gini recorded.
5. Explanation: three reasons, one friction, one unknown from approved structured factors only;
   validator blocks prohibited topics, special-category signals, and numeric certainty.
6. Concierge review and publish; analytics `introduction_offered` with rank and propensity.

## Web app

Route groups mirror the screen inventory (Appendix A): `/welcome`, `/onboarding/*` (O01–O08),
`/today` (T01), `/notifications` (T02), `/introductions/*` (I01–I06), `/messages/*` (M01–M06),
`/dates/*` (D01–D06), `/you/*` (Y01–Y08, X01), `/safety/*` (S01–S03), `/account/review` (S04),
`/admin/*` (staff workspaces). `src/lib/api.ts` keeps the access token in memory, rotates refresh
tokens, sends `Idempotency-Key` and `If-Match`, and maps machine error codes to safe copy.

## Local development

```
# database (or use infra/docker-compose.yml)
cd apps/api && python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"
export MM_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/matchmaker
uvicorn app.main:app --reload --port 8000
python -m app.seed --run-batch      # 30 verified members + a published batch
cd ../web && npm install && npm run dev
```

Staff bootstrap emails (sandbox): `concierge@example.test`, `safety@example.test`, `admin@example.test`.
