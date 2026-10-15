# Shipping Lovera to the App Store and Google Play

Everything here is either done, or is something only the account holder can do.
The second kind is marked **You**.

Dating apps are reviewed harder than almost any other category. Most rejections
are not about code — they are about a missing policy answer, an age rating that
does not match the content, or a reviewer who could not get past sign-in. This
document is ordered so that none of those happen.

---

## 1. What is already in the app

| Store requirement | Where it lives |
|---|---|
| 18+ gate before any profile is visible | `app/onboarding/account.tsx`, enforced server-side by `/me/adult-consent` |
| Identity verification for every member | `app/onboarding/verification.tsx` |
| In-app account deletion, not a support email | `app/(app)/you/index.tsx` → `DELETE /v1/me`, with a grace period and a visible way to cancel |
| Report a person, one tap from anywhere | `app/safety/report.tsx` |
| Block a person, immediate and silent | Same screen, `block_now` |
| Case status visible to the reporter | `app/safety/cases/[caseId].tsx` |
| Moderation of user photos before display | `profile/media` moderation state |
| Terms, Privacy and Community Agreement reachable in-app | `app/(app)/you/legal.tsx` |
| No precise location collected | `blockedPermissions` in `app.config.ts` |
| Permission purpose strings in plain language | `ios.infoPlist` and the `expo-image-picker` plugin |

Apple's guideline 1.2 (user-generated content) requires a method for filtering
objectionable material, a mechanism to report it, the ability to block abusive
users, and published contact information. All four are present. Google Play's
policy for social and dating apps asks for the same set.

---

## 2. Before you can build

Most of this is done. What exists, so nobody redoes it:

| Thing | Value | State |
| --- | --- | --- |
| Apple Team ID | `XLRMB5G792` | — |
| App ID (identifier) | `com.joinlovera.app`, Push Notifications capability only | Registered |
| App Store Connect app | **Lovera**, SKU `lovera` | Created |
| App Store Connect API key | `GNB9AWW5WM` | Uploaded to Expo |
| APNs key | `673H6R39JM` | Team-scoped, reusable |
| Play app | **Lovera**, `com.joinlovera.app` | Draft |
| Play upload service account | `lovera-eas-submit@lovera-511722.iam.gserviceaccount.com` | Active in Users and permissions |

The bundle identifier and the Android package are the same string by design, and both are now
bound to their listings permanently.

**What is left**

1. **Give the Play service account its permissions.** Being listed under *Users and permissions*
   is not the same as being allowed to upload. Play Console → Users and permissions → that
   account → Manage → *App permissions* → add **Lovera**, and grant **Release apps to testing
   tracks** and **View app information**. Without the first, `eas submit` fails at the upload with
   a permission error that names neither the account nor the missing right.
2. **Hand the JSON key to EAS** so submissions do not depend on a file on one laptop:
   ```bash
   cd apps/mobile
   npx eas-cli@latest credentials -p android
   # → Google Service Account
   # → Set up a Google Service Account Key for Play Store Submissions
   ```
   Point it at the JSON you downloaded. EAS stores it server-side; `eas submit` then works from
   any machine and from an EAS Workflow run, which is what `.eas/workflows/deploy.yml` needs.

   If you would rather keep it local, save it as `apps/mobile/play-service-account.json` — that
   exact filename is gitignored — and add `serviceAccountKeyPath` under
   `submit.production.android` in `eas.json`. **Never commit it.** Anyone holding that key can
   publish to your listing, and deleting it in a later commit does not help: it is still in the
   history. If that happens, revoke the key in Google Cloud and issue a new one.
3. **Create the Android upload keystore** (EAS generates and keeps it; losing it later means a new
   listing, so let EAS hold it rather than a laptop):
   ```bash
   npx eas-cli@latest credentials:configure-build -p android -e production
   ```
4. **Create the EAS project** and note the id:
   ```bash
   npx eas-cli@latest login
   npx eas-cli@latest init          # prints a project ID
   ```
   That id goes in `EXPO_PUBLIC_EAS_PROJECT_ID` (§3). Push tokens cannot be issued without it, and
   `app.config.ts` refuses a shipping build that does not have it — deliberately, because the
   failure it prevents is silent.

---

## 3. Point the app at the real API — **You**

Set `EXPO_PUBLIC_API_ORIGIN` and `EXPO_PUBLIC_EAS_PROJECT_ID` as EAS environment
variables for each profile you build. `eas.json` used to carry `REPLACE-ME` values for
both; it was standardised in #41 and no longer has `env` blocks at all, so the values
have to come from EAS (or your shell, for a local `expo export`).

You cannot forget this. Expo inlines both values at bundle time, so a binary built
against a placeholder installs, launches, and then fails every request — or never
receives a push — and nothing on the device says why. So `app.config.ts` refuses
to produce a config for any profile other than `development` unless the origin is
a real `https://` host and the project ID is a real one. The build stops in seconds
instead of at a reviewer's device:

```
EXPO_PUBLIC_API_ORIGIN is not an address anyone else can reach for the
"production" profile: https://your-api.example.com
Every request in this build would fail. Set EXPO_PUBLIC_API_ORIGIN for the
"production" profile in eas.json and build again.
```

It rejects an absent value, anything that looks like a placeholder, a loopback or
private address, and plain `http://` — the last because release builds block
cleartext on both platforms, so an `http` origin is unreachable even if the host
is real. CI exercises all eight cases on every push.

---

## 3a. What the native projects actually say

`app.config.ts` is not what the stores read. Expo's prebuild turns it into an
`AndroidManifest.xml` and an `Info.plist`, and the two can disagree — a plugin
adds a purpose string on your behalf, a permission you blocked returns through
manifest merging, an unconfigured splash falls back to white. None of that is
visible in the config file.

```bash
cd apps/mobile
npm run check:native     # prebuild, then assert what came out
```

This needs no Android SDK and no Xcode; it only generates the project files and
reads them. CI runs it on every push, and it is how the following were found and
fixed rather than discovered during review:

| Found in the generated config | Why it mattered |
|---|---|
| `NSMicrophoneUsageDescription`, boilerplate text | The image picker adds it for video capture. We take stills, so the app declared a permission with a generic string describing a feature a reviewer cannot find — guideline 5.1.1. |
| `NSFaceIDUsageDescription`, boilerplate text | Added by expo-secure-store. We never gate the token behind biometrics. |
| `SYSTEM_ALERT_WINDOW` | React Native's default. Draw-over-other-apps on a dating app invites questions we have no answer to, because we draw no overlays. |
| `WRITE_EXTERNAL_STORAGE` | The image picker's default. We write nothing to shared storage. |
| `allowBackup="true"` | Conversations, introductions and photos were eligible for a cloud backup neither the member nor we can audit. Now `false`. |
| Splash background `#FFFFFF` | `assets/splash-icon.png` was never wired up, so the app opened on a white flash instead of the brand cream. |

---

## 4. Build and submit

```bash
cd apps/mobile
npm run build:android     # eas build -p android --profile production
npm run build:ios         # eas build -p ios --profile production
npm run submit:android    # uploads to the internal track
npm run submit:ios        # uploads to App Store Connect
```

EAS builds iOS on its own macOS machines, so no Mac is needed. The first build
of each platform asks to generate signing credentials — say yes and let EAS
manage them; hand-managed certificates are the single most common cause of a
broken release six months later.

**Or build from CI instead.** `.github/workflows/mobile-build.yml` runs the same
thing from Actions → *Mobile build* → *Run workflow*, with a choice of platform
and profile and an explicit opt-in to submit. It needs one repository secret,
`EXPO_TOKEN`, from expo.dev → Account settings → Access tokens. It is manual on
purpose: a store build consumes build quota, increments a version, and on the
production profile is something you intend to submit — none of which should
happen because somebody pushed a commit. Before spending twenty minutes on a
remote build it reads `eas.json` for the chosen profile and runs the same guards
as §3, so a placeholder fails in seconds.

**Google Play's testing requirement.** A newly created *personal* developer
account must run a closed test with at least 12 testers opted in for 14
continuous days before production access is granted. Organisation accounts are
exempt. If this account is personal, start that closed test on day one — it is
a two-week wall-clock delay that no amount of engineering removes.

---

## 5. Age rating and content declarations

**Apple — set to 18+.** Not 17+. A dating app with unmoderated member-to-member
messaging and user photos rates 18+, and under-rating is a guaranteed rejection
that costs a full review cycle. Answer the questionnaire:

| Question | Answer |
|---|---|
| Unrestricted web access | No |
| Gambling / contests | No |
| Medical/treatment info | No |
| Sexual content or nudity | None — profile photos are moderated |
| Mature/suggestive themes | Infrequent/Mild |
| Dating app | **Yes** |

**Google Play** — complete the IARC questionnaire; declare social interaction,
user-to-user communication, and sharing of user-provided content. Expect
**Mature 17+** or equivalent by region.

---

## 6. Data safety and privacy answers

The two stores ask the same questions in different shapes. These answers must
match what the code actually does — a mismatch found later is treated as a
misrepresentation, not a typo.

### Collected, linked to identity
| Data | Purpose | Deletable |
|---|---|---|
| Email address | Account, sign-in | Yes, via account deletion |
| Date of birth | 18+ gate, showing age | Yes |
| Coarse location (city + zone, never GPS) | Distance bands for matching | Yes |
| Photos | Profile | Yes |
| Free-text profile and Blueprint answers | Matching | Yes |
| Messages | The conversation itself | Yes |
| Sexual orientation ("seeking") | Matching | Yes |
| Faith, **only if explicitly opted in** | Matching | Yes |
| Device push token | Notifications | Yes, revoked on sign-out |

### Not collected
Precise location, contacts, browsing history, advertising identifiers,
biometrics. Identity documents are checked by the verification vendor and never
reach our servers — declare them under the **vendor's** processing, not ours.

### Not done at all
No tracking across other companies' apps or sites. No data sold. No data shared
with data brokers. No advertising SDKs. Apple's App Privacy section should show
**Data Not Used to Track You**, and `NSUserTrackingUsageDescription` says so
plainly.

Sexual orientation and faith are *special category* data under GDPR. Faith is
opt-in and can be withdrawn without deleting the account — that is what the
`special_category` consent switch does, and it is worth saying so in the listing.

---

## 6a. Known dependency advisories

`npm audit` in `apps/mobile` reports 10 moderate advisories. None is fixable today
without breaking something worse, and none affects the shipped app. Recorded here
so the next person does not rediscover it, and does not "fix" it badly.

**Do not run `npm audit fix --force` in `apps/mobile`.** npm's resolver proposes
`expo@46` and `expo-router@5` as the "fix" — those are downgrades of eleven and
fifty-two major versions from the SDK 57 we run. It would destroy the app to
silence a warning. This is also why Dependabot's security-update run fails on
this directory rather than opening a PR: there is no forward fix.

**uuid 7.0.3 — [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), affects <11.1.1.**
Reached only as `expo → @expo/config-plugins → xcode → uuid`. `xcode` edits Xcode
project files during prebuild, so this is build tooling and is never bundled into
the app a member installs. Nine of the ten remaining advisories are this one path.
No action.

**decode-uri-component 0.2.2 — [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr), affects ≤0.4.2.**
Reached as `expo-router → query-string → decode-uri-component`, which *is* runtime:
expo-router parses URLs when a deep link opens the app. Denial of service via
exponential decoding of malformed percent-encoded input.

I tried to fix this and backed it out. The only published version above the
vulnerable range is 0.5.0, which is ESM-only (`"type": "module"`, no `main`),
while `query-string@7.1.3` consumes it through a CommonJS `require()`. An
`overrides` pin to 0.5.0 installs, typechecks and bundles green — but I could not
confirm from the emitted bundle that Metro's interop hands `require()` a callable
function rather than a module namespace. If it does not, deep-link parsing throws
a TypeError, which breaks the path a member takes when they tap a push
notification. Trading a conditional client-side hang for a possible hard break in
the push-to-app path is a bad trade, so the override is not in the tree.

Real-world exposure: a member must be induced to open a crafted link, and the
worst outcome is their own app spinning. No data is exposed.

**Re-check when** `query-string` moves to a `decode-uri-component` above 0.4.2, or
`expo-router` drops `query-string` — then take the fix. Verify with a real
deep-link open on a device, not just a green bundle.

## 7. The name and the bundle ID — decided

Both of these were permanent from the first upload, so they are recorded here rather than left as
an open question.

**The name is Lovera.** The working title, "AI Matchmaker", was descriptive rather than
distinctive — weak as a trademark, awkward in search, and carrying an "AI" claim that Apple has
been reviewing more sceptically where it is doing marketing work. The rename went through the
whole repository: app config, permission strings, mail sender, brand assets, the generated iOS
target name, and the native-config checks that assert it.

**The bundle ID is `com.joinlovera.app`**, on both platforms, overridable only by
`EXPO_PUBLIC_BUNDLE_ID` for a developer's own build. It is bound to both listings now; changing it
means a new listing with no reviews and no ranking.

---

## 8. In-app purchase — built, and off until you switch it on

Both stores require their own billing for digital subscriptions. Our paid plans
are digital subscriptions, so selling them through our own checkout inside the
app is a rejection under App Store guideline 3.1.1, and linking out to a web
checkout is a rejection too. The commission is 15–30% depending on tier and
region.

**The integration is now in the repository.** It is deliberately inert until you
do the four things below, and until all four are true the app shows no purchase
UI at all — not a disabled button, not a "coming soon", nothing. That is both the
honest state and the compliant one: a purchase path that does not work is a
guideline 2.1 rejection on its own.

### What is built

| Piece | Where |
| --- | --- |
| Product ids → plan and cadence | `apps/api/app/catalog/plans.py` (`STORE_PRODUCTS`) |
| Receipt endpoint, idempotent on the store's transaction id | `POST /v1/subscriptions/store-purchase` |
| Refusal when no validator is configured | `billing/service.record_store_purchase` |
| Whether the phone may offer a purchase | `GET /v1/plans` → `store.enabled` |
| Client wrapper, purchase and restore | `apps/mobile/src/lib/purchases.ts` |
| Purchase UI, gated on all four preconditions | `apps/mobile/app/(app)/you/membership.tsx` |

The server grants the plan; the client never decides its own entitlements. An
unverified receipt is **never** honoured, and there is no setting that makes the
API trust a client-asserted receipt in production — `MM_STORE_VALIDATION=sandbox`
is refused outright once `MM_ENV=production`. The worst outcome of that is that
nobody can buy. The worst outcome of the alternative is that everybody has
Concierge for nothing.

### The four things you have to do

1. **Create the products.** In App Store Connect and the Play Console, with
   these exact identifiers on both stores:

   | Product id | Plan | Term |
   | --- | --- | --- |
   | `pro_monthly` | Matchmaker Pro | monthly |
   | `pro_annual` | Matchmaker Pro | annual |
   | `concierge_monthly` | Concierge | monthly |
   | `concierge_annual` | Concierge | annual |

   Use the same ids on both stores. Two sets of names for the same four things
   is how a receipt ends up granting the wrong tier. A product the store has no
   price for simply gets no button, so you can launch with two and add two later.

2. **Sign the banking and tax agreements.** Paid apps cannot sell anything until
   these are complete, and they take days, not minutes. Start them first.

3. **Set the RevenueCat public SDK keys** on the build:
   `EXPO_PUBLIC_REVENUECAT_IOS_KEY` and `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`.
   These are the *public* keys, designed to ship in a client binary — they can
   start a purchase and read entitlements and cannot refund, grant, or read
   anybody else's data. The secret key stays on the server and is not referenced
   anywhere in the app.

4. **Set `MM_STORE_VALIDATION`** on the API. `sandbox` for simulator testing in a
   non-production environment; `app_store` / `play_store` for real verification —
   which is the one piece still to be written, and the endpoint says so rather
   than quietly succeeding.

### What is not done

Server-side receipt verification against Apple's and Google's servers
(`MM_STORE_VALIDATION=app_store` / `play_store`) is not implemented. The endpoint
refuses rather than stubbing a success, so the gap cannot be shipped by accident.
Until it is written, the compliant launch posture is in-app purchase off
(`MM_STORE_VALIDATION=disabled`, which is the default): the mobile app serves
free-tier members and people who already subscribed on the web, and offers no
upgrade path, which is fully submittable.

**Not verified here:** the native module (`react-native-purchases`) has been
installed, autolinks, and survives `expo prebuild` and all 24 native-config
checks, but no iOS or Android binary has been compiled in this environment. The
first EAS build is the first real compile.

---

## 9. What the reviewer needs — **You**

A dating app that a reviewer cannot get into is rejected within hours, and
"sign-in requires an emailed code" is exactly the kind of thing that stops them.

**Provide a demo account** in App Store Connect → App Review Information, and
in Play Console → App access. It must be a real, fully-onboarded, verified
member with at least one introduction and one conversation visible, so the
reviewer sees the actual product rather than an empty state.

Because sign-in is a one-time emailed code, the reviewer cannot receive it.
Either:
- give them a mailbox they can read, or
- provision a demo account whose code is fixed, documented in the review notes.

The second is safer. Whichever you choose, say so explicitly in the notes.

**Review notes — paste this in:**

> Lovera is an invite-only, verified dating service. Sign-in uses a
> one-time code sent by email; the demo account below accepts the fixed code
> shown, so no mailbox access is needed.
>
> Account: <demo email> · Code: <fixed code>
>
> The demo account is already verified and onboarded, with one introduction
> awaiting a decision and one open conversation.
>
> Identity verification uses a sandboxed vendor in this build: on the
> verification step, tap "Begin identity and liveness verification" and then
> "Finish capture" to simulate a successful check. No real document is needed.
>
> Every member is identity-verified and confirmed to be 18 or over before any
> profile is shown. Reporting and blocking are available from the Safety centre,
> reachable from the You tab and from every conversation and date. Account
> deletion is in the You tab and takes effect in-app.
>
> **Subscriptions.** Delete whichever of these two paragraphs does not describe the
> build you are uploading — getting this wrong is a guideline 3.1.1 or 2.1 rejection.
>
> *If in-app purchase is switched on (§8):* Paid plans are sold only through
> Apple's in-app purchase. There is no web checkout link anywhere in the app.
> "Restore purchases" is on the Membership screen under the You tab.
>
> *If it is not:* The app sells nothing. No purchase UI is reachable — not a
> disabled button, not a "coming soon" — and every plan shows as unavailable.

---

## 10. Listing copy

**Subtitle (30 chars):** `Verified. Explained. No swipes.`

**Promotional text (170):**
> One to three verified introductions a week, each with three plain reasons and
> one honest friction. Private decisions. Chat only when you both say yes.

**Description:**
> Lovera is a matchmaker, not a feed.
>
> Every week you receive one to three introductions chosen for you — never a
> stack to swipe through. Each comes with three plain-language reasons the
> matchmaker thinks it could work, one honest friction, and the thing only a
> real date can tell you. No compatibility percentage, because none would be
> honest.
>
> **Everyone is verified.** Identity and 18+ checks before anyone enters the
> pool. No fakes, no minors, no bots.
>
> **Your decisions are private.** A conversation opens only if you both say
> yes. A pass is never shown to the other person — not who passed, not when.
>
> **Built around the second date.** We help you agree a public venue and a
> time, and you can set a check-in with someone you trust. Afterwards, private
> feedback reveals a second date only when it is mutual.
>
> **AI assists; you speak.** Drafts and translations are suggestions you
> approve. Nothing is ever sent as your words without you.
>
> We do not collect your precise location. We do not track you across other
> apps. We never sell your data.

**Keywords (100 chars, comma-separated, no spaces):**
`dating,matchmaker,verified,serious,relationship,introductions,meet,singles,safe,slow`

---

## 11. Screenshots — **You**

Required: 6.7" iPhone and 6.5" iPhone for Apple; phone screenshots for Play.
Take them from the demo account so the content is real.

Worth showing, in this order — the first two are what actually sell this
product's difference:
1. An introduction with its three reasons and the honest friction visible.
2. Today, with one next action rather than a feed.
3. A conversation that exists because both people said yes.
4. A date with its public venue and the safety check-in.
5. The Blueprint review screen — "nothing is used until you confirm it".

Do not use a photo of a real person you do not have rights to. Both stores
reject stock-photo profiles that imply real members.

---

## 12. Order of operations

1. ~~Decide the name and bundle ID~~ — done, and permanent (§7).
2. Finish the Play service-account permissions and create the EAS project (§2).
3. Put the real API origin in the EAS environment (§3).
4. Provision the demo account with a fixed code (§9).
5. Build both platforms, submit to internal/TestFlight, install on a real device
   and walk the whole journey — including push, which cannot be tested in a
   simulator.
6. If the Play account is personal, start the 12-tester closed test immediately.
7. Complete data safety, age rating and review notes (§5, §6, §9).
8. Submit for review.
