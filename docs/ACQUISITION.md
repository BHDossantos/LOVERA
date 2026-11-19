# Acquisition insights

Lovera's first-party acquisition report helps the Rome pilot compare where new members join and
which onboarding milestones they reach. It uses the existing account events and staff console;
there is no additional analytics service, database migration or required environment variable.

## Use it

An account with the `admin` role can open **Console → Acquisition** (`/admin/acquisition`). Choose
the last 7, 30 or 90 days of signups, or refresh the snapshot manually. The same page provides
copyable campaign links using the origin of the site where the administrator opens it. Copy from
the production site when preparing a live campaign, rather than from a preview or local server.

| Placement | Approved code | Web entry path |
| --- | --- | --- |
| Rome · Instagram | `rome-instagram` | `/welcome?campaign=rome-instagram` |
| Rome · Community | `rome-community` | `/welcome?campaign=rome-community` |
| Rome · Partners | `rome-partners` | `/welcome?campaign=rome-partners` |

The same parameter on `/` is forwarded to `/welcome`. Only a single lowercase code of at most
64 letters, digits, underscores or hyphens is forwarded. The API accepts attribution only when
the code exists in `apps/api/app/catalog/campaigns.py`; a syntactically valid but unknown code is
ignored. New placements belong in that reviewed catalog, with non-personal codes and labels.
They must identify campaigns, not individual members or referrers.

The code stays in the welcome URL through a refresh or incorrect OTP attempt. A successful OTP
verification clears it before the next screen. No attribution cookie, localStorage or
sessionStorage entry is added. The first account-creation event records the approved code and
source; later sign-ins do not overwrite it. Direct signups and existing invite attribution keep
working. Campaign links do not grant invitations, eligibility, rewards or paid features.

This release captures campaign links in the web signup flow. It does not add native app deep
links, deferred installation attribution, multi-touch attribution or member referral rewards.
Never append personal identifiers or sensitive content to campaign URLs. Raw URL parameters and
referrer strings are not stored in the acquisition event; ordinary infrastructure request logs
are separate from this feature.

## Read the report

`GET /v1/admin/acquisition?days=30` requires the `admin` role and audits each successful read.
The API fixes the report time once per request. Each cohort contains distinct pseudonymous
account keys whose **first recorded account creation** is within the rolling UTC signup window.
Accounts with a current staff role are excluded.

Each milestone counts distinct members from that cohort with an event between their first
signup and the report time, inclusive:

| Column | Meaning |
| --- | --- |
| Signups | First recorded account creations in the selected window |
| Verified | A `verification_completed` event whose status is `verified` |
| Blueprint confirmed | At least one `blueprint_confirmed` event |
| Profile milestone | At least one `profile_completed` event, emitted by the existing profile flow when completeness reaches 60 |

Repeated edits or verification attempts count once per member per milestone. A duplicate signup
event cannot pull an older member into a newer cohort. These are independent historical
milestones, not an ordered funnel, a measure of current activity, or proof of matching eligibility.
Recent cohorts have had less time to progress. Attribution identifies the link used during
account creation, not proof that the placement caused the signup.

Approved campaign rows plus direct and invite rows are always present. `null` is displayed as
**Withheld**, including zero and counts below five. A milestone is also withheld if showing it
alongside signups would expose a group of one to four non-completers. The endpoint provides no
member identifiers, raw event records, cross-cohort totals or conversion percentages. Fixed rows
avoid using row presence to reveal a single signup. This reduces disclosure; it does not make
the underlying events anonymous or guarantee protection against comparisons across snapshots.

## Data lifecycle

Campaign code/source are accepted only on the allowlisted `account_created` analytics event.
The source is resolved by the server, not copied from browser UTMs. Acquisition reporting does
not use profile answers, sexual preferences, message text, safety reports or private dating
outcomes. Existing analytics keys remain pseudonymous and linked to an account.

A member's own data export includes their first recorded acquisition source. The account erasure
job removes their linked analytics events after the existing deletion grace period; aggregate
reports can therefore decrease after erasure. The public Privacy Notice documents the first-party
collection and the newly added campaign attribution.

## Verification and rollout

Backend regression coverage is in `apps/api/tests/test_acquisition.py`, including unknown codes,
old clients, returning sign-ins, cohort boundaries, deduplication, staff exclusion, authorization,
small-count suppression, export and erasure. Browser coverage is in
`apps/web/e2e/acquisition.spec.ts` and `apps/web/e2e/admin-acquisition.spec.ts`.

Deploy the API before or alongside the web app. An older API may ignore the optional campaign
field, but it has no acquisition report route. Existing mobile clients require no payload change.
The implementation adds no seed attribution and does not backfill invented campaign history.
Use a fresh test account and an approved link in staging to check the full path; do not interpret
withheld pilot counts as a broken report. Production deployment still depends on the application's
normal database, sign-in and release readiness checks.
