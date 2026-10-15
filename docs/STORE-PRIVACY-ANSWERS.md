# App Privacy and Data safety — the answers, with where each one comes from

Apple's **App Privacy** questionnaire and Google Play's **Data safety** form are the two
submission steps most often answered from memory, and the two most often wrong. A reviewer
compares what you declare against what the app observably does and against the iOS privacy
manifest in the binary; a mismatch is a rejection, and for a dating app the category that gets
looked at hardest is sexual orientation.

So every answer below is derived from code, with the file that decides it named beside it. When
the code changes, this document is wrong until somebody re-derives it — the citations are there so
that takes minutes rather than an afternoon.

Three answers need facts only you have, and are marked **YOU**.

---

## 1. What the app collects

Derived from `apps/api/app/modules/*/service.py` and the models under `apps/api/app/models/`.

| Data | Where it comes from | Linked to identity | Used for tracking |
| --- | --- | --- | --- |
| Email address | `auth/start`, the only sign-in factor | Yes | No |
| Name (display name), pronouns | `profile.display_name` | Yes | No |
| Date of birth → age | `me/adult-consent`, kept to prove 18+ | Yes | No |
| **Sexual orientation** (gender + who they are seeking) | `me/intent` → `member.gender`, `member.seeking` | Yes | No |
| Photos | `profile/media`, moderated before anybody sees them | Yes | No |
| Bio, prompt answers, occupation, education, languages | `profile` | Yes | No |
| Messages | `conversations/{id}/messages` | Yes | No |
| Blueprint answers (values, lifestyle, intentions) | `blueprint/sessions` | Yes | No |
| Availability windows | `availability` — coarse windows only, never calendar event titles or attendees | Yes | No |
| City and zone | `me/intent`, chosen from a fixed list (`catalog/cities.py`) | Yes | No |
| Date plans and venues | `date-plans` | Yes | No |
| Safety reports and any evidence attached | `safety/reports` | Yes | No |
| Identity verification **result** (pass/fail, over-18, dates) | `verification` — see §4 | Yes | No |
| Subscription and store purchase records | `subscriptions`, `store_purchases` | Yes | No |
| Push notification token | `notifications/devices` | Yes | No |
| Product interaction events | `core/analytics.py` — an allow-listed set of event names and properties, written to our own database | Yes | No |
| Crash/diagnostic data | **None.** There is no crash-reporting SDK in the binary | — | — |

### What it does **not** collect, and why that is checkable

- **Device location.** `apps/mobile/app.config.ts` lists `ACCESS_FINE_LOCATION` and
  `ACCESS_COARSE_LOCATION` under `blockedPermissions`, there is no location purpose string in the
  iOS `infoPlist`, and `apps/mobile/scripts/check-native-config.py` fails the build if either
  appears. City and zone are picked from a list, not read from the device.
- **Audio.** `RECORD_AUDIO` is blocked. Voice notes are a described, non-functional pilot stub
  (`messages/[conversationId]/readiness.tsx`) and record nothing.
- **Contacts, calendar contents, advertising ID, identifiers for tracking.** No permission, no SDK,
  no code path.

---

## 2. Apple — App Privacy

Answer **"Yes, we collect data from this app"**, then, for every type below,
**Linked to the user: Yes · Used for tracking: No · Purpose: App Functionality** (Product
Interaction adds **Analytics**).

| Apple data type | Covers |
| --- | --- |
| Contact Info → Email Address | sign-in |
| Contact Info → Name | display name |
| User Content → Photos or Videos | profile photos |
| User Content → Other User Content | messages, bio, prompts, safety reports |
| Identifiers → User ID | member id, push token |
| Sensitive Info | **gender and who the member is seeking** |
| Other Data | date of birth, Blueprint answers, availability, city/zone |
| Usage Data → Product Interaction | the analytics events |
| Purchases → Purchase History | subscription and store purchase records |

**Do not declare Location.** The app collects none, and over-declaring is as wrong as
under-declaring.

**Tracking: No.** There is no advertising SDK, no attribution SDK and no third-party analytics
vendor in the binary.

These answers must match `ios.privacyManifests` in `apps/mobile/app.config.ts` exactly — they were
written from the same facts, and seven assertions in `check-native-config.py` hold the manifest to
them.

---

## 3. Google Play — Data safety

Play's categories differ from Apple's. The mapping:

| Play category → type | Collected | Shared | Purpose |
| --- | --- | --- | --- |
| Personal info → Name | Yes | No | App functionality |
| Personal info → Email address | Yes | No | App functionality, Account management |
| Personal info → User IDs | Yes | No | App functionality |
| Personal info → **Sexual orientation** | Yes | No | App functionality |
| Personal info → Other info (date of birth, city, Blueprint) | Yes | No | App functionality |
| Photos and videos → Photos | Yes | No | App functionality |
| Messages → Other in-app messages | Yes | No | App functionality |
| App activity → Other actions | Yes | No | App functionality, Analytics |
| Financial info → Purchase history | Yes | No | App functionality |

**Location: declare nothing — but read this first.** Play's "Approximate location" means the
user's physical location. The app never reads it from the device, and the only place a member's
whereabouts enters the system is the venue *they choose* for a date, which the safety check-in can
share with a contact they name, retained for 24 hours
(`checkin_location_retention_hours`, `apps/api/app/core/config.py:32`). I have declared no
location on the basis that this is member-entered content about a future plan rather than
collected location. **This is the one judgement call in this document that a reviewer could
reasonably see differently.** If you would rather be conservative, declare *Location →
Approximate location*, collected, not shared, purpose "App functionality", and say in the privacy
policy that it is the venue of a planned date, entered by the member. Being over-inclusive here
costs nothing; being wrong the other way is a policy strike.

### Security practices

- **Encrypted in transit: Yes.** HTTPS everywhere; `NSAllowsArbitraryLoads` is absent and
  `check-native-config.py` asserts cleartext stays blocked.
- **Users can request data deletion: Yes.** In-app, no support contact: `DELETE /me` from
  You → account, with a 14-day grace period (`deletion_grace_days`,
  `apps/api/app/core/config.py:31`). This also satisfies Apple guideline 5.1.1(v).
- **Users can request their data: Yes.** `POST /export` returns a full machine-readable export.
- **Committed to Play Families Policy:** No — the app is 18+.
- **Independent security review: YOU.** Answer No unless you have commissioned one.

---

## 4. Third parties, and what each one receives

Play asks whether data is *shared*. Processors acting on your instructions are generally not
"sharing", but you must still be able to name them.

| Party | Receives | Switched on by |
| --- | --- | --- |
| Identity verification vendor | The verification session only. **Raw documents and biometrics are never stored by us** — we keep a result, an over-18 result, a reference token and the dates (`modules/verification`). Under `MM_IDENTITY_PROVIDER=manual_review` there is no vendor at all; a staff member decides | `MM_IDENTITY_PROVIDER` |
| Anthropic | Message text a member explicitly asks to draft or translate. Nothing is sent without that action | `MM_AI_PROVIDER` / `MM_ANTHROPIC_API_KEY` |
| Stripe | Payment data, on the web checkout. We never see a card | `MM_PAYMENTS_PROVIDER=stripe` |
| Apple / Google | In-app purchases, when you enable them. We receive a product id and a transaction id | `MM_STORE_VALIDATION` |
| RevenueCat | The member id as an app user id, if you use it | `EXPO_PUBLIC_REVENUECAT_*_KEY` |
| Apple APNs / Google FCM, via Expo | Push tokens and notification content | push registration |

Declare only the ones actually configured in the deployment you submit. Under the default
settings, several of these are off.

---

## 5. Age rating

- **Apple:** 18+. Frequent/Intense "Mature/Suggestive Themes"; everything else None. Answer **Yes**
  to unrestricted web access only if you keep the in-app browser used for the verification vendor —
  it opens one vendor URL and nothing else, so **No** is defensible and simpler.
- **Play:** complete the IARC questionnaire as a dating app; declare the **Dating** app category,
  which triggers extra questions about user-generated content and moderation. The answers are:
  photos and text are moderated (`moderation_status` on profile media and messages), members can
  report and block from any content surface, and reports reach people rather than an automated
  system.

---

## 6. Still needs you

1. **Privacy policy URL and support URL** — both stores require a reachable, public URL before
   submission. The policy lives at `/legal/privacy`; it still has 12 operator facts unset
   (`python tools/check_legal_facts.py --require-all` lists them).
2. **Data protection officer / EU representative** — if required for your entity.
3. **Independent security review** — answer No unless one exists.

---

## 7. Re-deriving this

```bash
python tools/check_legal_facts.py --require-all     # the operator facts still unset
python apps/mobile/scripts/check-native-config.py   # 31 checks, 7 on the privacy manifest
```

The manifest the binary carries is `apps/mobile/ios/AIMatchmaker/PrivacyInfo.xcprivacy`, generated
from `ios.privacyManifests` in `apps/mobile/app.config.ts`. If those two and this document ever
disagree, the manifest is what ships and this document is the one that is wrong.
