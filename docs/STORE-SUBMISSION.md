# Shipping AI Matchmaker to the App Store and Google Play

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

## 2. Before you can build — **You**

Both accounts exist. What remains is linking them to this app.

**Apple**
1. App Store Connect → My Apps → **+** → New App.
   - Platform: iOS. Name: `AI Matchmaker` (see §7 — the name may need changing).
   - Bundle ID: must match `EXPO_PUBLIC_BUNDLE_ID`, default `com.aimatchmaker.app`.
     Register it first at Certificates, Identifiers & Profiles if it is not listed.
   - SKU: anything internal, e.g. `aimatchmaker-ios`.
2. Note the **App Store Connect app ID** (the numeric `ascAppId`) and your
   **Team ID**. Put both in `apps/mobile/eas.json` under `submit.production.ios`,
   with your Apple ID email.

**Google**
1. Play Console → Create app. Package name must match the same bundle ID.
2. Create a service account for uploads:
   Play Console → Setup → API access → create a Google Cloud service account,
   grant it *Release manager*, download the JSON key.
3. Save it as `apps/mobile/play-service-account.json`. That exact filename is
   gitignored. **Never commit it** — anyone holding that key can publish a build
   to your listing. If it ever lands in a commit, revoke it in Google Cloud and
   issue a new one; deleting the file from a later commit does not help, because
   the key is still in the history.

**Expo**
```bash
cd apps/mobile
npx eas login
npx eas init          # creates the EAS project, prints a project ID
```
Put that project ID in `EXPO_PUBLIC_EAS_PROJECT_ID`. Push tokens cannot be
issued without it.

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

## 7. Two decisions worth making before you submit — **You**

**The name.** "AI Matchmaker" is descriptive rather than distinctive, which
makes it weak as a trademark and awkward in search. Apple has also been
tightening review of "AI" in app names where the claim is doing marketing work.
A distinctive name is cheaper to change now than after launch, because the
bundle ID and the listing are permanent.

**The bundle ID.** Default is `com.aimatchmaker.app`. Change
`EXPO_PUBLIC_BUNDLE_ID` *before* the first upload if you want something else.
After the first upload it cannot be changed — only replaced with a new listing
that has no reviews and no ranking.

---

## 8. In-app purchase — required before you can sell on mobile

**This is not optional and it is not yet built.** Both stores require their own
billing for digital subscriptions. Our paid plans (Pro €39/mo, Concierge €89/mo)
are digital subscriptions, so:

- Selling them through our own checkout inside the app is a **rejection** under
  App Store guideline 3.1.1 and the equivalent Play policy.
- Linking out to a web checkout from inside the app is also a rejection, in most
  regions and for most account types.
- The commission is **15–30%** depending on tier and region. On the Concierge
  plan that is up to €26.70 per subscriber per month.

Two ways forward, and they are genuinely different bets:

1. **Ship v1 without in-app upgrades.** The mobile app serves free-tier members
   and people who already subscribed on the web. Nothing in the app mentions
   upgrading. This is submittable today and completely compliant.
2. **Integrate StoreKit and Play Billing** plus server-side receipt validation
   and subscription webhooks into the billing module, then charge on mobile.

Option 1 gets you into the stores now and loses mobile-originated revenue.
Option 2 is roughly a week of careful work and gives up a slice of every mobile
subscription permanently. Most products in this position do 1 then 2 — but if
mobile is expected to be the main signup channel, doing 2 first avoids training
members to expect a free app.

**The app as it stands does not show any upgrade path, so it is compliant with
option 1 today.**

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

> AI Matchmaker is an invite-only, verified dating service. Sign-in uses a
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
> The app does not sell subscriptions in-app and contains no purchase flow.

---

## 10. Listing copy

**Subtitle (30 chars):** `Verified. Explained. No swipes.`

**Promotional text (170):**
> One to three verified introductions a week, each with three plain reasons and
> one honest friction. Private decisions. Chat only when you both say yes.

**Description:**
> AI Matchmaker is a matchmaker, not a feed.
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

1. Decide the name and bundle ID (§7). Everything downstream is permanent.
2. Create both listings and the EAS project (§2).
3. Put the real API origins in `eas.json` (§3).
4. Provision the demo account with a fixed code (§9).
5. Build both platforms, submit to internal/TestFlight, install on a real device
   and walk the whole journey — including push, which cannot be tested in a
   simulator.
6. If the Play account is personal, start the 12-tester closed test immediately.
7. Complete data safety, age rating and review notes (§5, §6, §9).
8. Submit for review.
