# Environments: staging and production

Since October 2026 every change reaches customers in two steps: it lands on
**staging** (test.takeaway.md) the moment it is merged, is checked there, and
is then **released** to production by a tag. Nothing goes to production that
has not run on staging first.

|                | Staging                                                     | Production                                   |
| -------------- | ----------------------------------------------------------- | -------------------------------------------- |
| Storefront     | https://test.takeaway.md                                    | https://takeaway.md                          |
| Cabinet        | https://test-admin.takeaway.md                              | https://admin.takeaway.md                    |
| Mini App       | https://test-tma.takeaway.md (bot @takeaway_test_bot)       | https://tma.takeaway.md (bot @takaway_tgbot) |
| API / CDN      | test-api.takeaway.md / test-cdn.takeaway.md                 | api.takeaway.md / cdn.takeaway.md            |
| Deploys        | every push to `main`, automatically                         | a release tag `vYYYY.MM.DD`, after approval  |
| Data           | a sanitized copy of production (see below)                  | real                                         |
| Card payments  | a fake bank — test cards, no money (see below)              | Agroprombank («Клевер»), live                |
| Search engines | `X-Robots-Tag: noindex, nofollow`                           | indexed                                      |
| On the server  | `/opt/takeaway-staging`, compose project `takeaway-staging` | `/opt/takeaway`, compose project `takeaway`  |

Both run on the same host (hetzner), side by side, behind the same shared
edge nginx. They share nothing else: own containers, volumes, database,
MinIO, Redis, images (`takeaway/api:staging` vs `takeaway/api:local`),
secrets and Telegram bot.

The mobile apps talk to production only. A staging build of the app is not
set up yet.

## How a task gets to customers

1. **Branch from `main`, open a PR into `main`.** CI runs lint, tests and
   builds on the PR.
2. **Merge.** `Deploy to staging` puts `main` on test.takeaway.md (about 20
   minutes, mostly the SPA builds) and smoke-tests it.
3. **Check it on staging** — the owner, the manager, whoever tested the task.
   Something wrong: a new PR, back to step 2.
4. **Release.** When what is on staging is what should go out:
   - move `[Unreleased]` in `docs/CHANGELOG.md` under a heading with the
     release's date, in a PR like any other;
   - tag the commit that was checked on staging (usually `origin/main`):
     ```bash
     git fetch origin
     git tag -a v2026.10.20 origin/main -m "Release 2026.10.20"
     git push origin v2026.10.20
     ```
     or GitHub → Releases → _Draft a new release_ → tag `v2026.10.20`,
     target `main` → _Publish_. A second release on the same day is
     `v2026.10.20.2`.
5. **Approve.** `Deploy to production` first checks that the commit is on
   `main` and that staging has deployed it (or a later commit containing it),
   then waits on the `production` environment: GitHub asks the owner to
   approve (Actions → the run → _Review deployments_). After approval it
   deploys and runs the same server-side smoke test as before.

Because `main` is what the next release ships, unfinished work that has to
be merged early goes behind a flag (`DELIVERY_ENABLED`-style), not into a
long-lived branch.

### Rollback

Actions → _Deploy to production_ → _Run workflow_ → tag = the previous
release. Older releases pass both checks, so no flag is needed. Database
migrations are not rolled back: a release whose migration drops or reshapes
data needs its own way back, decided before it is released. The least it
gets is a snapshot right before the deploy is approved —
`bash /opt/takeaway/repo/deploy/scripts/snapshot-db.sh deploy-v2026.10.20`
as root on the server. It is encrypted and expires after 30 days; never a
bare `pg_dump` (`deploy/README.md`, «Daily operations»).

### Emergency fix

Preferred: a PR into `main`, staging, a tag — the normal path, just fast.
If `main` already holds something that must not go out yet: branch from the
last release tag, fix, tag that commit, and run _Deploy to production_ by hand
with `skip_checks` — then bring the fix into `main` as well.

### App versions

Platform releases are dated tags (`v2026.10.20`); the mobile apps keep their
own versions (`1.6.0`) and release branches. Only `vYYYY.MM.DD…` tags deploy
the server.

## Staging's data

Staging starts as a copy of production taken with
`deploy/scripts/staging-refresh.sh`. The copy keeps brands, stores, menus,
orders and accounts, so testing looks like the real product, and the script
cuts everything that could reach a real person or a real system from it
(`deploy/scripts/sql/staging-sanitize.sql`):

- push targets (`Device` — FCM, APNs, browser subscriptions) are deleted;
- bank card tokens and bindings in flight are deleted;
- Poster integrations are disconnected and their credentials cleared — they
  were sealed with production's `POS_CREDENTIALS_KEY`, which staging does not
  have anyway;
- campaigns and announcements that had not gone out are marked failed;
- picture URLs point at staging's CDN, whose bucket gets a copy of production's.

Staging's environment is the other wall: its own Telegram bot (a test order
cannot message a café's real staff), card payments against a fake bank,
Google and Apple sign-in off, no push credentials, no SMTP.

It still holds real people's names and phone numbers. Staging is for the
team only — do not hand its links to customers or cafés.

Refreshing it again replaces everything on staging with production's current
data (staging is down for about a minute):

```bash
ssh hetzner
sudo -u deploy bash /opt/takeaway-staging/repo/deploy/scripts/staging-refresh.sh
```

After production's clean start (below) a refresh copies the new, real
production — run it only when that is what you want.

### Signing in on staging

- **Customers** — Telegram via @takeaway_test_bot: the web's «Войти через
  Telegram», or the bot's «Заказать» button for the Mini App. The test bot
  knows the same Telegram accounts, so a copied customer signs in as themself.
- **Staff** — login (email) and password, the same as they were in
  production when the copy was taken.
- **Kitchen PIN** — works: staging shares production's `KDS_PIN_SECRET` on
  purpose, so the copied PINs are valid. Production gets a fresh secret at its
  clean start.
- **Telegram for staff notifications** — linked through @takeaway_test_bot:
  staging's API registers the test bot's webhook
  (`TELEGRAM_WEBHOOK_URL=https://test-api.takeaway.md/api/telegram/webhook`,
  `TELEGRAM_WEBHOOK_SECRET`) at every start. See docs/staff-access.md.

### Paying by card on staging

Staging's api talks to a fake bank instead of Agroprombank: the sandbox the
payment tests run against (`tools/agroprombank-mock`), in the container
`takeaway-staging-agro-mock-1`. It speaks the bank's protocol, signs and
checks signatures like the bank, and moves no money; the live merchant never
sees a staging order. It runs when staging's `deploy/.env.production` says
`EXTRA_COMPOSE_FILES=docker-compose.staging.yml` (below, «Card payments on
staging»).

As in production, the checkout uses a **bound card** (`CARD_PAYMENT_FLOW=token`),
charged when the kitchen accepts the order:

- Bind a card in the profile: any **last four digits** except `0000`, any
  phone, any issuer.
- The **SMS code is always `111111`**. Another code is refused, three wrong
  ones burn the request — as at the bank.
- Card `0000` is refused at binding; an order of exactly **666.00** is
  declined for insufficient funds. Everything else is approved.
- Cards bound before a `staging-refresh.sh` are gone after it (the copy drops
  card tokens); bind again. A redeploy keeps them — the fake bank stores what
  it issued in a volume.

**Web-платёж** — the bank's own page — works too. Set `CARD_PAYMENT_FLOW=web`
in staging's `deploy/.env.production` and redeploy (or recreate the api); the
checkout then sends the customer to
`https://test-api.takeaway.md/sandbox-bank/PaymentStart`, a page with
«Оплатить» and «Отказаться», and back to the order. 666.00 is declined there
too. `AGROPROMBANK_HOLD_UNTIL_ACCEPTED=true` in the same file tries holds
(authorize at checkout, capture on accept), which production's terminal
refuses.

What the fake bank did: `docker logs takeaway-staging-agro-mock-1` on the
server — every call, decision and code. Invoices it sees start with `9`
(production's start with `1`).

## Production's clean start (October 2026)

All the data in production until October 2026 was testing. Production is
emptied once, down to the platform administrators: every brand, store, menu,
order, payment, promo, gift card, campaign and every account except
`SUPER_ADMIN` go, plus the uploaded pictures and Redis. The schema, migration
history and the bank's invoice sequence stay.

```bash
ssh hetzner
bash /opt/takeaway/repo/deploy/scripts/wipe-business-data.sh --yes-wipe-production   # as root
```

It stops the API for the minute it takes, writes a full backup first
(`/opt/takeaway/backups/pre-wipe-<time>.sql.gz.enc` and
`…-uploads.tar.gz.enc`, encrypted with `BACKUP_ENCRYPTION_KEY` like every
backup and deleted after 30 days — copy them elsewhere if they must live
longer), runs
`sql/wipe-business-data.sql` in one transaction that checks every foreign key
before committing, then starts the API. Afterwards give production a fresh
`KDS_PIN_SECRET` (`openssl rand -hex 32` → `deploy/.env.production`, then
`docker compose … up -d --force-recreate api`).

Wait for: App Review of the current app version to finish (an empty app is a
classic rejection), and staging to hold its copy.

## Server layout

```
/opt/takeaway/                 production
  repo/                        checkout at the released commit (detached)
    deploy/.env.production     production's settings and secrets
  www/ letsencrypt/ secrets/ backups/ backup-repo/ certbot-webroot/
/opt/takeaway-staging/         staging
  repo/                        checkout at the last commit of main (detached)
    deploy/.env.production     staging's — its first block says which copy this is
  www/ letsencrypt/ secrets/
docker volumes takeaway-staging_sandbox_bank_keys    the fake bank's key pairs, made on its first start
               takeaway-staging_sandbox_bank_state   what it issued: cards, operations, invoices
```

Staging runs with one more compose file, `deploy/docker-compose.staging.yml`
(the fake bank), because its `.env.production` names it in
`EXTRA_COMPOSE_FILES`. Every deploy script takes the file list from
`takeaway_compose_files` in `lib/env.sh`, which refuses any extra file for a
production copy — by its root, its checkout, its project name or its host
names — so production cannot start against the fake bank.

`deploy/scripts/lib/env.sh` reads which copy a checkout is from its
`deploy/.env.production` (`TAKEAWAY_ROOT`, `COMPOSE_PROJECT_NAME`,
`IMAGE_TAG`, host names) and refuses to touch Docker when that disagrees with
where the checkout actually is — a staging file that lost
`COMPOSE_PROJECT_NAME` would otherwise address production's containers. The
nginx vhosts are templates (`deploy/nginx/conf.d/*.conf.template`) rendered
per environment by `deploy/scripts/render-nginx.sh`.

The shared edge routes staging's six names to `takeaway-staging-nginx-1`
(`deploy/scripts/edge-staging-routes.sh`; the lines also belong in the rayn
repository's `infra/edge/nginx.conf`, whose deploy resets that file). ACME
challenges for staging go through production's webroot, which is the one the
edge serves for every takeaway.md name.

## One-time setup (2026-10-18)

1. Cloudflare DNS: `test`, `test-api`, `test-admin`, `test-kds`, `test-tma`,
   `test-cdn` — A records to the host, proxied, like production's. Flat names
   (`test-admin`, not `admin.test`) because Cloudflare's free certificate
   covers one level of subdomains.
2. Telegram: @takeaway_test_bot — OpenID Connect login (redirect URIs
   `https://test.takeaway.md/login`, `https://test-admin.takeaway.md/telegram-link`;
   trusted origins test, test-admin, test-tma), Main App and menu button
   «Заказать» → test-tma. Token in `D:\MyWorks\_secrets\takeaway\staging-telegram-bot.env`.
3. `deploy/scripts/staging-bootstrap.sh` (as root) — directories, checkout,
   staging's `.env.production` with secrets of its own.
4. First deploy, as `deploy`: `bash /opt/takeaway-staging/repo/deploy/scripts/deploy.sh`.
5. `deploy/scripts/edge-staging-routes.sh` (as root).
6. Certificate, as `deploy` in the staging checkout:
   `bash deploy/scripts/issue-cert.sh <email>`; renewal cron as root:
   `0 4 * * 2 deploy bash /opt/takeaway-staging/repo/deploy/scripts/renew-cert.sh >> /var/log/takeaway-staging-cert.log 2>&1`
   in `/etc/cron.d/takeaway-staging-renew-cert`.
7. `deploy/scripts/staging-refresh.sh` (as `deploy`) — the data.
8. GitHub → Settings → Environments: `staging`, and `production` with the
   owner as required reviewer and deployments limited to `v*` tags.

Added later (2026-10-20, the bot webhook for staff notifications): the
bootstrap writes `TELEGRAM_WEBHOOK_URL` and `TELEGRAM_WEBHOOK_SECRET` into a
new staging `.env.production`; the existing one gets the two lines by hand —
`TELEGRAM_WEBHOOK_URL=https://test-api.takeaway.md/api/telegram/webhook` and
`TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)` — then the next deploy (or
`docker compose … up -d --force-recreate api`) registers the webhook.

## Pre-deploy snapshots: one-time step (October 2026)

**Done 2026-10-19** (with the owner's OK): `/opt/takeaway/backups` is
`deploy:deploy 750`. Kept here for a rebuilt host.

From the release that brings `deploy/scripts/deploy.sh`'s pre-deploy snapshot,
a production deploy writes into `/opt/takeaway/backups` as `deploy`, the user
CI connects as. That directory was made by root's nightly cron as
`root:root 755`, so before that release, once, as root:

```bash
chown deploy:deploy /opt/takeaway/backups && chmod 750 /opt/takeaway/backups
```

Only the directory, not the files in it. The nightly keeps working (root
writes anywhere) and its files stay root's. Without this step the release
stops before it changes anything and prints the same command.
`deploy/scripts/server-check.sh` shows who owns the directory.

Why not `sudo` from `deploy.sh`: it would tie every deploy to `deploy`'s
passwordless sudo, which should not be the thing that keeps backups working,
and a snapshot owned by the user who took it is simpler to reason about.

## Card payments on staging: one-time step (October 2026)

A staging bootstrapped after this was added has the line already. One
bootstrapped before it (the first one, 2026-10-18) gets it by hand, once:

1. Staging's checkout must hold `docker-compose.staging.yml` — the next
   `Deploy to staging` after it is in `main`.
2. On the server:
   ```bash
   ssh hetzner
   echo 'EXTRA_COMPOSE_FILES=docker-compose.staging.yml' \
     | sudo -u deploy tee -a /opt/takeaway-staging/repo/deploy/.env.production
   sudo -u deploy bash /opt/takeaway-staging/repo/deploy/scripts/deploy.sh
   ```
   The deploy builds the fake bank, which makes its keys on first start,
   recreates the api and nginx with it, and reloads the edge. Production is
   not touched: its own `.env.production` is a different file, and its deploy
   refuses that line.
3. Check: the deploy's smoke test says `sandbox bank: payment page routed`;
   `https://test-api.takeaway.md/api/config/features` answers
   `agroprombankEnabled: true`, `cardPaymentFlow: "token"`; bind a card in
   the Mini App or on the site (code `111111`), order, accept it on the
   kitchen board — the order is paid.

To switch card payments off again, delete the line and deploy: the api then
sees `AGROPROMBANK_ENABLED=false` from the same file. The fake bank's
container and volumes stay until removed by hand
(`docker rm -f takeaway-staging-agro-mock-1`,
`docker volume rm takeaway-staging_sandbox_bank_keys takeaway-staging_sandbox_bank_state`).

## Not on staging yet

- **Google and Apple sign-in** — need the test-\* origins registered in Google
  Cloud and Apple Developer.
- **A staging build of the app** pointing at test-api.takeaway.md.
- **Email** — no SMTP in either environment.
