# takeAway production deploy

Docker Compose deploy for the live installation behind `takeaway.md`.

## Where this actually runs

Not a dedicated VPS. takeAway shares a host (SSH alias `shmidt01`) with
another project that owns ports 80 and 443, and the two are deliberately kept
apart at the network level. The disk — roughly 15 GiB for everything on the
box — is the reason `deploy.sh` prunes the build cache on the way out; a full
disk has taken production down before.

Request path:

```
Cloudflare
  → edge-nginx            (the other project's; owns 80/443)
      ssl_preread routes by SNI, TCP only — no TLS termination here
  → takeaway-nginx-1:443  (ours; terminates TLS, holds the certificates)
      ├── static SPA assets from /opt/takeaway/www
      └── /api → takeaway-api-1:3000
```

Two consequences worth internalising:

- **Certificates are ours.** The edge only moves bytes; `issue-cert.sh` and
  `renew-cert.sh` still run here.
- **Recreating `takeaway-nginx-1` needs an edge reload.** The edge caches the
  upstream address, so a fresh container means `docker exec edge-nginx nginx
-s reload` — otherwise every domain serves 502. `deploy.sh` does this for
  you whenever `docker-compose.shared-edge.override.yml` is present on the
  host.

### Do not

- **Do not attach takeAway containers to `rayn-prod_default`.** The other
  project's `postgres` resolves there, and Prisma dies with P1000 against
  credentials that are not ours. This is what `scripts/integrate-rayn-nginx.sh`
  used to do — it is legacy and must not be run on this host.
- **Do not run `scripts/init-env-production.sh` against live production.** It
  rewrites the Postgres password, after which the container cannot open the
  existing volume.
- **Do not commit `.env.production`, anything under `deploy/ssh/`, or host
  keys.**

### Branch

Production builds from **`infra/migrate-takeaway-md`**, not `main`. The
checkout lives at `/opt/takeaway/repo`.

## Layout

```
deploy/
  Dockerfile.api            NestJS multistage build
  Dockerfile.spa            Universal Angular SPA multistage build (one app per invocation)
  docker-compose.prod.yml   postgres + redis + minio + api + nginx + certbot (+ tools profile)
  docker-compose.shared-edge.override.yml
                            Host-local. Present only on the shared host; makes
                            deploy.sh reload the edge instead of our own nginx.
  .env.production.example   Copy to .env.production and fill in
  nginx/
    nginx.conf              Top-level config (gzip, WS upgrade map, include conf.d)
    snippets/               Shared location blocks
    conf.d/                 HTTPS vhosts, one per subdomain
  scripts/
    deploy.sh               Full deploy: build + extract SPAs + migrate + reload
    extract-spa.sh          Build and atomically swap SPA assets into /opt/takeaway/www
    issue-cert.sh           One-off Let's Encrypt issuance for all subdomains
    renew-cert.sh           Weekly cron renewal with automatic nginx reload
    migrate.sh              Prisma migrate deploy
    backup-to-github.sh     Nightly encrypted dump (see Daily operations)
  ssh/                      SSH keypair for CI/CD (gitignored)
```

## DNS

A-records, all pointing at the host, all proxied through Cloudflare:

```
takeaway.md
www.takeaway.md
api.takeaway.md
admin.takeaway.md
kds.takeaway.md
tma.takeaway.md
cdn.takeaway.md
```

## Deploying

The normal path, from your machine:

```bash
ssh deploy@<host>
cd /opt/takeaway/repo
git fetch origin
git reset --hard origin/infra/migrate-takeaway-md
bash deploy/scripts/deploy.sh
```

`deploy.sh` is idempotent and safe to re-run. It refuses to start if
`POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` or
`POS_CREDENTIALS_KEY` are missing from `.env.production` — failing in the
first second beats a CrashLoopBackOff discovered after a twenty-minute SPA
build.

It runs: build the API image → bring up postgres/redis/minio → wait for
Postgres → build and swap the four SPAs → `prisma migrate deploy` → bring up
api + nginx → reload whichever nginx is in front → prune the build cache.

### First-time setup on a new host

Only relevant if the installation is ever rebuilt from scratch.

1. Docker + Compose v2, UFW limited to 22/80/443, unattended-upgrades, swap,
   a `deploy` user in the `docker` group.
2. Clone to `/opt/takeaway/repo`, `cp deploy/.env.production.example
deploy/.env.production`, fill in the secrets.
3. `bash deploy/scripts/deploy.sh` — nginx comes up on a throwaway
   self-signed cert so ACME challenges can be served.
4. `bash deploy/scripts/issue-cert.sh you@yourdomain.com`, then reload nginx.
5. Weekly renewal cron, as root:
   ```
   0 4 * * 1 /opt/takeaway/repo/deploy/scripts/renew-cert.sh >> /var/log/takeaway-renew.log 2>&1
   ```

## Daily operations

All compose commands below run from `/opt/takeaway/repo/deploy`. On the
shared host, add `-f docker-compose.shared-edge.override.yml` after the first
`-f` — or just use `deploy.sh`, which assembles the file list itself.

- **Tail API logs:**
  ```bash
  docker compose -f docker-compose.prod.yml logs -f api
  ```
- **psql shell:**
  ```bash
  docker compose -f docker-compose.prod.yml exec postgres psql -U takeaway
  ```
- **Health:** `https://api.takeaway.md/api/health` reports the build version;
  `/api/health/ready` is the deploy gate and checks Postgres and Redis.

- **Backup (nightly, automated):** `scripts/backup-to-github.sh`, driven by
  cron. It dumps, compresses and encrypts in one pipe — the plaintext never
  reaches disk — keeps 14 days locally and mirrors the ciphertext into a
  private git repo. It requires `BACKUP_ENCRYPTION_KEY` and refuses to run
  without it: the dump holds customer names, emails, phones and order
  history, and git history keeps everything ever pushed, forever, across
  every clone. Losing a night's backup is recoverable; publishing a plaintext
  customer database is not. Destroying the key renders every copy unreadable,
  which is how an erasure request is honoured against immutable backups.

- **Restore from a backup:**

  ```bash
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -pass env:BACKUP_ENCRYPTION_KEY -in pg-YYYY-MM-DD.sql.gz.enc \
    | gunzip \
    | docker compose -f docker-compose.prod.yml exec -T postgres psql -U takeaway takeaway
  ```

- **Ad-hoc dump (unencrypted — keep it on the box):**
  ```bash
  docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U takeaway takeaway | gzip > backup-$(date +%F).sql.gz
  ```

## Troubleshooting

| Symptom                                | Cause                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Every domain serves 502                | `takeaway-nginx-1` was recreated; the edge still holds the old upstream. `docker exec edge-nginx nginx -s reload`. |
| Prisma P1000 on boot                   | The api container joined `rayn-prod_default` and is resolving the wrong `postgres`. Detach it.                     |
| API container will not open its volume | `init-env-production.sh` was run against live prod and rotated the Postgres password.                              |
| Deploy dies mid-build, disk full       | Shared 15 GiB disk. `docker builder prune -f` and `docker image prune -f`.                                         |
