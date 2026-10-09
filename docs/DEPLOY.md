# Deploying AI Matchmaker

Target: **Fly.io, Frankfurt (`fra`)**. Why that choice is at the bottom; it is a
small `.toml` either way, so moving off it later is a day, not a migration.

Everything in `infra/fly/` is committed configuration. What is left is creating
the apps, setting the secrets, and running `fly deploy` — the parts that need
your account.

---

## 0. Once

```bash
# Install flyctl, then:
fly auth login
```

Pick names now; they become your hostnames and are awkward to change:

| App | Suggested name | Becomes |
|---|---|---|
| API | `matchmaker-api` | `https://matchmaker-api.fly.dev` |
| Worker | `matchmaker-worker` | not public |
| Web | `matchmaker-web` | `https://matchmaker-web.fly.dev` |

```bash
fly apps create matchmaker-api
fly apps create matchmaker-worker
fly apps create matchmaker-web
```

## 1. Postgres

```bash
fly postgres create --name matchmaker-db --region fra
fly postgres attach matchmaker-db --app matchmaker-api
fly postgres attach matchmaker-db --app matchmaker-worker
```

`attach` sets `DATABASE_URL`. Our settings read `MM_DATABASE_URL`, and SQLAlchemy
needs the `postgresql+psycopg://` driver prefix, so set it explicitly from the
connection string `attach` prints:

```bash
fly secrets set --app matchmaker-api \
  MM_DATABASE_URL='postgresql+psycopg://<user>:<pass>@<host>:5432/<db>?sslmode=require'
fly secrets set --app matchmaker-worker \
  MM_DATABASE_URL='postgresql+psycopg://<user>:<pass>@<host>:5432/<db>?sslmode=require'
```

Both the API and the worker create the schema on start. That is safe —
`create_schema()` holds a Postgres advisory lock, so whichever boots first wins
and the other finds the tables already there. It was not safe before #20.

Take backups seriously from day one: this is a dating service holding
special-category data, and a lost database is not recoverable by re-running
anything.

```bash
fly postgres db list --app matchmaker-db   # confirm it exists
# Fly snapshots daily by default; verify the retention on your plan.
```

## 2. Secrets that must be set

Everything here has a development default that is **wrong in production**. The
app will start without them and be quietly insecure, so set them all before the
first real member.

```bash
# A long random value. Rotating it invalidates every session, which is the point.
fly secrets set --app matchmaker-api MM_SECRET_KEY="$(openssl rand -hex 32)"

# Staff roles are granted by email on first sign-in. Leaving the example.test
# defaults means those addresses are staff accounts waiting to be claimed.
fly secrets set --app matchmaker-api \
  MM_STAFF_BOOTSTRAP_EMAILS='["you@yourdomain","safety@yourdomain"]'

# Webhook signatures. The sandbox defaults accept anything our own sandbox signs.
fly secrets set --app matchmaker-api \
  MM_IDENTITY_WEBHOOK_SECRET="$(openssl rand -hex 32)" \
  MM_PAYMENTS_WEBHOOK_SECRET="$(openssl rand -hex 32)"

# Who may call the API from a browser. The mobile app is not a browser and does
# not need listing; getting this wrong breaks the web app with a CORS error.
fly secrets set --app matchmaker-api \
  MM_CORS_ORIGINS='["https://matchmaker-web.fly.dev"]'

# Optional. Without it the AI gateway falls back to its deterministic path, which
# works but writes blunter explanations.
fly secrets set --app matchmaker-api MM_ANTHROPIC_API_KEY="sk-ant-..."
```

Outbound mail has its own set — see the next section. It is not optional: without
it the API will not start in production.

The worker needs `MM_SECRET_KEY` and `MM_DATABASE_URL` too; the rest it does not
touch.

```bash
fly secrets set --app matchmaker-worker MM_SECRET_KEY="<the same value>"
```

### Why `MM_ENV=production` matters more than it looks

`infra/fly/api.toml` sets it. The one-time sign-in code is returned in the
`/auth/start` response only when `expose_dev_otp` is true **and** the env is not
production — which is how the e2e tests sign in without a mailbox. In production
both conditions say no. If you ever set `MM_ENV` to anything else on a
public host, anyone can request a code for any email address and read it in the
response. That is a full account takeover, so treat `MM_ENV` as a secret-grade
setting rather than a label.

### Email, which is the only way anyone signs in

With `MM_ENV=production` the code is no longer in the response, so email is the
only path into the product. The API knows this and **refuses to start** if no
mail host is configured — a deploy that forgets these secrets fails loudly at
boot instead of looking healthy while every member waits for a mail that was
never sent.

Any provider that speaks SMTP works, and none of the configuration is
vendor-specific. Resend, Postmark, Mailgun, SES and Fastmail all do; pick on
price and deliverability, not on integration work, because swapping later is
these five secrets and no code change.

```bash
fly secrets set --app matchmaker-api \
  MM_SMTP_HOST='smtp.yourprovider.test' \
  MM_SMTP_USERNAME='<provider username or API key id>' \
  MM_SMTP_PASSWORD='<provider password or API key>' \
  MM_MAIL_FROM='AI Matchmaker <no-reply@yourdomain>' \
  MM_MAIL_REPLY_TO='help@yourdomain'
```

`MM_SMTP_PORT=587` and `MM_SMTP_SECURITY=starttls` are already in
`infra/fly/api.toml` and suit nearly every provider. Use `ssl` with port 465 if
yours insists; `none` exists for a local test server and nothing else.

Two things decide whether these mails actually arrive, and neither is code:

- **Authenticate the sending domain.** Publish the SPF, DKIM and DMARC records
  your provider gives you, for the domain in `MM_MAIL_FROM`. A sign-in code that
  lands in spam is indistinguishable from a broken product, and transactional
  mail from an unauthenticated domain lands in spam.
- **Send from a domain you control.** Not gmail.com, not the provider's shared
  sandbox domain — both get a dating service filtered quickly.

`MM_MAIL_TRANSPORT` is deliberately left unset, which means "work it out": SMTP
when a host is configured, and refuse to start in production when one is not. You
can set it to `console` to start a production machine with no mail at all, which
logs each code instead of sending it and logs a CRITICAL line saying so. That is
for a controlled smoke test, never for members.

## 3. Deploy

```bash
fly deploy --config infra/fly/api.toml    --app matchmaker-api
fly deploy --config infra/fly/worker.toml --app matchmaker-worker
fly deploy --config infra/fly/web.toml    --app matchmaker-web \
  --build-arg API_ORIGIN=https://matchmaker-api.fly.dev \
  --build-arg NEXT_PUBLIC_WS_URL=wss://matchmaker-api.fly.dev/v1/realtime/ws
```

## 4. Verify, before trusting it

```bash
curl -sS https://matchmaker-api.fly.dev/healthz          # {"ok":true,"env":"production"}
curl -sS -o /dev/null -w '%{http_code}\n' https://matchmaker-web.fly.dev/welcome
curl -sS -o /dev/null -w '%{http_code}\n' https://matchmaker-web.fly.dev/legal/privacy
fly logs --app matchmaker-worker | head -20              # the job loop should be ticking
```

Check `"env":"production"` specifically. If it says anything else, stop and fix
`MM_ENV` before going further — see the warning above.

Then confirm the OTP is **not** being handed out:

```bash
curl -sS -X POST https://matchmaker-api.fly.dev/v1/auth/start \
  -H 'Content-Type: application/json' -d '{"email":"probe@yourdomain"}'
# dev_code MUST be null. If it is a six-digit number, the deployment is unsafe.
```

Then confirm the code actually arrives. Use an address you can read, and send to
a different provider than your own domain (a Gmail or Outlook address) so you
find out about spam filtering now rather than from your first member:

```bash
curl -sS -X POST https://matchmaker-api.fly.dev/v1/auth/start \
  -H 'Content-Type: application/json' -d '{"email":"you@gmail.com"}'
# {"challenge_id":"...","delivery":"email","dev_code":null}
```

`"delivery":"email"` means a mail host accepted the message. Check the inbox —
and the spam folder, which is the answer to a DKIM or DMARC record you have not
published yet. Then finish the sign-in with the code from the mail:

```bash
curl -sS -X POST https://matchmaker-api.fly.dev/v1/auth/verify \
  -H 'Content-Type: application/json' \
  -d '{"challenge_id":"<from above>","code":"<from the email>","device_id":"probe"}'
# access_token and refresh_token. That is the whole production login path proven.
```

A `503 DEPENDENCY_UNAVAILABLE` from `/auth/start` means the mail host rejected the
message or could not be reached — check `fly logs --app matchmaker-api` for the
reason. The API reports that rather than claiming to have sent a mail it did not,
so members see "try again in a moment" instead of watching an empty inbox.

## 5. Point the mobile app at it

`apps/mobile/eas.json` carries no `env` blocks — they were removed when the release config
was standardised — so the origin has to be supplied, either by putting the block back:

```json
"production": {
  "autoIncrement": true,
  "env": {
    "EXPO_PUBLIC_API_ORIGIN": "https://matchmaker-api.fly.dev",
    "EXPO_PUBLIC_EAS_PROJECT_ID": "<the id from `npx eas-cli init`>"
  }
}
```

or by setting the same two as EAS environment variables for the profile (`npx eas-cli env
--help`), which keeps them out of the repository.

**Then rebuild.** Expo inlines the origin into the bundle at build time and `expo-updates`
is not installed, so an existing build cannot be repointed at a different API by any means
short of a new build. A build made before the API existed will keep failing every request
no matter what you deploy afterwards.

Both values are required for a `preview` or `production` build and `app.config.ts` refuses
the build without them, with the reason. The `development` profile is exempt from both
checks, which is worth knowing: a development build with no origin set silently falls back
to `http://127.0.0.1:8000`, and on a phone that is the phone. The app recovers from that on
its own now — `resolveOrigin` in `src/api/client.ts` rewrites a loopback origin to whatever
host served the bundle — but only for a build that loads JS from a dev server.

## 5b. Staging: a real API for a signed build, before an identity vendor exists

A `production` deploy dead-ends every signup, including yours. `/verification/sandbox/complete`
is refused when `MM_ENV` is production, and nothing else can verify a member until an identity
vendor is wired up, so onboarding stops at the verification step. Deploy as **staging** instead
and the only simulated thing is the ID check:

```bash
fly apps create matchmaker-api-staging
# Postgres as in section 1, then the secrets from section 2 against the staging app, plus:
fly secrets set --app matchmaker-api-staging \
  MM_SMTP_HOST='smtp.yourprovider.com' \
  MM_SMTP_USERNAME='...' MM_SMTP_PASSWORD='...' \
  MM_MAIL_FROM='AI Matchmaker <no-reply@yourdomain>'

fly deploy --config infra/fly/api-staging.toml --app matchmaker-api-staging
```

`infra/fly/api-staging.toml` sets `MM_ENV=staging` and `MM_EXPOSE_DEV_OTP=false`. That second
one is the setting that makes a publicly reachable staging deploy safe to point a build at: the
sign-in code is never returned in a response, so knowing somebody's address is not enough to
sign in as them. It also means **real mail is required** — the API refuses to boot without a mail
host rather than running healthy while nobody can get in (`check_mail_transport` in
`apps/api/app/main.py` covers staging for exactly this reason).

Verify the same way as section 4, and check the two things that distinguish this posture:

```bash
curl -sS https://matchmaker-api-staging.fly.dev/healthz        # {"ok":true,"env":"staging"}
# dev_code MUST be null here too.
curl -sS -X POST https://matchmaker-api-staging.fly.dev/v1/auth/start \
  -H 'content-type: application/json' -d '{"email":"you@yourdomain"}'
```

Then point a build at it exactly as in section 5, with the staging hostname, and rebuild.

## 5b-bis. The legal pages, before anything is submitted

The terms, privacy notice and community agreement state facts only you have: who the
contracting entity is, where it is registered, which law governs, the addresses members
write to, how long safety reports are kept. Each is declared once in
`apps/web/src/app/legal/_facts.ts` and read from the environment, so filling them in is one
variable each rather than a search through three documents — the entity name and the
registered address each appeared twice, and a privacy notice naming a controller the terms
do not is a document that contradicts itself.

Check where you stand:

```bash
python tools/check_legal_facts.py              # what is still missing (always passes)
python tools/check_legal_facts.py --require-all # fails while anything required is unset
```

Run the second before a production build or a store submission. CI runs the first on every
push, because which facts are set belongs to a deployment and not to a commit.

Five of them this repository already answers — hosting and its region, the AI provider, the
payment provider, how long a shared check-in location is kept, and whether there is an
identity vendor (under `MM_IDENTITY_PROVIDER=manual_review` there is not, and saying there
is would be false). The rest are yours, and a lawyer should see all of it: the file says what
each one is and where it comes from, not what it should say.

One of them is a decision and not just a sentence. `NEXT_PUBLIC_LEGAL_SAFETY_RETENTION` is
how long safety reports and their evidence are kept — and nothing in the code deletes them
today, by design (`erase_member` preserves safety records). So whatever you write there has
to be implemented too, or the notice says something the system does not do.

---

## 5c. Shipping a fix without a store review

`expo-updates` is installed, so a JavaScript-only fix can reach installed apps in minutes
instead of waiting on App Review. From `apps/mobile`:

```bash
npx eas-cli update --branch production --message "what changed"
```

That publishes to the branch, and `eas.json` maps the `production` build profile to the
`production` channel (and `preview` to `preview`). Builds pick it up on their next launch:
`fallbackToCacheTimeout` is 0, so the app starts on the bundle it already has and swaps in
what it downloaded the time after. Nobody waits on a network round trip at the splash
screen, and nobody is more than one launch behind.

**What an update must not do is reach a binary it does not fit.** A JS bundle calling a
native module the installed app does not have crashes on launch, and the member cannot get
out of that by themselves — no screen loads, so there is nothing to tap. The runtime version
is what prevents it, and it is set to the `fingerprint` policy: EAS derives it from the
native project, so any change to native code, a config plugin or a dependency with native
code produces a different runtime version and the update is simply not offered to the old
binaries. The alternatives (`appVersion`, `nativeVersion`) leave that as something you have
to remember, and forgetting it once is unrecoverable on the device.

So the rule is simple: **anything that changes native code needs a new store build, not an
update.** If you are unsure whether a change is native, it is — `npx expo-doctor` and the
build logs will tell you, and `apps/mobile/scripts/check-native-config.py` asserts the
runtime version policy has not been loosened.

Updates stay off entirely until `eas init` has created the project, because the manifest URL
is built from the project id (`updates()` in `apps/mobile/app.config.ts`). A production build
cannot get that far anyway — the project id guard throws first.

---

## 6. A custom domain, when you have one

```bash
fly certs add api.yourdomain --app matchmaker-api
fly certs add app.yourdomain --app matchmaker-web
```

Then update `MM_CORS_ORIGINS`, the `eas.json` origin, and the `API_ORIGIN` build
arg. Doing this **before** the first store build saves a release cycle, because
the API origin is baked into the binary.

---

## Why Fly, and what would change

- It deploys the Docker images we already build, so there is no second build path.
- The whole configuration is three committed `.toml` files, which means it is
  reviewable and reproducible rather than a console someone clicked once.
- Frankfurt keeps member data in the EU. We hold sexual orientation and,
  optionally, faith; EU residency means the privacy notice does not need a
  transfer mechanism.
- Managed Postgres with snapshots, and TLS without configuring a proxy.

If you would rather use Hetzner, Scaleway, Render or a cloud provider, the only
things that carry over are this document and the secret list — the compose file
already describes the topology, and nothing in the application code knows where
it runs.
