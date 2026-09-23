# AI Matchmaker

A verified, no-swipe dating concierge built around the second date. One to three reciprocal
introductions a week, each with three plain-language reasons, one honest friction and an explicit
unknown; private decisions; member-approved AI assistance; safe public date coordination; and a
private post-date loop that reveals only a mutual yes.

This repository implements the invite-only single-city pilot described in the three product
documents (Product Blueprint, Screen Design Specification, Implementation Specification).

```
apps/api   FastAPI modular monolith (PostgreSQL) – matching, introductions, messaging, dates, safety, billing
apps/web   Next.js member web app – 44 screens from the design spec plus the staff console
apps/mobile Expo (React Native) app for the App Store and Google Play
infra      docker-compose for db, redis, api, web
docs       ARCHITECTURE.md
```

## Quick start

```bash
make up      # builds and starts db, redis, api, worker, web
make seed    # verified cohort + a published batch
open http://localhost:3000
```

Services are deployed independently (api, worker, web) from two images; see `docs/ARCHITECTURE.md`
for the service map, the module extraction seam, and the automation (CI, image publishing to GHCR,
Dependabot, scheduled weekly batch).

Or run locally: see `docs/ARCHITECTURE.md`. The identity vendor, payments and email delivery are
sandboxed by default (the one-time code is shown in the sign-in form outside production). Set
`MM_ANTHROPIC_API_KEY` to use Claude for Blueprint extraction, AI Wingman drafts and translation;
without it a deterministic provider keeps every path working.

## Product principles enforced in code

- **Humans remain authors.** Drafts and translations are previews; the only send path is the
  member's own message command.
- **Safety vetoes fit.** Blocks, restrictions and reports exclude pairs before any scoring.
- **Hard means hard.** Must preferences are gates in both directions and are never relaxed;
  the member sees a protected credit and a transparent waiting state instead.
- **Reciprocity over popularity.** A harmonic blend of both directional fits; no desirability score.
- **Uncertainty is a feature.** Evidence labels (Strong / Promising / Low evidence), never percentages.
- **Trust is free.** Verification, block, report, check-in and appeal are outside the paywall.
- **Private outcomes.** A decline or a one-sided second-date answer is never revealed.

## Tests

```bash
cd apps/api && python -m pytest        # Section 12 acceptance journeys against PostgreSQL
cd apps/web && npx tsc --noEmit && npm run build
cd apps/web && npx playwright test     # end-to-end member journey against the running stack
```
