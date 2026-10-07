# Launch readiness

Audited against the code on `main`, not from memory. Every claim below names the file or
endpoint it came from, so you can check any line of it.

**Verdict: not ready**, and the reasons are now entirely in section A. Three things stop the
product working at all in production and every one of them needs an account or a decision
only you can supply. The mobile app reaches 81 of the 92 member-facing API endpoints; the web
app reaches 84.

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
| Web | 84 / 92 |
| Mobile | 81 / 92 |

Closed since the first audit: date proposal, response, cancellation, overlaps and venues; the
safety check-in; AI drafts and translation; the notifications inbox; conversation close;
profile editing and photo removal; preferences and blueprint editing; consent withdrawal;
account review and appeals; export download; unblock; the second-date reveal; introduction
extension; case evidence; the introduction correction; and `explanation-viewed`.

### B1. What is left

- **`POST /safety/cases/{report_id}/appeal`** — the spec's "appeal the action attached to this case" path. Both apps appeal through `/account/review/{action_id}/appeal`, which covers the same ground, so this is a redundancy rather than a gap.
- **`GET /blueprint/sessions/{session_id}`** — the interview's own POST responses already carry the session state, so nothing needs it.
- **`GET /media/{media_id}`** — media arrive as URLs in their parent payloads.

Closed since: locale and time zone could not be changed after sign-up on mobile — `PATCH /me`
was the last member endpoint the app did not reach. The web app has always had `/you/settings`;
mobile now has the same screen, and the field matters more than it looks: availability windows
are weekday and clock time, and the server reads them in `member.timezone` when it works out
when two people could both meet, so a member who moved kept being offered the wrong evenings.
That field was also accepted as free text by both `PATCH /me` and `PUT /availability` and read
by nothing until a date was proposed, at which point `ZoneInfo(plan.timezone)` raised — a 500
for the proposer and another for the other member every time they opened the plan's overlaps,
from a value neither of them could change back. It is validated at both doors now
(`apps/api/tests/test_timezone.py`). Readiness could be turned off and never back on, because the editor that sets
`date_ready` existed only inside onboarding — while Today emitted a task telling members to
turn it on, pointing at `/you/profile`, which cannot change it. That task now points at
`/you/availability`, which both apps have. Blocking somebody required filing a report against
them first; the conversation itself now offers block and report, with the person and the
conversation attached so a reviewer gets the context. And a preference can be cleared back to
unset rather than only set to Open, which still weighs it.

### B4. Deferred by decision, not unfinished

- **Membership**: `GET /plans`, `GET /subscriptions/current`, `POST /subscriptions/checkout`, `/cancel`. Apple requires in-app purchase for digital subscriptions (guideline 3.1.1), so a web checkout link inside the app is a rejection, and there is no StoreKit or Play Billing code in the repo. Until you decide whether to charge on mobile at launch, the app sells nothing — compliant, but the paid intro caps (`weekly_intro_cap_paid`) are unreachable from it.
- **`GET /realtime/token`**: mobile polls every 8s instead of holding a WebSocket. Works, slower, heavier on battery.
- **Voice and video**: `POST /conversations/{id}/voice-sessions`, `/video-tokens`. The API returns pilot stubs, so there is nothing to show yet.
- **`POST /calendar/connect`**: not reached by either app.

---

## C. Quality gaps

- **Mobile test coverage is thin but no longer absent.** 122 tests over the screens where a wrong assumption about a payload is invisible until a member hits it. The API has 86 and the web app has Playwright e2e.
- **The whole class of bug these guards exist for was real.** `get<T>()` is an unchecked assertion, and client paths are strings on one side and file names on the other, so six guards now run in CI: `tools/check_api_contract.py` (every call hits a route that accepts it), `tools/check_safety_target.py` (no client takes a safety action's subject from the profile snapshot the API empties on a closed conversation), `tools/check_query_keys.py` (no mutation invalidates a cache key no query uses, which React Query reports as success), `tools/check_upload_types.py` (every upload picker offers exactly what the endpoint its input posts to accepts — five rounds of review on this one, because the two sides can drift at the shared type tuple, the call site, the branch discriminator, the declaration and the input itself), `apps/mobile/scripts/check-routes.js` (every navigation target *and* every path the API hands the app resolves to a screen), and `apps/mobile/scripts/check-native-config.py`. Each was written after a bug it would have caught shipped.
- **A failing e2e run is diagnosable, by one route only.** This line used to say it was diagnosed blind; that was wrong. The check-run output does come back empty and the Playwright HTML report is unreachable, and a plain REST client refuses the blob-storage redirect `actions/jobs/{id}/logs` returns — but the GitHub MCP server's job-log tool follows it and hands back the log text, which is how run 37629777052's e2e failure was read down to `journey.spec.ts:76` timing out on one page. Worth knowing because the first failure cost an afternoon of guessing. Emitting failures as `::error::` annotations as well would still help, since annotations survive log retention.
- **Profile photo upload is not size-guarded.** `data_url` is capped at 15,000,000 characters on both the evidence and profile media endpoints, so base64 over ~11 MB is refused. The evidence flow now resizes to fit, to widths derived from the source because `resize({width})` sets the result width rather than a maximum; the profile flow does not, but it crops to 4:5 and re-encodes at 0.8 quality, which bounds its output far below the cap. Recorded rather than built for; the helper to reuse is `fitForUpload` in `apps/mobile/src/components/EvidenceAttach.tsx`.
- **Messages poll instead of streaming.** Mobile refetches every 8s (`messages/[conversationId].tsx:42`); web uses `GET /realtime/token` and a WebSocket. Functional, slower, heavier on battery.
- **No over-the-air updates.** `expo-updates` is not installed, so every fix after launch is a full store review.
- **Legal pages carry 21 `TODO` markers** across terms (8), privacy (11) and community (2), and have had no legal review.
- **A refresh interrupted mid-flight signs the member out, and the obvious fix was worse.** `rotate_session` revokes the token it was given before the client can store its replacement, so a full page load or an app restart during that one round trip leaves the client holding a dead token, and `apps/web/src/lib/api.ts` treats a failed refresh as signed out. Narrow — client-side navigation does not cancel the request, so it is reloads and cold starts — but real. I added a sixty-second grace window that answered a replayed token from its replacement, and reverted it: review showed that hands whoever holds a copy of the old token the live session and leaves the real client with the revoked half, which is a session takeover in exchange for a convenience. The two remedies that do work both need a decision rather than a patch: a short *idempotent* leeway, which means storing the issued refresh token in plaintext for a few seconds so the same one can be re-served, or reuse detection that revokes the whole chain, which is the OAuth BCP answer and signs both parties out on any replay. Single-use rotation stands until somebody qualified picks one; `apps/api/tests/test_refresh_rotation.py` pins the current behaviour so it is not traded away by accident.
- **Matching on gender and seeking has no consent of its own, and that is a question for the legal review rather than a bug to fix in code.** `hard_gate` calls `orientation_ok(a.member, b.member)`, which reads `Member.gender` and `Member.seeking` — who somebody is and who they want — for every pair in every batch. The `special_category` consent exists, but onboarding asks for it as "I may choose to share faith for matching", off by default, so most members never grant it and are matched anyway. Review flagged this as orientation data processed without consent and proposed excluding those members from matching; that would stop introductions for nearly everybody and contradict what onboarding says the toggle is for, so it is recorded here instead. The mobile consent screen, which claimed this consent covered sexual orientation and that withdrawing it stopped new introductions, has been corrected to describe what actually happens. What needs deciding by somebody qualified: whether Art. 9 covers these two fields as collected, and if so whether the basis is a separate explicit consent in onboarding, Art. 9(2)(e) data made public by the member, or a change to what is collected.
- **A date's time is displayed in the plan's zone, which is the proposer's.** The instants are now correct — `overlaps` intersects each member's windows in their own zone (`app/core/windows.py`), so nobody is offered a slot outside the evening they stated — but `DatePlan.timezone` is copied from whoever created the plan, and both apps render the agreed time with it (`formatDateTime(p.starts_at, p.timezone)`). For two members in the same zone, which both our markets are, that is identical. For a pair an hour apart it means the member who did not create the plan reads a clock face in the other's zone, and on the date detail page the zone is not named beside it — so they could arrive an hour late. The window picker does name it (`${w.start}–${w.end} (${plan.timezone})`); the confirmation and detail screens do not. Two ways to settle it, and it is a product decision rather than a bug to patch blind: render every absolute time in the viewer's own zone, which is what a member expects from everything else on their phone, or keep the plan's zone and name it everywhere it appears. Not fixed here because it is a sweep across about ten client files in both apps, and the arithmetic — the part that was actually wrong — is fixed and tested (`apps/api/tests/test_cross_timezone.py`).
- **No store screenshots** anywhere in the repo.

---

## D. What is done, and solid

- **Backend**: 92 member endpoints, 69 tests green. Schema creation race fixed with a Postgres advisory lock. Email transport with a production boot guard. Sandbox payment and verification endpoints correctly 404 in production.
- **Web app**: complete — 60 routes and 83 of 92 member endpoints, Playwright e2e, legal pages.
- **Mobile**: 44 screens and 81 of 92 member endpoints. Onboarding end to end; Today; introductions with explanation, correction, extension and private decision; the mutual screen; messaging with AI drafts and translation; date proposal, response, venues, confirmation, check-in, feedback and the second-date reveal; the safety centre with report, evidence, case tracking, blocks and unblock; account review and appeals; profile, preferences and blueprint editing; consent withdrawal; availability and readiness; language and time zone; block and report from inside a conversation; export, pause and delete; notifications inbox; push registration.
- **Build pipeline**: native config generated and asserted (20 checks), placeholder API origins and missing EAS project ids refused before a build starts, EAS build workflow.
- **Guards that would have caught what shipped**: the API contract check, the route check (including every path the API hands a client), and the native config check, all in CI. Each was verified by breaking the thing it checks and confirming it fails.

---

## E. Order I would do this in

1. A real identity vendor, or an explicit decision to run manual review for the pilot. Nothing else matters while nobody can finish signing up.
2. SMTP provider plus SPF/DKIM/DMARC. Deploy the API.
3. IAP, if you intend to charge on mobile at launch. Otherwise ship free and add it later — but then the paid tiers do not exist on mobile.
4. Legal review of the three documents, and store screenshots.
5. Make e2e failures readable through the API (`::error::` annotations), so a red run can be diagnosed without guessing.

Items 1, 2, 3 and 4 need decisions or accounts only you can supply. 5 is code, and nothing is
waiting on it.
