# Launch readiness

Audited against the code on `main`, not from memory. Every claim below names the file or
endpoint it came from, so you can check any line of it.

**Verdict: not ready.** Two things stop the product working at all in production, and the
mobile app reaches 45 of the 92 member-facing API endpoints the web app reaches 83 of.

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

## B. The mobile app is missing features the web app has

Measured by comparing `@router` declarations in `apps/api/app/modules/*/router.py`
against every path literal in `apps/web/src` and `apps/mobile`:

| | member endpoints reached |
|---|---|
| Web | 83 / 92 |
| Mobile | 45 / 92 |

### B1. Getting to an actual date — the point of the product

Missing: `POST /date-plans/{id}/proposals`, `/respond`, `/cancel`, `GET /overlaps`,
`GET /venues`. Mobile can *view* a date and confirm one, but cannot propose one. The
dates screen's own empty state promises otherwise:

> "Once a conversation is ready, either of you can propose a public venue and a window."
> — `apps/mobile/app/(app)/dates/index.tsx:37`

### B2. Date safety check-in

Missing: `POST /date-plans/{id}/check-in`, `/check-in/now`. This is the "are you safe"
flow for someone meeting a stranger. Of everything on this list it is the one I would
least want absent from a dating app at launch.

### B3. The AI features the product is named after

Missing: `POST /conversations/{id}/ai-drafts`, `/translations`. Present on web.

### B4. Membership — and nothing to buy with

Missing: `GET /plans`, `GET /subscriptions/current`, `POST /subscriptions/checkout`,
`POST /subscriptions/cancel`. There is also no in-app purchase code anywhere in the repo.

Two separate pieces of work: the screens, and StoreKit/Play Billing. Apple requires IAP
for digital subscriptions (guideline 3.1.1) — a web checkout link inside the app is a
rejection. As it stands the app sells nothing, which is *compliant* but means the paid
intro caps (`weekly_intro_cap_paid`) are unreachable on mobile.

### B5. Profile editing after onboarding

`ProfileEditor` is used in exactly one place — `app/onboarding/profile.tsx`. Once a member
is active they cannot change their photos, bio or prompts from the app, and
`DELETE /profile/media/{id}` is never called, so a photo cannot be removed. Basic
expectation of any dating app.

### B6. Preferences and blueprint

Missing: `GET/PATCH/DELETE /preferences`, `POST /preferences/impact-preview`,
`GET /blueprint/current`, `POST /blueprint/signals/{key}`. A member cannot adjust what
they are matched on after onboarding.

### B7. Consent cannot be withdrawn — a compliance gap, not just a feature gap

Missing: `PUT /consents/{purpose}`. Mobile onboarding collects special-category consent
(sexual orientation, and optionally faith) and offers no way to withdraw it. GDPR Art.
7(3) requires withdrawal to be as easy as giving it.

### B8. Smaller but real

- `GET /notifications`, `POST /notifications/read` — push tokens are registered, but there is no in-app notifications list.
- `POST /conversations/{id}/close` — a conversation cannot be ended from the app.
- `DELETE /blocks/{member_id}` — blocks are listed with no action, so nobody can be unblocked. Blocking itself only exists *inside* the report flow (`block_now`, default on), so Apple's guideline 1.2 block requirement is met; standalone `POST /blocks` is not reachable.
- `GET /account/review` + `/appeal` — a restricted member cannot appeal from the app.
- `GET /me/export/{request_id}` — an export can be requested but not downloaded.
- `GET /introductions/waiting`, `POST /{id}/extend`, `/correction`, `/explanation-viewed`.

---

## C. Quality gaps

- **No mobile tests.** The API has 45 passing tests and the web app has Playwright e2e. `apps/mobile` has none: CI typechecks it and bundles it, which proves it compiles, not that any screen works.
- **Messages poll instead of streaming.** Mobile refetches every 8s (`messages/[conversationId].tsx:42`); web uses `GET /realtime/token` and a WebSocket. Functional, slower, heavier on battery.
- **No over-the-air updates.** `expo-updates` is not installed, so every fix after launch is a full store review.
- **Legal pages carry 21 `TODO` markers** across terms (8), privacy (11) and community (2), and have had no legal review.
- **No store screenshots** anywhere in the repo.

---

## D. What is done, and solid

- **Backend**: 92 member endpoints, 45 tests green. Schema creation race fixed with a Postgres advisory lock. Email transport with a production boot guard. Sandbox payment and verification endpoints correctly 404 in production.
- **Web app**: complete — 60 routes, Playwright e2e, legal pages.
- **Mobile**: onboarding end to end, Today, introductions with explanation and decision, messaging, dates view and confirm, safety report with block, data export, pause, delete, push registration.
- **Build pipeline**: native config generated and asserted (20 checks), placeholder API origins and missing EAS project ids refused before a build starts, EAS build workflow.

---

## E. Order I would do this in

1. A real identity vendor, or an explicit decision to run manual review for the pilot. Nothing else matters while nobody can finish signing up.
2. SMTP provider plus SPF/DKIM/DMARC. Deploy the API.
3. Mobile: date proposal and response, then date check-in. This is the product's purpose and its most important safety feature.
4. Mobile: profile editing, preferences, consent withdrawal, unblock. The first is expected, the last two are compliance.
5. Mobile: AI drafts and translation, notifications inbox, conversation close.
6. Mobile tests covering the journeys that now have none.
7. IAP, if you intend to charge on mobile at launch. Otherwise ship free and add it later — but then the paid tiers do not exist on mobile.
8. Legal review of the three documents, and store screenshots.

Items 1, 2, 7 and 8 need decisions or accounts only you can supply. The rest is code.
