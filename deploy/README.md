# takeAway production deploy

Docker Compose-based deploy for a single-VPS production installation.
Target: Hetzner Cloud CX22 / 4GB RAM / Ubuntu 24.04 LTS.

## Layout

```
deploy/
  Dockerfile.api            NestJS multistage build
  Dockerfile.spa            Universal Angular SPA multistage build (builds one app per invocation)
  docker-compose.prod.yml   postgres + redis + api + nginx + certbot (+ tools profile)
  .env.production.example   Copy to .env.production and fill in
  nginx/
    nginx.conf              Top-level config (gzip, WS upgrade map, include conf.d)
    snippets/               Shared location blocks
    conf.d/                 HTTPS vhosts (bootstrap self-signed cert used on first boot)
  scripts/
    deploy.sh               Full deploy: build + extract SPAs + migrate + nginx reload
    extract-spa.sh          Build and atomically swap SPA assets into /opt/takeaway/www
    issue-cert.sh           One-off Let's Encrypt cert issuance for all 5 subdomains
    renew-cert.sh           Weekly cron renewal with automatic nginx reload
    migrate.sh              Prisma migrate deploy
  ssh/                      SSH keypair for CI/CD (gitignored)
```

## First-time setup

Already done on the provisioned server:

- Docker + Compose v2 installed via get.docker.com
- UFW open for 22 / 80 / 443 only
- unattended-upgrades enabled
- 2 GB swap file
- `deploy` user in the `docker` and `sudo` groups

Still to do:

1. **DNS** — point these A-records at the server IP:

   ```
   takeaway.md
   api.takeaway.md
   admin.takeaway.md
   kds.takeaway.md
   tma.takeaway.md
   ```

2. **Clone the repo** to `/opt/takeaway/repo`:

   ```bash
   sudo mkdir -p /opt/takeaway && sudo chown deploy:deploy /opt/takeaway
   cd /opt/takeaway
   git clone https://github.com/damaskin/takeAway.git repo
   cd repo/deploy
   cp .env.production.example .env.production
   # Fill in POSTGRES_PASSWORD, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
   ```

3. **First deploy** (bootstraps self-signed certs + brings up everything):

   ```bash
   bash scripts/deploy.sh
   ```

   Nginx comes up with a throwaway self-signed cert so ACME challenges can
   be served. HTTPS will show an error until step 4.

4. **Issue the real Let's Encrypt certificate** (DNS must already resolve):

   ```bash
   bash scripts/issue-cert.sh you@yourdomain.com
   ```

   Then reload nginx to pick up the real cert:

   ```bash
   docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
   ```

5. **Weekly renewal cron** (as root):
   ```
   0 4 * * 1 /opt/takeaway/repo/deploy/scripts/renew-cert.sh >> /var/log/takeaway-renew.log 2>&1
   ```

## Daily operations

- **Redeploy from main:**
  ```bash
  cd /opt/takeaway/repo && git pull && bash deploy/scripts/deploy.sh
  ```
- **Tail API logs:**
  ```bash
  cd /opt/takeaway/repo/deploy
  docker compose -f docker-compose.prod.yml logs -f api
  ```
- **psql shell:**
  ```bash
  docker compose -f docker-compose.prod.yml exec postgres psql -U takeaway
  ```
- **Backup DB (nightly, automated):** `deploy/scripts/backup-to-github.sh`, driven by cron.
  It dumps, compresses and encrypts in one pipe — the plaintext never reaches
  disk — keeps 14 days locally and mirrors the ciphertext into a private git
  repo. Requires `BACKUP_ENCRYPTION_KEY` and refuses to run without it: the
  dump holds customer names, emails, phones and order history, and git
  history keeps everything ever pushed, forever, across every clone. Losing a
  night's backup is recoverable; publishing a plaintext customer database is
  not. Destroying the key renders every copy unreadable, which is how an
  erasure request is honoured against immutable backups.

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
