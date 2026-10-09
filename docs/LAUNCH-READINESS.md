# Launch readiness

Audited against the code on `main`, not from memory. Every claim below names the file or
endpoint it came from, so you can check any line of it.

**Verdict: not ready**, and the reasons are now entirely in section A. Three things stop the
product working at all in production, a fourth stops anything being validated at all, and
every one of them needs an account or a decision only you can supply. The mobile app reaches
81 of the 92 member-facing API endpoints; the web app reaches 84.

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

### A1. Identity verification needs a vendor, or a deliberate choice to do it by hand.

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

**The accidental version of this is now impossible.** The API refuses to start in production with
`MM_IDENTITY_PROVIDER=sandbox` (`main.check_identity_provider`), because that is a deploy where
every endpoint answers, every health check is green, and not one member can finish signing up. The
error names both ways out.

**And the deliberate version is now a real mode.** `MM_IDENTITY_PROVIDER=manual_review` says out
loud that a person approves every member from the admin verification queue — which was always
possible through `POST /verification/review-request`, but was not a posture anybody had chosen and
did not behave like one. In that mode the API hands back no vendor session (it used to hand back a
`hosted_url` to a simulated capture page that cannot complete in production, so the member opened
it and waited at step 2 of 6 indefinitely), the member goes straight into the queue, and both apps
say a member of the team does the check personally rather than describing a vendor that is not
there. `review-request` also no longer refuses for want of a failed attempt to attach itself to,
which had made the endpoint's name a lie — and in this mode would have made it unusable.

`infra/fly/api.toml` declares `manual_review`, so a production deploy from this repo boots and
works today. What it costs you is a person in the loop for every signup, and honesty in the store
listing: "verified members" then means verified by your team, not by a document check. That is a
claim you can support; an automated one you cannot. Swapping in a real vendor is a one-line config
change plus an adapter on the webhook contract that is already there.
(`apps/api/tests/test_identity_mode.py`, 7 tests.)

### A2. Email has no provider configured.

The transport exists and the API refuses to boot in production without it (`core/mail.py`,
`main.py:check_mail_transport`). What is missing is an account: an SMTP host, credentials,
and SPF/DKIM/DMARC on the sending domain. Sign-in is a one-time emailed code, so until
this is set nobody can log in at all. See `docs/DEPLOY.md` §2.

### A3. The API is not deployed.

There is a way to get a signed build working before A1 is solved: deploy as **staging** rather
than production (`infra/fly/api-staging.toml`, section 5b of docs/DEPLOY.md). The sandbox
verification endpoint is gated on `MM_ENV` being production, not on the vendor, so staging keeps
it available and only the ID check is simulated. It still needs SMTP — `MM_EXPOSE_DEV_OTP` is off
there, so the code reaches members by mail or not at all, and the API refuses to boot without a
mail host. That is a pilot posture, not a launch one: real members would be verified by nobody.

No origin means no mobile build — the build guards refuse a placeholder, by design.

### A4. CI has stopped running. Nothing can be validated until it is turned back on.

No job in this repository has been given a runner since **22:55 UTC on 7 Oct**. Every run
since fails in two to four seconds with `runner_id: 0`, an empty `runner_name`, and HTTP 404
for its job log, because no step executes — there is no failing test to read. The last real
run was #190 (`59b1539`), which took 4m20s.

It is not any one branch's: run #191 is `dependabot[bot]` on a third branch, failing
identically. That shape — several branches, two actors, no runner, no log — is an account-level
Actions condition: a spending limit reached, or Actions disabled for the repository. Check
Settings → Billing → *Spending limit* and Settings → Actions → *General*.

While it holds, every push is locally verified and not CI-verified, which is a weaker claim
and is stated as one. What runs locally covers everything the three failing jobs do except the
browser journey, which needs the stack up:

```
cd apps/api && python -m pytest -q                      # 108 tests
cd apps/mobile && npx jest && npx tsc --noEmit          # 130 tests, 17 suites
cd apps/web && npx tsc --noEmit && npm run lint
python tools/check_api_contract.py openapi.json apps/mobile apps/web/src
python tools/check_safety_target.py && python tools/check_query_keys.py
python tools/check_upload_types.py
node apps/mobile/scripts/check-routes.js
python apps/mobile/scripts/check-native-config.py
```

This also blocks `.github/workflows/mobile-build.yml`, which is how a signed build is meant to
be produced, so until runners return the first build has to be made from a laptop with
`eas build`.

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

- **Mobile test coverage is thin but no longer absent.** 130 tests over the screens where a wrong assumption about a payload is invisible until a member hits it. The API has 108 and the web app has Playwright e2e.
- **The whole class of bug these guards exist for was real.** `get<T>()` is an unchecked assertion, and client paths are strings on one side and file names on the other, so six guards now run in CI: `tools/check_api_contract.py` (every call hits a route that accepts it), `tools/check_safety_target.py` (no client takes a safety action's subject from the profile snapshot the API empties on a closed conversation), `tools/check_query_keys.py` (no mutation invalidates a cache key no query uses, which React Query reports as success), `tools/check_upload_types.py` (every upload picker offers exactly what the endpoint its input posts to accepts, and the size the mobile app shrinks to is the size the server takes — five rounds of review on this one, because the two sides can drift at the shared type tuple, the call site, the branch discriminator, the declaration and the input itself), `apps/mobile/scripts/check-routes.js` (every navigation target *and* every path the API hands the app resolves to a screen), and `apps/mobile/scripts/check-native-config.py`. Each was written after a bug it would have caught shipped.
- **A failing CI run is readable through the API now.** This line twice said a red run was diagnosed blind, and twice that was because the job log is only reachable through a tool that returns its last few seconds and the Playwright HTML report is an artifact. A mobile failure that reported two failed tests and nothing about which ones is what settled it: both suites now add a reporter in CI that emits each failure as a `::error::` workflow annotation — `github-actions` for jest (`apps/mobile/jest.config.js`), `github` for Playwright (`apps/web/playwright.config.ts`). Annotations are readable through `repos/{owner}/{repo}/check-runs/{id}/annotations`, carry the file, line, test name and the expected-versus-received, and survive log retention. Verified by failing a test on purpose under both and reading what came out.
- **Upload size limits now agree with each other, and say so.** This line used to record the profile photo flow as unguarded, and the reason it mattered was worse than being unguarded. `create_media` refused a declared `size_bytes` over 15 MiB while `data_url` was capped at 15,000,000 *characters* — base64, so about 11.25 MB of file — so a photo between the two passed the first gate, which creates the row, and failed the second as a bare string-length error, which `app/main.py` renders as "Some fields need attention." That was the whole of what a member was told about an 11 MB photo, and on `POST /safety/reports/{id}/evidence` it was what somebody reporting harassment got for a screenshot. Both gates are now written from one number (`MAX_UPLOAD_BYTES` in `app/core/datauri.py`), the field length is deliberately above it so a request a little over reaches the check that can name the size, and the decoded bytes are what the row records rather than the client's claim — mobile was sending the picked asset's file size while uploading a re-encoded JPEG. The mobile profile flow shrinks to fit through the same `fitForUpload` the evidence flow uses, now shared in `apps/mobile/src/lib/upload.ts`: cropping to 4:5 at 0.8 quality bounds a 12-megapixel camera's output well under the cap and does nothing for a 50- or 200-megapixel one, because the editor crops at the source's resolution, so the member with the newest phone was the one who could not add a photo. `tools/check_upload_types.py` compares the client's limit with the server's. The web app is told the size plainly but does not resize in the browser; a desktop member with a 12 MB photo has to shrink it themselves. (`apps/api/tests/test_upload_limits.py`, `apps/mobile/test/profile-photo.test.tsx`.)
- **A failed upload used to cost a photo slot permanently.** `media_for` does not filter by `upload_state`, and the six-photo limit counted what it returned, so a row created and never completed — a connection lost partway through an 11 MB photo will do it — counted as a photo. Enough of those and the member was told they already had six photos while their profile showed two, with nothing to remove to get out of it, because an incomplete row has no URL and neither app shows it. The limit now counts photos that completed, which is also the only place it can be enforced honestly: nothing stops a client creating seven rows before completing any of them, so the gate that holds is at completion, and the one at creation is there for the message. Abandoned rows are swept after thirty minutes.
- **Messages poll instead of streaming.** Mobile refetches every 8s (`messages/[conversationId].tsx:42`); web uses `GET /realtime/token` and a WebSocket. Functional, slower, heavier on battery.
- **Over-the-air updates are wired, and the way they go wrong is guarded against.** `expo-updates` is installed at the version the SDK pins (`~57.0.23`), so a JavaScript-only fix reaches installed apps on their next launch instead of waiting on App Review — which matters for a product whose failure modes have included a safety notification that opened nothing. The dangerous part of OTA is not failing to work, it is working on a binary it does not fit: a bundle calling a native module the installed app lacks crashes at launch, and the member cannot get out of it because no screen loads. The runtime version decides that, and it is the `fingerprint` policy — EAS derives it from the native project, so a native change *is* a new runtime version whether anybody remembered to bump anything or not. `appVersion` and `nativeVersion` both leave it as a discipline requirement. Verified by running `expo prebuild` and reading what came out, which is also how the first version of the guard was caught asserting the wrong file: iOS keeps none of this in `Info.plist`, it is a separate `Expo.plist`. `eas.json` maps each build profile to a channel, `fallbackToCacheTimeout` is 0 so nothing blocks the splash screen, and updates stay off until `eas init` exists to form a manifest URL. (`apps/mobile/scripts/check-native-config.py`, now 24 checks — its total was a hand-maintained sum plus a literal 7, so it is counted as the checks run; docs/DEPLOY.md §5c.)
- **The legal pages still need a lawyer, but they can no longer ship with a hole in them unnoticed.** The 21 inline `TODO` markers are gone; each fact is declared once in `apps/web/src/app/legal/_facts.ts` and read from the environment. Two things were wrong with the markers beyond being unfinished: the entity name and the registered address each appeared twice, so filling them in could half-succeed and leave a privacy notice naming a controller the terms do not; and nothing failed because of them, so a submission with highlighted yellow gaps in three legal documents was a thing that could just happen. `tools/check_legal_facts.py` runs in CI against drift (a page naming a fact nobody declared) and, with `--require-all`, refuses to pass while any required fact is unset — which docs/DEPLOY.md §5b-bis says to run before a production build. It earned its keep immediately by catching a fact I had declared and never rendered. **Five are now answered by this repository** rather than asked of you: hosting and its region (`infra/fly/api.toml`), the AI provider and the payment provider (`app/core/config.py`), the check-in location retention (24 hours, the one period the code actually enforces), and whether there is an identity vendor — under `manual_review` there is not, and the notice said there was. **Twelve remain yours**, and one of them is a decision rather than a sentence: nothing deletes safety evidence today, on purpose, so whatever retention you state has to be implemented as well as written. Nothing here was invented — a governing law or an entity name I guessed at would be a fabricated legal document, which is worse than a visible gap.
- **A refresh interrupted mid-flight no longer signs the member out, and a replayed token now ends the sign-in.** This was recorded here as needing a security decision rather than a patch, between a short idempotent leeway (which means storing a refresh token in plaintext) and reuse detection (which signs both parties out on any replay). Both were the wrong question. The presented token is now *superseded* rather than revoked: it keeps working until its replacement's own token is used — which is the client proving it stored what it was given, normally a round trip later — or until a 120-second grace period expires. A retry inside that window mints a **fresh** replacement rather than re-serving one, which is the part the reverted attempt got wrong: re-serving is exactly what hands a second holder the live session. Nothing is stored in plaintext. Outside the window, or once the replacement has been used, a token coming back means two parties have held it, and every session descended from that sign-in is revoked at once (OAuth 2.0 Security BCP §4.13.2) with an audit row to say so. The overlap would otherwise be a takeover window — its whole purpose is the case where the real client is absent — so a spent token presented from a device the session was never issued to is read as the replay it is, immediately. Both clients send that device id on refresh; it is not carried inside the token, so a token that leaks on its own (a log line, a crash dump, a backup) does not bring it along. That is a sender constraint, not proof of possession: somebody who has the device id *and* the token still gets through, and the claim is only that a leaked token is no longer sufficient by itself. Chain state lives in a new `session_lineage` table because the schema is created and never altered. One bug worth recording from building it: the revocation ran and then vanished, because the refusal is an exception and `get_db` rolls back on one — the UPDATE executed, the warning logged, and the next request still succeeded. It commits before refusing now, and the test that caught it asserts the chain is actually down rather than that the call returned 401. (`apps/api/tests/test_refresh_rotation.py`, 8 tests; the interrupted-refresh one is confirmed failing against single-use rotation.)
- **Matching on gender and seeking has no consent of its own, and that is a question for the legal review rather than a bug to fix in code.** `hard_gate` calls `orientation_ok(a.member, b.member)`, which reads `Member.gender` and `Member.seeking` — who somebody is and who they want — for every pair in every batch. The `special_category` consent exists, but onboarding asks for it as "I may choose to share faith for matching", off by default, so most members never grant it and are matched anyway. Review flagged this as orientation data processed without consent and proposed excluding those members from matching; that would stop introductions for nearly everybody and contradict what onboarding says the toggle is for, so it is recorded here instead. The mobile consent screen, which claimed this consent covered sexual orientation and that withdrawing it stopped new introductions, has been corrected to describe what actually happens. What needs deciding by somebody qualified: whether Art. 9 covers these two fields as collected, and if so whether the basis is a separate explicit consent in onboarding, Art. 9(2)(e) data made public by the member, or a change to what is collected.
- **A date's time now reads the same in both apps, in the venue's zone, with the zone named.** This was recorded here as a product decision, and the decision has been taken: a date is a physical meeting at a venue, so "19:00" means 19:00 on the venue's clock — the time the table is held and the time to arrive by — and the reader's own clock is shown beside it when they differ. Auditing it to make that change turned up something this line had wrong: the two apps did not agree. Web rendered the plan's zone; mobile rendered the *device's*, via `new Date(...).toLocaleString()`, on the date detail, the dates list, the check-in card, the conversation header and the Messages list — so one date showed two different clock faces, neither of them labelled. And `DatePlan.timezone` was `member.timezone` copied from whoever opened the planner first, which is a value with no relationship to where they are going to meet: a member who moves to London and updates the setting both apps offer could propose a Rome venue and have *both* of them shown London time for it. It is the market's zone now — the venue's — so it no longer depends on who tapped first (`app/core/timeutil.py:market_timezone`), and `date_status` carries it so the Messages screens can be right too. One helper in each app (`formatPlanTime`) renders it, and it takes the viewer's zone as an argument because under jest `process.env.TZ` does not reach `Intl` — which had quietly pinned every assertion to UTC. The other half of the distinction is that a *history* entry is not a date: "you proposed this at 14:05" belongs on the reader's clock, and `PlanHistory` was rendering it in the venue's. (`apps/api/tests/test_cross_timezone.py`, `apps/mobile/test/plan-time.test.ts`.)
- **No store screenshots** anywhere in the repo.

---

## D. What is done, and solid

- **Backend**: 92 member endpoints, 108 tests green. Schema creation race fixed with a Postgres advisory lock. Email transport with a production boot guard. Sandbox payment and verification endpoints correctly 404 in production.
- **Web app**: complete — 60 routes and 84 of 92 member endpoints, Playwright e2e, legal pages.
- **Mobile**: 44 screens and 81 of 92 member endpoints. Onboarding end to end; Today; introductions with explanation, correction, extension and private decision; the mutual screen; messaging with AI drafts and translation; date proposal, response, venues, confirmation, check-in, feedback and the second-date reveal; the safety centre with report, evidence, case tracking, blocks and unblock; account review and appeals; profile, preferences and blueprint editing; consent withdrawal; availability and readiness; language and time zone; block and report from inside a conversation; export, pause and delete; notifications inbox; push registration.
- **Build pipeline**: native config generated and asserted (20 checks), placeholder API origins and missing EAS project ids refused before a build starts, EAS build workflow. One thing to know before the first production build: `apps/mobile/eas.json` was standardised on `main` in #41 and no longer carries the `EXPO_PUBLIC_API_ORIGIN` and `EXPO_PUBLIC_EAS_PROJECT_ID` placeholders, so those have to be supplied as EAS environment variables. `app.config.ts` still refuses a production build without them — which is the point of that guard — so the build fails loudly rather than shipping a binary pointed at nothing.
- **Guards that would have caught what shipped**: the API contract check, the route check (including every path the API hands a client), and the native config check, all in CI. Each was verified by breaking the thing it checks and confirming it fails.

---

## E. Order I would do this in

1. A real identity vendor, or an explicit decision to run manual review for the pilot. Nothing else matters while nobody can finish signing up.
2. SMTP provider plus SPF/DKIM/DMARC. Deploy the API.
3. IAP, if you intend to charge on mobile at launch. Otherwise ship free and add it later — but then the paid tiers do not exist on mobile.
4. Legal review of the three documents, and store screenshots.
5. Turn GitHub Actions back on (A4). It is first in practice rather than fifth — until it runs, nothing above can be checked by anything but a laptop, and the EAS build workflow cannot run at all.

Every one of these needs an account or a decision only you can supply. Nothing on this list is
waiting on code.
