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

### Email delivery is not wired up

With `MM_ENV=production` the code is no longer in the response, and nothing yet
sends it by email. **Nobody can sign in until you connect an email provider.**
This is the one remaining gap between "deployed" and "usable", and it is not
configuration — it needs an SMTP or API provider wired into the account module.
Plan for it before you invite anyone.

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

## 5. Point the mobile app at it

Replace the placeholders in `apps/mobile/eas.json`:

```json
"production": { "env": { "EXPO_PUBLIC_API_ORIGIN": "https://matchmaker-api.fly.dev" } }
```

Then rebuild. Until this is done, a store build installs and fails every
request, which is an immediate App Review rejection.

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
