# Launch readiness

Audited against the code on `main`, not from memory. Every claim below names the file or
endpoint it came from, so you can check any line of it.

**Verdict: not ready**, and the reasons are now entirely in section A. Three things stop the
product working at all in production and every one of them needs an account or a decision
only you can supply. The mobile app reaches 78 of the 92 member-facing API endpoints; the web
app reaches 82.

Section B was the mobile feature gap. Most of it is closed; what is left is listed with the
reason it is still open, and section B4 separates what is deferred by a decision you have not
made yet from what is simply unfinished.

Run the numbers yourself rather than trusting this line:

```
cd apps/api && python -c "import json; from app.main import app; json.dump(app.openapi(), open('openapi.json','w'))"
python ../../tools/endpoint_coverage.py openapi.json ../../apps/web/src ../../apps/mobile
```

---

## A. Blockers — the product does not function in production

### A1. Identity verification dead-ends. Nobody gets past onboarding.

`MM_IDENTITY_PROVIDER` defaults to `sandbox` (`apps/api/app/core/config.py`), and
`infra/fly/api.toml` does not override it. The sandbox completion endpoint is correctly
refused in production:

```python
# apps/api/app/modules/verification/router.py:51
if settings.is_production or settings.identity_provider != "sandbox":
    raise ApiError("NOT_FOUND")
```

Onboarding hard-gates on it:

```python
# apps/api/app/modules/account/service.py:317
if not is_verified(db, member.id):
    member.status, member.onboarding_step = "pending_verification", "verification"
    return
```

So in production a member signs up, reaches step 2 of 6, and stops. There is no real
vendor adapter in the codebase — only a webhook contract (`POST /webhooks/verification`)
waiting for one to be wired to it.

The one escape hatch is `POST /verification/review-request`, which puts the member in a
staff queue for manual approval. That is a workable pilot posture for small numbers, but
it means a human approves every single signup, and it must be a deliberate choice rather
than something discovered on launch day.

This matters beyond mechanics: "verified members" is the product's core safety claim and
will appear in both store listings. Shipping it unverified is a claim we cannot support.

### A2. Email has no provider configured.

The transport exists and the API refuses to boot in production without it (`core/mail.py`,
`main.py:check_mail_transport`). What is missing is an account: an SMTP host, credentials,
and SPF/DKIM/DMARC on the sending domain. Sign-in is a one-time emailed code, so until
this is set nobody can log in at all. See `docs/DEPLOY.md` §2.

### A3. The API is not deployed.

No origin means no mobile build — the build guards refuse a placeholder, by design.

---

## B. The mobile app, against the web app

Counted by `tools/endpoint_coverage.py`, which reads the generated schema and every call site
in both apps:

| | member endpoints reached |
|---|---|
| Web | 82 / 92 |
| Mobile | 78 / 92 |

Closed since the first audit: date proposal, response, cancellation, overlaps and venues; the
safety check-in; AI drafts and translation; the notifications inbox; conversation close;
profile editing and photo removal; preferences and blueprint editing; consent withdrawal;
account review and appeals; export download; unblock; the second-date reveal; introduction
extension; case evidence; the introduction correction; and `explanation-viewed`.

### B1. Readiness cannot be turned back on — and Today tells members to do it

`PATCH /me` is never called from mobile. `app/(app)/you/index.tsx:100` *shows* `date_ready` as
a badge with no control beside it, and Today emits a task that sends members to a screen that
cannot act on it:

```
# apps/api/app/modules/today/router.py
"title": "You're marked as not ready to date", "path": "/you/profile", "cta": "Update readiness"
```

Pause and resume are a different thing (`POST /me/pause`, `/me/resume`) and both work. Locale
and timezone are also only settable through `PATCH /me`, so neither can be changed either.

### B2. Blocking somebody without reporting them

`POST /blocks` is not called from either app. Blocking exists inside the report flow
(`block_now`, default on), which is what satisfies Apple's guideline 1.2, and unblocking works
from `/safety` and `/safety/blocks`. But a member who wants to cut contact without filing a
report has to file one.

### B3. Smaller, and real

- `DELETE /preferences/{key}` — a preference can be set and changed but not cleared back to unset. Not called from either app.
- `POST /safety/cases/{report_id}/appeal` — the spec's "appeal the action attached to this case" path. Mobile appeals through `/account/review/{action_id}/appeal`, which covers the same ground, so this is a redundancy rather than a gap.
- `GET /blueprint/sessions/{session_id}` — the interview's own POST responses already carry the session state, so nothing needs it.
- `GET /media/{media_id}` — media arrive as URLs in their parent payloads.

### B4. Deferred by decision, not unfinished

- **Membership**: `GET /plans`, `GET /subscriptions/current`, `POST /subscriptions/checkout`, `/cancel`. Apple requires in-app purchase for digital subscriptions (guideline 3.1.1), so a web checkout link inside the app is a rejection, and there is no StoreKit or Play Billing code in the repo. Until you decide whether to charge on mobile at launch, the app sells nothing — compliant, but the paid intro caps (`weekly_intro_cap_paid`) are unreachable from it.
- **`GET /realtime/token`**: mobile polls every 8s instead of holding a WebSocket. Works, slower, heavier on battery.
- **Voice and video**: `POST /conversations/{id}/voice-sessions`, `/video-tokens`. The API returns pilot stubs, so there is nothing to show yet.
- **`POST /calendar/connect`**: not reached by either app.

---

## C. Quality gaps

- **Mobile test coverage is thin but no longer absent.** 88 tests over the screens where a wrong assumption about a payload is invisible until a member hits it. The API has 55 and the web app has Playwright e2e.
- **The whole class of bug these guards exist for was real.** `get<T>()` is an unchecked assertion, and client paths are strings on one side and file names on the other, so three guards now run in CI: `tools/check_api_contract.py` (every call hits a route that accepts it), `apps/mobile/scripts/check-routes.js` (every navigation target *and* every path the API hands the app resolves to a screen), and `apps/mobile/scripts/check-native-config.py`. Each was written after a bug it would have caught shipped.
- **A failing e2e run is currently diagnosed blind.** CI logs live on blob storage the API client will not follow, the check-run output comes back empty, and the Playwright artifact is unreachable. Emitting failures as `::error::` workflow annotations would fix this, because annotations *are* reachable.
- **Messages poll instead of streaming.** Mobile refetches every 8s (`messages/[conversationId].tsx:42`); web uses `GET /realtime/token` and a WebSocket. Functional, slower, heavier on battery.
- **No over-the-air updates.** `expo-updates` is not installed, so every fix after launch is a full store review.
- **Legal pages carry 21 `TODO` markers** across terms (8), privacy (11) and community (2), and have had no legal review.
- **No store screenshots** anywhere in the repo.

---

## D. What is done, and solid

- **Backend**: 92 member endpoints, 55 tests green. Schema creation race fixed with a Postgres advisory lock. Email transport with a production boot guard. Sandbox payment and verification endpoints correctly 404 in production.
- **Web app**: complete — 60 routes, Playwright e2e, legal pages.
- **Mobile**: 42 screens and 78 of 92 member endpoints. Onboarding end to end; Today; introductions with explanation, correction, extension and private decision; the mutual screen; messaging with AI drafts and translation; date proposal, response, venues, confirmation, check-in, feedback and the second-date reveal; the safety centre with report, evidence, case tracking, blocks and unblock; account review and appeals; profile, preferences and blueprint editing; consent withdrawal; export, pause and delete; notifications inbox; push registration.
- **Build pipeline**: native config generated and asserted (20 checks), placeholder API origins and missing EAS project ids refused before a build starts, EAS build workflow.
- **Guards that would have caught what shipped**: the API contract check, the route check (including every path the API hands a client), and the native config check, all in CI. Each was verified by breaking the thing it checks and confirming it fails.

---

## E. Order I would do this in

1. A real identity vendor, or an explicit decision to run manual review for the pilot. Nothing else matters while nobody can finish signing up.
2. SMTP provider plus SPF/DKIM/DMARC. Deploy the API.
3. Mobile: the readiness toggle (B1), standalone block (B2), clearing a preference (B3). Small, and the first one is a task Today actively asks members to do.
4. IAP, if you intend to charge on mobile at launch. Otherwise ship free and add it later — but then the paid tiers do not exist on mobile.
5. Legal review of the three documents, and store screenshots.
6. Make e2e failures readable through the API (`::error::` annotations), so a red run can be diagnosed without guessing.

Items 1, 2, 4 and 5 need decisions or accounts only you can supply. 3 and 6 are code.
