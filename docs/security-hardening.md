# Security hardening (October 2026)

What the `fix/security-hardening` branch changed after the read-only audit of
release 1.4.0, what to set before and after deploying it, and what is still
open and has to be done by hand — in Cloudflare, on the shared host, or as a
separate piece of work.

Numbers in brackets are the audit's finding numbers.

## Contents

- [Client address and rate limits](#client-address-and-rate-limits) [2, 4]
- [Security headers](#security-headers) [5]
- [Accounts and sessions](#accounts-and-sessions) [7, 17, 18]
- [Orders and gift cards](#orders-and-gift-cards) [10, 11]
- [Smaller fixes](#smaller-fixes) [14, 20]
- [Environment variables](#environment-variables)
- [Deploying this branch](#deploying-this-branch)
- [Owner TODO — not done in code](#owner-todo--not-done-in-code)
- [Dependency upgrades](#dependency-upgrades)

## Client address and rate limits

### How the visitor's address reaches the API

```
visitor ──► Cloudflare ──► edge-nginx (SNI passthrough, TCP only) ──► takeaway-nginx ──► api
            adds CF-Connecting-IP    adds nothing; $remote_addr      sets X-Forwarded-For   trusts 1 hop
                                     here is the edge container      = $client_ip
```

- `deploy/nginx/nginx.conf` derives `$client_ip`: Cloudflare's
  `CF-Connecting-IP` when it holds a bare address, otherwise `$remote_addr`
  (a request that did not come through Cloudflare, like the smoke test run on
  the host).
- `deploy/nginx/snippets/api-upstream.conf` **sets** `X-Forwarded-For` and
  `X-Real-IP` to `$client_ip`. It used to _append_ to whatever the client
  sent.
- The API trusts exactly one proxy hop (`TRUST_PROXY=1`, the default; see
  `apps/api/src/app/common/http/trust-proxy.ts`) and therefore takes the last
  address in `X-Forwarded-For` — the one nginx wrote. It used to run with
  `trustProxy: true`, which takes the **first** address — the one the client
  typed — so every per-IP limit in the API could be reset by changing a header
  on each request.

Why a hop count and not the docker subnet: the API has no published port and
is only reachable through our nginx, which is always exactly one hop away; a
subnet would have to be kept in sync with whatever range Docker hands the
compose network on that host.

The throttler (`AppThrottlerGuard`) keys signed-in requests on the account and
anonymous ones on that address. A whole café or mobile carrier behind one
address no longer shares one budget for signed-in traffic, and an account
cannot reset its budget by switching networks.

Every API route, including ones added later, goes through that guard (it is
global) and through nginx's `api` zone. Routes that reach the outside world —
mail, push, Telegram, the geocoder — also get an explicit per-route
`@Throttle`: address lookup `/admin/geocode` 30/min, campaign test send
10/min and campaign send 5/min (per account), promo preview 20/min (per
address). New routes of that kind (`POST /admin/support`, campaign
moderation) should get one too when they land.

**Limitation until Cloudflare Authenticated Origin Pulls are on** (see the
TODO list): somebody who finds the origin's IP and talks to it directly,
bypassing Cloudflare, can still put any address in `CF-Connecting-IP`. Nginx
cannot tell, because behind the edge's SNI passthrough every connection comes
from the edge container. Through Cloudflare — which is how every real client
arrives — the header is Cloudflare's and cannot be forged.

**If a domain is ever switched to "DNS only" (grey cloud)**, every visitor of
it arrives without `CF-Connecting-IP` and they all share one budget — the
edge container's address. Keep all takeaway.md records proxied.

### nginx limits

| Zone / limit    | Rate                            | Burst | Applies to                                                                                                 |
| --------------- | ------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| `api`           | 20 req/s per visitor            | 40    | every `/api/` request on every host                                                                        |
| `auth`          | 10 req/min per visitor          | 5     | `/api/auth/password/{login,forgot,reset}`, `/api/auth/kds/pin`, `/api/business/register` — on top of `api` |
| `tile_requests` | 30 req/s per visitor            | 60    | `/tiles/` (only misses of Cloudflare's cache reach us)                                                     |
| `realtime`      | 20 open connections per visitor | —     | `/socket.io/`                                                                                              |

Customer sign-in (Telegram, Google, Apple) and token refresh stay on the
general budget on purpose: many customers share one carrier address. The API
keeps its own, finer per-route limits behind nginx (password login 10/min,
PIN 8/min plus a per-store lock, and so on).

A visitor over a limit gets `429` with the same JSON shape the API uses:

```json
{ "statusCode": 429, "error": "Too Many Requests", "message": "Too many requests. Please wait a moment and try again." }
```

Rejections are logged at `warn` in nginx's error log
(`docker logs takeaway-nginx-1 2>&1 | grep limiting`).

Why 20 sockets per address and not 10: a café's Wi-Fi is one address for the
kitchen tablets, the cabinet and every customer with the app open. One over
the limit gets 429 and its client retries; the kitchen board re-reads every
30 s and the menus every minute anyway.

Also in `nginx.conf`: `client_header_timeout 10s`, `client_body_timeout 10s`,
`send_timeout 30s` (gaps between reads/writes, not totals — a slow upload keeps
going while bytes move), and `client_max_body_size 6m` (was 25m; the largest
upload is a 5 MB image).

### Realtime gateway

`apps/api/src/app/realtime/realtime.gateway.ts`:

- `maxHttpBufferSize` 16 KB (socket.io's default was 1 MB; clients only send
  `{orderId}` / `{storeId}`).
- `connectTimeout` 10 s for a transport that never joins the namespace.
- Anonymous sockets (signed-out storefronts in the mobile app) are capped at
  `REALTIME_MAX_ANONYMOUS_SOCKETS` (5000) and recycled after
  `REALTIME_ANONYMOUS_MAX_AGE_SECONDS` (30 min, minus up to a quarter of
  jitter). Recycling closes the transport, which every socket.io client treats
  as a dropped connection and reconnects from by itself, so the public
  `store.availabilityChanged` broadcast keeps reaching them.
- CORS on the long-polling transport follows the same origin list as the HTTP
  API instead of reflecting any origin.

## Security headers

`deploy/nginx/snippets/security-headers.conf`, included at server level **and**
in every location that has its own `add_header` (nginx drops inherited
`add_header`s in such a block — that is why the pages themselves had no HSTS
or frame protection before; only the API's JSON did).

|                                                    | takeaway.md                                                  | admin.takeaway.md                          | tma.takeaway.md                                                                     | api.takeaway.md |
| -------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------- | --------------- |
| HSTS 1 year, includeSubDomains                     | yes                                                          | yes                                        | yes                                                                                 | yes             |
| `X-Content-Type-Options: nosniff`                  | yes                                                          | yes                                        | yes                                                                                 | yes             |
| `Referrer-Policy: strict-origin-when-cross-origin` | yes                                                          | yes                                        | yes                                                                                 | yes             |
| `X-Frame-Options`                                  | `DENY`                                                       | `DENY`                                     | — (Telegram Web frames it)                                                          | —               |
| CSP (enforced)                                     | `frame-ancestors 'none'; base-uri 'self'; object-src 'none'` | same                                       | `frame-ancestors 'self' https://*.telegram.org; base-uri 'self'; object-src 'none'` | —               |
| CSP report-only                                    | —                                                            | full policy (below)                        | —                                                                                   | —               |
| `Permissions-Policy`                               | `geolocation=(self), camera=(), microphone=()`               | `geolocation=(), camera=(), microphone=()` | `geolocation=(self), camera=(), microphone=()`                                      | —               |

All takeaway.md subdomains answer HTTPS (`conf.d/00-redirect.conf` redirects
port 80), so `includeSubDomains` is safe. HSTS with it was already being sent
on `/api/` responses of takeaway.md, so browsers that used the site have had it
for months; `preload` is deliberately not set.

The Mini App: Telegram's phone and desktop clients open it as a top-level web
view, where `frame-ancestors` does not apply; Telegram Web
(`web.telegram.org`, `/k/`, `/a/`) frames it and is allowed.

### The cabinet's full CSP is report-only

`conf.d/30-admin.conf` sends a complete policy as
`Content-Security-Policy-Report-Only`: it never blocks, browsers print
violations in the console. It is not enforced yet because it could not be
verified against production here: `index.html` carries an inline config script
stamped at every deploy (so `script-src` needs `'unsafe-inline'` or a per-deploy
hash), Angular injects inline styles, Leaflet sets `style` attributes, and
Telegram, Google, Apple, Sentry and the tile cache are external.

To enforce it later:

1. Open https://admin.takeaway.md with DevTools → Console, sign in, and walk
   through the dashboard, kitchen, menu (upload a photo), stores (map),
   staff → Telegram link, settings.
2. Every `[Report Only] Refused to …` line names a source the policy misses.
   Add it to the policy in `conf.d/30-admin.conf`.
3. When a full walk-through prints nothing, move the policy from
   `$csp_report_only` to `$csp` (keeping `frame-ancestors 'none'`), deploy, and
   walk through once more.

## Accounts and sessions

### Social sign-in no longer joins a profile by an unproven email [7]

`PATCH /auth/me` lets a customer type any email, unverified. A Google or Apple
sign-in used to join any customer profile with the same email. So anyone could
put a victim's address on their own profile and wait: the victim's first
Google sign-in landed in the attacker's profile — the attacker still controls
it through Telegram and sees everything the victim does there.

Now (`AuthService.finalizeOAuthSignIn`):

- `User.emailVerifiedAt` (new, nullable) records that a provider vouched for
  the address on the profile. Migration
  `20261010120000_user_email_verified` backfills it for customer profiles that
  were _created_ by a Google or Apple sign-in (their email came from the
  provider).
- A social sign-in joins an existing profile by email only when that profile's
  address is proven. An unproven holder loses the address to the new, verified
  profile; the two profiles stay separate. A customer who really owns both can
  add Google/Apple to the original profile from "Ways to sign in"; the empty
  new profile then gives that sign-in method up.
- Editing the email in the profile clears `emailVerifiedAt`. The next sign-in
  with a provider that vouches for the same address sets it again.
- Staff accounts are still never joined.

Residual risk: a profile created by Google/Apple whose owner later typed
someone else's address into it before this deploy would be backfilled as
verified. There is no way to tell from the data; it needed a deliberate setup
before the fix existed.

### Password reset and change end other sessions [17]

- `POST /auth/password/reset` revokes every refresh token of the account.
- `POST /auth/password/change` revokes every refresh token except the
  caller's own, which the cabinet now sends as `refreshToken` in the body.
- Access tokens are not revocable and live 15 minutes (`JWT_ACCESS_TTL`), so a
  stolen session ends at the latest 15 minutes after the reset.

### Stale Telegram init data is refused [17]

Mini App init data is signed by Telegram when the app opens, and the signature
never expires on its own. `TelegramService.verifyInitData` now refuses an
`auth_date` older than `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS` (default 1 day) or
more than 5 minutes in the future. The Mini App signs in with fresh init data
at every launch and keeps its session through refresh tokens (7 days), so a
customer only meets this after leaving the Mini App open for over a day with a
dead refresh token — and then reopening it fixes it.

### No JWT fallback secrets in production [18]

`apps/api/src/app/auth/jwt-secrets.ts` is the one place that reads
`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`. With `NODE_ENV=production`, a
missing, empty, `CHANGE_ME` or in-repo fallback value stops the API at startup.
`deploy.sh` checks the same before the build, so the deploy fails in its first
second instead of leaving a crash-looping container. Development and tests keep
their fixed fallback.

## Orders and gift cards

### Unpaid orders per customer [10]

An order nobody pays for still books kitchen capacity until it expires (15
minutes). `OrdersService.create` now refuses a new order while the customer
already has `ORDER_MAX_UNPAID_PER_USER` (2) orders that are `CREATED`, cost
something and have no card payment through or held: `409` with
`code: TOO_MANY_UNPAID_ORDERS`. Web and the Mini App show a translated message;
the mobile app shows the English `message`.

`POST /orders` is also throttled at 10 per minute per account.

### Gift card double spend [11]

The balance was checked before the order transaction and then decremented
without a condition, so two checkouts with the same card at the same moment
both spent the full balance. The debit is now
`updateMany({ where: { id, status: 'ACTIVE', balanceCents: { gte: amount } } })`
inside the order transaction and must hit exactly one row; Postgres re-checks
the condition under the row lock, so of two racing orders one wins and the
other gets `409 GIFT_CARD_BALANCE_CHANGED` with its whole order rolled back.

Gift card codes are now generated with `crypto.randomInt` instead of
`Math.random`.

## Smaller fixes

- **CORS** [14]: unset `CORS_ALLOWED_ORIGINS` now means the production sites
  (`takeaway.md`, `www.`, `admin.`, `kds.`, `tma.`), plus any `localhost` /
  `127.0.0.1` port outside production — not "reflect any origin with
  credentials". Requests without `Origin` (the mobile apps, bank callbacks) and
  same-origin calls (every SPA, including the Mini App in Telegram's web view)
  are unaffected.
- **`/api/health`** [20]: public answer is `{ status, commit }` with a 12-character
  commit — enough for `smoke-test.sh` and `server-check.sh`, which now match it
  as a prefix of the deployed SHA. Version, full commit, build time and uptime
  need `X-Health-Token: <HEALTH_TOKEN>`.
- **Throttles** [20]: `POST /promo/preview` 20/min per address,
  `POST /gift-cards/validate` 10/min per account.
- **Stripe webhook** [20]: the API keeps the raw JSON body (`rawBody: true` in
  `main.ts`); the webhook verifies the signature over those exact bytes instead
  of a re-serialised copy that could never match.

## Environment variables

All optional — the defaults are what production should run with. Listed in
`deploy/.env.production.example`.

| Variable                                  | Default          | Meaning                                                             |
| ----------------------------------------- | ---------------- | ------------------------------------------------------------------- |
| `TRUST_PROXY`                             | `1`              | Proxy hops allowed to set `X-Forwarded-For`. `true` is read as `1`. |
| `CORS_ALLOWED_ORIGINS`                    | production sites | Browser origins allowed with credentials.                           |
| `HEALTH_TOKEN`                            | empty            | Unlocks build details on `/api/health` via `X-Health-Token`.        |
| `ORDER_MAX_UNPAID_PER_USER`               | `2`              | Unpaid orders one customer may hold.                                |
| `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS`      | `86400`          | Oldest Mini App init data accepted.                                 |
| `REALTIME_MAX_ANONYMOUS_SOCKETS`          | `5000`           | Anonymous sockets open at once.                                     |
| `REALTIME_ANONYMOUS_MAX_AGE_SECONDS`      | `1800`           | When an anonymous socket is recycled.                               |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | —                | Already required; now enforced at startup in production.            |

## Deploying this branch

Nothing needs to change on the server for it to work. Step by step:

1. Before merging, confirm `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` in
   `/opt/takeaway/repo/deploy/.env.production` are real random values (not
   `CHANGE_ME`). `deploy.sh` refuses to continue otherwise.
2. Optional: add `HEALTH_TOKEN=$(openssl rand -hex 24)` to `.env.production`.
3. Deploy as usual (push to `main`). The migration runs in `deploy.sh`. The
   nginx config is validated by the `nginx config` workflow on every push that
   touches `deploy/nginx`, in the production image.
4. Check, from your machine:
   ```bash
   curl -sI https://takeaway.md/ | grep -iE 'strict-transport|x-frame|content-security|permissions'
   curl -sI https://admin.takeaway.md/ | grep -iE 'x-frame|content-security'
   curl -sI https://tma.takeaway.md/ | grep -iE 'x-frame|content-security'   # no X-Frame-Options
   curl -s https://api.takeaway.md/api/health                                 # {"status":"ok","commit":"…"}
   ```
5. Open the Mini App in Telegram on a phone **and** in https://web.telegram.org
   — both must load. Place a test order in the mobile app; open the kitchen
   board and check it updates live.

Rollback: revert the merge and deploy. The migration only adds a nullable
column; it can stay.

## Owner TODO — not done in code

### Cloudflare

1. **SSL/TLS → Overview → Full (strict).** The origin has a valid Let's
   Encrypt certificate for all seven names. Watch the certificate renewal:
   with Full (strict) an expired origin certificate takes the site down.
2. **Authenticated Origin Pulls** (SSL/TLS → Origin Server → Authenticated
   Origin Pulls → On, zone-level). Then, on our nginx (TLS terminates there,
   not at the edge): download Cloudflare's origin-pull CA to
   `/opt/takeaway/letsencrypt/cloudflare-origin-pull-ca.pem` and add to every
   443 server block in `deploy/nginx/conf.d/`:
   ```nginx
   ssl_client_certificate /etc/letsencrypt/cloudflare-origin-pull-ca.pem;
   ssl_verify_client on;
   ```
   This is what makes `CF-Connecting-IP` unforgeable — only Cloudflare can then
   connect. **It also breaks `smoke-test.sh` and `server-check.sh`**, which
   call the origin directly with `curl --resolve`: give them a client
   certificate, or switch them to the API container
   (`docker compose exec api wget -qO- http://127.0.0.1:3000/api/health`)
   in the same change.
3. **WAF → Rate limiting rule**: e.g. `http.request.uri.path matches
"^/api/auth/"` → 30 requests / 1 minute per IP → Block 10 minutes. This
   stops floods before they reach the shared host.
4. **Security → Bots → Bot Fight Mode: On.** Check afterwards that the
   Agroprombank callbacks (`/api/payments/agroprombank…`) and Poster webhooks
   (`/api/pos/webhooks/…`) still arrive (add a WAF skip rule for those paths if
   not).

### Shared host (coordinate with the neighbouring project first)

5. **Firewall 80/443 to Cloudflare's ranges** (https://www.cloudflare.com/ips/).
   The edge on this host also serves projects that may not be behind
   Cloudflare, so agree with them first; Docker publishes ports through
   iptables and bypasses ufw, so the rule belongs in the `DOCKER-USER` chain.
6. **Redis password**: `requirepass` in the compose command and
   `REDIS_URL=redis://:<password>@redis:6379`. Redis is only on the internal
   network today, but the 2026-06-12 incident showed how easily networks get
   shared on this host.
7. **MinIO least privilege**: create a user with a policy limited to the
   uploads bucket and give the API that user instead of the root credentials.
8. **Container limits**: `mem_limit` / `cpus` for api, postgres, redis, minio,
   nginx in `docker-compose.prod.yml`, so one runaway container cannot starve
   the neighbours.
9. **Poster webhook secret** on production (`settings.webhookSecret` of the
   Poster integration); without it the webhook accepts unsigned events.

### Backups

10. The `damaskin/takeaway-backups` repository keeps plaintext dumps from
    before encryption was introduced in its history. Rewrite the history
    (`git filter-repo`), force-push, and delete old clones.
11. Back up MinIO (`minio_data` volume — logos and photos) as well, not only
    Postgres.
12. Do a restore test into a scratch database at least once a quarter.

## Dependency upgrades

`pnpm audit` on 2026-10-11: 7 critical, 129 high (most in build tooling). A
separate branch should upgrade, test and deploy these. Production runtime
first:

| Package                                               | Now                    | Target                        | Why it matters                            |
| ----------------------------------------------------- | ---------------------- | ----------------------------- | ----------------------------------------- |
| `fastify`                                             | 5.8.4                  | ≥ 5.12.2                      | the HTTP server of the API                |
| `@nestjs/platform-fastify` (+ `@nestjs/*` 11.x)       | 11.1.19                | ≥ 11.1.24                     | brings fastify/find-my-way along          |
| `find-my-way`                                         | 9.5.0                  | ≥ 9.7.0                       | router (via fastify)                      |
| `@fastify/static`                                     | 9.1.1                  | ≥ 10.1.1                      | Swagger UI assets                         |
| `socket.io` → `engine.io` / `socket.io-parser` / `ws` | 6.6.6 / 4.2.6 / 8.18.x | ≥ 6.6.10 / ≥ 4.2.7 / ≥ 8.21.0 | realtime gateway                          |
| `nodemailer`                                          | 8.0.5                  | ≥ 8.0.8                       | password-reset and receipt mail           |
| `axios` (+ `form-data`)                               | 1.15.0                 | ≥ 1.20.0 (form-data ≥ 4.0.6)  | outgoing HTTP                             |
| `multer`                                              | 2.1.1                  | ≥ 2.3.0                       | listed dependency                         |
| `@aws-sdk/client-s3` → `fast-xml-builder`             | 1.1.5                  | ≥ 1.1.7                       | MinIO uploads                             |
| `@angular/*`                                          | 21.2.9                 | ≥ 21.2.24                     | all SPAs (router, core, common, compiler) |

Build and dev tooling (not shipped to production, still worth a sweep):
`nx` / `@nx/*` ≥ 22.7.9, `@angular/cli` / `@angular/build` (pulls `tar`,
`piscina`, `vite`, `undici`, `proxy-addr`), `ts-jest` → `handlebars` ≥ 4.7.10,
`prisma` → `deepmerge-ts` ≥ 8, `postcss` ≥ 8.5.18, `js-yaml`, `brace-expansion`.
