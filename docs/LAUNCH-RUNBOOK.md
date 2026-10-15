# Launch runbook

Everything still standing between the code and two store listings, in the order it has to happen,
with the link for each step and how to tell it worked.

Ordered by **lead time, not effort**. Steps 1 and 2 take minutes of your attention and then days
of somebody else's, so they go first even though step 3 is the one you want to see.

Nothing in here is code. The code is done and on `main`; see `STORE-SUBMISSION.md` for what the
app does and `STORE-PRIVACY-ANSWERS.md` for the privacy questionnaires.

---

## 0. First, the thing blocking everything else

**GitHub Actions is dead.** Every job has failed in 2–3 seconds since 9 October with no runner
assigned and no logs — the signature of a spending limit or a billing problem, not a code fault.
It blocks CI, the image publish, and the EAS build workflow.

- Billing → <https://github.com/settings/billing>
- Spending limit → <https://github.com/settings/billing/spending_limit>
- Watch a run recover → <https://github.com/BHDossantos/LOVERA/actions>

**Done when:** a run on <https://github.com/BHDossantos/LOVERA/actions> takes minutes rather than
seconds and produces logs.

While you are there, install the GitHub App so I get told about CI failures and reviews instead of
you having to relay them: <https://github.com/apps/claude/installations/select_target>

---

## 1. Apple and Google accounts — start today, they take days

Both charge, both verify identity, and both make you sign agreements before you can sell anything.
This is the long pole. Everything else waits on it.

| | Link | Cost | Lead time |
| --- | --- | --- | --- |
| Apple Developer Program | <https://developer.apple.com/programs/enroll/> | $99/year | 24–48h, longer for a company (needs a D-U-N-S number) |
| Google Play Console | <https://play.google.com/console/signup> | $25 once | 1–3 days, identity verification |

Then, **before** you can sell a subscription:

- **Apple** — sign the Paid Applications agreement and fill in banking and tax:
  <https://appstoreconnect.apple.com/agreements>. Until this says Active, in-app purchases do not
  work even in sandbox.
- **Google** — set up a payments profile in the Play Console under Setup → Payments profile.

**Done when:** Apple's agreement shows Active and Play shows a verified payments profile.

> If you want to launch *without* selling on mobile, you can skip the agreements for now. The app
> is fully submittable with purchases off — it serves free members and people who subscribed on the
> web, and shows no upgrade path. That is the default (`MM_STORE_VALIDATION=disabled`).

---

## 2. Deploy, so the live site is the app you are submitting

`main` has had the redesign, the pricing ladder and the new endpoints since 10 October.
joinlovera.com is still serving the build from before that.

Install flyctl if you have not: <https://fly.io/docs/flyctl/install/> · dashboard:
<https://fly.io/dashboard>

```bash
fly auth login
fly apps list            # your three app names go in the commands below
```

Deploy **the API first, then the web**, and do both in the same sitting:

```bash
fly deploy --config infra/fly/api.toml    --app <your-api-app>
fly deploy --config infra/fly/worker.toml --app <your-worker-app>
fly deploy --config infra/fly/web.toml    --app <your-web-app> \
  --build-arg API_ORIGIN=https://<your-api-app>.fly.dev \
  --build-arg NEXT_PUBLIC_WS_URL=wss://<your-api-app>.fly.dev/v1/realtime/ws
```

**Order matters.** This release adds endpoints the new screens call
(`/subscriptions/checkout/{ref}`, `/subscriptions/store-purchase`, `/conversations/{id}/openers`)
and changes the shape of `/plans`. A new web against an old API gives you a half-broken membership
page.

**Two new tables** (`billing_terms`, `store_purchases`) are created automatically when the API
starts. There is no migration step — that is why both were built as new tables rather than columns.

Verify:

```bash
curl -sS https://<your-api-app>.fly.dev/healthz        # {"ok":true,"env":"production"}
curl -sS -o /dev/null -w '%{http_code}\n' https://<your-web-app>.fly.dev/welcome
```

**Done when:** joinlovera.com/welcome opens on a **dark hero** with a rose "Send me a code" button.
If it is still cream with a teal button, the web deploy did not take.

---

## 3. Production sign-in actually works

The API refuses to start in production with no mail host, which is deliberate — sign-in is a
one-time code by email, so no mail means nobody can get in.

Set on the API app: `MM_SMTP_HOST`, `MM_SMTP_PORT`, `MM_SMTP_USERNAME`, `MM_SMTP_PASSWORD`,
`MM_MAIL_FROM`.

Then add **SPF, DKIM and DMARC** records for the sending domain. Without them a dating app's mail
goes to spam, which looks exactly like broken sign-in. Your mail provider gives you the three
records; your DNS host is where they go.

**Done when:** you request a code at joinlovera.com/welcome from an address you own and it arrives
in the inbox, not spam.

---

## 4. The legal pages, which a reviewer will open

Both stores require a reachable privacy policy URL. Yours exists at `/legal/privacy` but still has
operator facts unset — they render as visible gaps.

```bash
python tools/check_legal_facts.py --require-all     # lists exactly what is missing
```

Eighteen facts, twelve of which need you. They are environment variables on the **web** app, all
prefixed `NEXT_PUBLIC_LEGAL_`: `ENTITY`, `ADDRESS`, `JURISDICTION`, `GOVERNING_LAW`,
`CONSUMER_LAW`, `MARKETS`, `SUPPORT_EMAIL`, `PRIVACY_EMAIL`, `SAFETY_EMAIL`, `TRANSFER_MECHANISM`,
`SAFETY_RETENTION`, `AUDIT_RETENTION` (plus `DPO` if you have one). The other five are derived from
the code.

**Have a lawyer read the result.** The drafts are careful and they are not legal advice.

**Done when:** `--require-all` exits 0 and `/legal/privacy` has no gaps in it.

---

## 5. The store products

Create these four, with **the same identifiers on both stores**. Two sets of names for the same
four things is how a receipt grants the wrong tier.

| Product ID | Plan | Term | Price |
| --- | --- | --- | --- |
| `pro_monthly` | Matchmaker Pro | monthly | €39.00 |
| `pro_annual` | Matchmaker Pro | annual | €390.00 |
| `concierge_monthly` | Concierge | monthly | €89.00 |
| `concierge_annual` | Concierge | annual | €890.00 |

- Apple → <https://appstoreconnect.apple.com>, your app → Monetization → Subscriptions. Put Pro and
  Concierge in **one subscription group** so members can move between them.
- Google → <https://play.google.com/console>, your app → Monetize → Products → Subscriptions.

A product the store has no price for simply gets no button, so you can launch with Pro only and add
Concierge later. Nothing breaks.

**Done when:** all four are Ready to Submit / Active.

---

## 6. Turn purchases on (only if you want to sell on mobile at launch)

1. RevenueCat account → <https://app.revenuecat.com>. Create a project, connect both stores, and
   copy the **public** SDK keys (Project settings → API keys). These are designed to ship in a
   client binary — they can start a purchase and read entitlements, and cannot refund, grant, or
   read anybody else's data. The secret key stays on the server and is not referenced in the app.
2. Set on the mobile build: `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`.
3. Set on the API: `MM_STORE_VALIDATION`.

**`MM_STORE_VALIDATION` is not finished.** `sandbox` trusts the receipt and is refused outright in
production. `app_store` and `play_store` mean real verification against Apple's and Google's
servers — **that code is not written**, and the endpoint refuses rather than pretending to succeed,
because a stub there is the bug whose symptom is everybody getting Concierge for nothing.

So today the honest options are: launch with purchases off, or ask me to write the verification
(about a day's work) first.

**Done when:** `GET /v1/plans` returns `store.enabled: true` and the membership screen shows the
store's own price on the button.

---

## 7. Build the app

<https://expo.dev> · access tokens: <https://expo.dev/settings/access-tokens> · docs:
<https://docs.expo.dev/build/setup/>

```bash
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest init          # creates the EAS project, writes the project id
npx eas-cli@latest build --profile production --platform all
```

Set `EXPO_PUBLIC_API_ORIGIN` as an EAS environment variable for each profile, pointing at your
production API. A build without it fails deliberately rather than shipping a binary that cannot
reach anything.

To build from CI instead, add an `EXPO_TOKEN` repository secret
(<https://github.com/BHDossantos/LOVERA/settings/secrets/actions>) and run the **Mobile build**
workflow — which needs step 0 done first.

**Done when:** an `.ipa` and an `.aab` exist in your EAS dashboard.

---

## 8. Screenshots

Both stores require them and neither accepts a mockup with a device frame drawn on.

- **Apple:** 6.7" iPhone (1290×2796) is the only required size; others are derived. 3–10 shots.
- **Google:** 2–8 phone screenshots, plus a 1024×500 feature graphic and a 512×512 icon.

Take them from a simulator running the production build. The five worth showing, in order: the
welcome hero, Today, an introduction with its reasons, a conversation, and the membership
comparison. I cannot take these — there is no simulator in my environment.

---

## 9. The store listings

- **Apple App Privacy** → App Store Connect, your app → App Privacy. Every answer is written out in
  `docs/STORE-PRIVACY-ANSWERS.md` §2. It must match the privacy manifest in the binary; a reviewer
  compares them.
- **Play Data safety** → Play Console → Policy → App content → Data safety. Answers in
  `STORE-PRIVACY-ANSWERS.md` §3, including the one location judgement call I flagged rather than
  buried.
- **Age rating:** 18+ on both. Answers in §5.
- **Play app category:** Dating. This triggers extra questions about user-generated content and
  moderation — §5 has those answers too.
- **Review notes:** give the reviewer a working test account that is already verified and has an
  introduction waiting. A reviewer who hits the verification wall will reject for "incomplete
  functionality" (guideline 2.1). This is the single most common rejection for apps like this one.

---

## Order of play

```
0. GitHub Actions billing        ← minutes, unblocks CI
1. Apple + Google accounts       ← start now, days of waiting
2. fly deploy (API then web)     ← makes the live site the app you are submitting
3. SMTP + SPF/DKIM/DMARC         ← without it nobody can sign in
4. Legal facts + lawyer          ← a reviewer opens the privacy policy
5. Store products                ← needs 1
6. RevenueCat + MM_STORE_VALIDATION   (optional for launch)
7. EAS build                     ← needs 1
8. Screenshots                   ← needs 7
9. Listings + submit             ← needs everything
```

Steps 0–4 are independent of Apple and Google and can all happen while you wait on them.

---

## What I can do once you have moved

- **After 0:** take PRs [#45](https://github.com/BHDossantos/LOVERA/pull/45) and
  [#46](https://github.com/BHDossantos/LOVERA/pull/46) to green and merge them.
- **After 2:** verify every live page and re-run the end-to-end journeys against production.
- **Any time:** write the App Store and Play receipt verification in step 6.
- **Any time:** draft the listing copy — title, subtitle, description, keywords.
