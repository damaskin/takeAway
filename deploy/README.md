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
  upstream address, so a fresh container means every domain serves 502 until
  it reloads. `deploy.sh` does this whenever
  `docker-compose.shared-edge.override.yml` is present on the host; by hand it
  is `bash deploy/scripts/edge-nginx.sh reload`.

  Do not hardcode the edge container's name. The neighbouring project's runbook
  calls it `rayn-prod-nginx-1` (the compose-generated container name) while
  their workflow and our handover notes both say `edge-nginx` (the compose
  service name). `edge-nginx.sh` tries both and then discovers it, because
  guessing wrong makes the reload a silent no-op and the resulting outage looks
  like our bug.

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
- **Do not restart, recreate or `docker compose down` anything belonging to the
  neighbouring project.** Reloading its nginx is the one sanctioned
  interaction, and `edge-nginx.sh` is how we do it. Its tree lives at
  `/opt/rayn-repo/infra/deploy`; certbot for the shared host is driven from
  there too.

### Dead addresses

`62.238.4.92` and `80.87.110.232` are former homes of this installation. The
first was hardcoded in the deploy workflow for months after it stopped being
ours; the provider has since reassigned it, and it now answers SSH with a
different host key. Never point a deploy at either, and never repair a host-key
mismatch with `ssh-keyscan` — that trusts whoever happens to answer.

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
    edge-nginx.sh           Find / validate / reload the shared edge nginx
    smoke-test.sh           Post-deploy gate, run on the server (see Deploying)
    server-check.sh         Read-only diagnostics — first step of any investigation
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

**Normally: push to `infra/migrate-takeaway-md`.** The `Deploy to production`
workflow runs `deploy.sh` over SSH, then runs `deploy/scripts/smoke-test.sh`
**on the server** — via `curl --resolve`, so it bypasses DNS and Cloudflare and
tests only the stack we own. The gate asserts the API is serving the commit
just deployed (a container that failed to restart keeps answering 200 from the
previous build), that Postgres and Redis are reachable, and that no SPA is
502ing behind a stale edge upstream. The public check that follows is
informational: a Cloudflare problem is not a bad build.

It needs four repository secrets:

| Secret               | Notes                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DEPLOY_HOST`        | Server address                                                                                                                                                                 |
| `DEPLOY_USER`        | Optional; defaults to `deploy`. The neighbouring project deploys to this host as `root` — if auth fails as `deploy`, that key is probably only in `/root/.ssh/authorized_keys` |
| `DEPLOY_SSH_KEY`     | Private key for that user                                                                                                                                                      |
| `DEPLOY_KNOWN_HOSTS` | The server's **public host key**, pinned                                                                                                                                       |

`DEPLOY_KNOWN_HOSTS` is the one that bites. If the workflow says there is no
entry for the host, take the key from the provider console or from
`cat /etc/ssh/ssh_host_ed25519_key.pub` over a session you already trust —
**never** from `ssh-keyscan` against the IP. Keyscan trusts whatever answers,
and this deploy already spent months pointed at an address that had been
decommissioned and reassigned to someone else.

The manual path, from your machine:

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

| Symptom                                | Cause                                                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Anything at all, before you theorise   | Run `bash deploy/scripts/server-check.sh` on the box. Read-only; reports checkout, env, containers, edge, health, SPAs, disk, logs. |
| Every domain serves 502                | `takeaway-nginx-1` was recreated; the edge still holds the old upstream. `bash deploy/scripts/edge-nginx.sh reload`.                |
| `bad interpreter: ...^M`               | A script was committed with CRLF from a Windows checkout. `.gitattributes` pins `*.sh` to LF; re-checkout the file.                 |
| Prisma P1000 on boot                   | The api container joined `rayn-prod_default` and is resolving the wrong `postgres`. Detach it.                                      |
| API container will not open its volume | `init-env-production.sh` was run against live prod and rotated the Postgres password.                                               |
| Deploy dies mid-build, disk full       | Shared 15 GiB disk. `docker builder prune -f` and `docker image prune -f`.                                                          |
