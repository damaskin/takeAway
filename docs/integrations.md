# POS integrations — operations guide

takeAway can plug into a brand's existing back-office (POS / cashier
system) to import the menu and stop-list, and push paid orders straight
to the kitchen. This document is for **brand admins** setting up the
integration, and for **ops** dealing with credentials in production.

Two providers are wired today:

| Provider                | Menu import | Stop-list | Outgoing orders | Incoming changes         |
| ----------------------- | ----------- | --------- | --------------- | ------------------------ |
| Poster (joinposter.com) | ✅ M2       | ✅ M2     | ✅ M3           | ✅ Webhooks (M4)         |
| iiko Cloud              | ⚙ M5+      | ⚙ M5+    | ⚙ M5+          | Polling (when M5+ lands) |

Adding a third provider is a matter of dropping in an `IPosProvider`
implementation and an enum value in `PosProvider`. See
`apps/api/src/app/pos/providers/pos-provider.interface.ts` for the
surface.

---

## 1. Server setup (one-time, ops)

### Generate the credentials encryption key

POS credentials are stored encrypted at rest with AES-256-GCM. The key
is `POS_CREDENTIALS_KEY` — 32 bytes, hex-encoded (so 64 hex chars).
Generate it once per environment:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put the result in `.env` (dev) or `.env.production` (prod). Rotating
this key invalidates every saved integration — every brand needs to
re-enter their POS credentials. There is no graceful key-rotation flow
yet, by design (M5 scope).

### Verify the rest of the stack

The POS surface needs Postgres, Redis (BullMQ queue + token cache) and
an admin who can sign in. Already configured for the rest of takeAway —
nothing new on top.

---

## 2. Connect Poster (joinposter.com)

Brand admins land on **`/integrations`** in the admin app
(SUPER_ADMIN sees every brand; BRAND_ADMIN sees their own).

### Step 1 — Get Poster credentials

In the Poster admin panel:

1. Settings → Integrations → **Server-to-server applications**.
2. Create an application. Note the **Application access token** — looks
   like `898253:7628142f8554549f7be0adf937c36c0b`. This is the _single_
   credential takeAway needs.
3. Note your **account subdomain** — the `<acc>` from
   `https://<acc>.joinposter.com`. This is what we send back to Poster
   when generating webhook callback URLs.

### Step 2 — Connect in takeAway

On `/integrations`, in the Poster card:

1. Paste the **API token** and **Account subdomain**.
2. Click **Connect**. takeAway pings `/api/access.ping` with the token
   to validate; on success the integration row stamps `CONNECTED`.

If the token is wrong, the form surfaces the Poster error message
verbatim. The encrypted copy of the token is only persisted on
successful validation.

### Step 3 — Pull data

The same card now shows three action buttons:

- **Import stores** — fetches `/api/spots.getSpots` and upserts into
  `Store` rows. Lat/lng default to `0,0`; the brand admin can edit
  them on `/stores` to enable proximity / ETA features.
- **Import menu** — pulls categories + products in parallel, maps decimal
  prices to cents (taking the max across per-spot price maps), drops
  hidden / zero-price products. Re-running converges by external
  identity — locally-managed catalog rows are never touched.
- **Refresh stop-list** — wipes Poster-contributed stop-list entries
  for the brand and reinserts the current set. Manually-added
  stop-list entries from the admin UI survive.

Each click enqueues a BullMQ job. The `Recent jobs` panel in the same
card shows progress live (polled every 3s while anything is running).

### Step 4 — Outgoing orders (paid → kitchen)

Once the integration is `CONNECTED`, every `PAID` order is
automatically pushed to Poster as an
`incomingOrders.createIncomingOrder`. Best-effort: if the push fails,
takeAway retries 3× with exponential backoff (30s base). On the final
failure all `BRAND_ADMIN`s with a linked Telegram receive a notification
so they can enter the order in the POS by hand.

The order keeps flowing through KDS regardless — a flaky POS never
blocks a paid customer.

### Step 5 — Webhooks (incoming changes)

Poster pushes menu / stop-list changes as webhooks. To receive them:

1. In the Poster admin, set the webhook URL to
   `https://<your-api-host>/api/pos/webhooks/poster/<brand-id>`.
   `<brand-id>` is the takeAway `Brand.id` — a SUPER_ADMIN can read it
   off `/admin/brands`; brand admins should ask ops.
2. Optionally generate a shared secret in Poster and set it on the
   integration via:

   ```bash
   curl -X POST https://api.takeaway.million-sales.ru/api/admin/pos/connect \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{"provider":"POSTER","credentials":{...},"settings":{"webhookSecret":"..."}}'
   ```

   Without the secret the endpoint accepts unsigned bodies and logs a
   warning. With it, every webhook body must carry an HMAC-SHA1 in the
   `verify` field or HMAC-SHA256 in `X-Poster-Signature`. Mismatch =
   silent reject (returns 200 to avoid leaking which brands have
   integrations).

The endpoint always returns **200** — both signature mismatch and "no
integration for this brand" translate to a quiet `accepted: false` so
random scanners can't enumerate brands.

---

## 3. Connect iiko Cloud

Currently the iiko adapter implements `testConnection` and
`listStores` only. Menu / stop-list / outgoing orders land in M5+ when
a real iiko-Cloud test account is available. The plug-in shape is
identical to Poster — flipping the provider's `supportsStopListPolling`
flag from `false` to `true` opts it into the every-30-min cron poller
(see `PosCronService`).

### Step 1 — Get iiko credentials

In the iiko Cloud admin (manager.iikoweb.ru → Settings → API):

1. Create an API user. Note the **apiLogin** — a single short string
   that doubles as both the login and the password (iiko Cloud
   convention).
2. Note the **organization id** if you want takeAway to pin to one
   organisation rather than fan out across every organisation the
   `apiLogin` has access to. Optional.

### Step 2 — Connect in takeAway

`/integrations`, iiko card → paste `apiLogin` (and optional
`organizationId`) → **Connect**. takeAway exchanges it for a bearer
token at `/api/1/access_token` and caches the token in Redis for 50
minutes; further imports reuse it.

### Step 3 — Import stores

Click **Import stores**. takeAway calls `/api/1/organizations` (skipped
when `organizationId` is set) and `/api/1/terminal_groups`, then
upserts every terminal group as a `Store`. The terminal-group id is
saved as `Store.externalId`.

### Step 4 — Other operations

Currently throw `NotImplementedException`. The endpoints (and the
admin-UI buttons) exist; clicking them just produces a `FAILED` job
with a clear "not available yet" message. Will land in M5+.

---

## 4. Operational notes

- **Re-imports never duplicate.** Slugs are stable
  (`pos-poster-product-{externalId}`) and uniqueness is enforced by
  `(brandId, externalProvider, externalId)`. Click _Import menu_ as
  often as you like.
- **Locally-managed catalog rows are untouched.** A category or
  product without `externalProvider` belongs to the admin UI's manual
  edit flow; the importer will not modify or delete it.
- **Disconnect doesn't delete catalog data.** Removing an integration
  drops the credentials and the BullMQ ties; the `Store` / `Category`
  / `Product` rows imported from that provider stay so historical
  orders remain readable. To wipe them, delete by hand or write a
  one-off script.
- **Mixed catalogs work.** A brand can import the bulk of the menu
  from Poster and add a couple of takeAway-only specials manually.
  Outgoing-order push silently drops items that aren't mapped to the
  active provider (with a warn log) so the rest of the order still
  reaches the till.
- **Webhook URL leak.** The webhook URL contains the takeAway brand
  id, so treat it like a low-sensitivity secret — anyone who knows it
  can submit unsigned events when no `webhookSecret` is configured.
  Configure the secret in production.

---

## 5. Troubleshooting

**`/integrations` shows "Not connected" after I clicked Connect.**
The connect call surfaces provider errors verbatim — re-check the token
and (Poster) the account subdomain.

**Sync job stays in `PENDING`.**
The BullMQ worker isn't draining the queue. Confirm Redis is reachable
(`redis-cli -h <host> -p <port> PING`) and the api container is up.

**Sync job goes `RUNNING → FAILED` immediately.**
Open `Recent jobs` and read the `errorMessage`. Common ones:

- `Poster API error 35: token is incorrect` — re-issue and re-connect.
- `iiko returned no organizations for these credentials` — the
  `apiLogin` doesn't have access to any organisation in the iiko admin
  panel. Re-check the user's role.
- `NotImplementedException: ... is not available yet` — iiko-only,
  the deliverable hasn't shipped yet.

**Orders aren't reaching Poster after PAID.**

1. Open the order in `/admin/orders`. If `posExternalId` is empty and
   `Recent jobs` for the integration shows no `ORDER_PUSH`, the
   integration was likely disconnected at the moment of payment.
2. If a job exists in `FAILED`, the BRAND_ADMIN should already have a
   Telegram alert. The order needs to be entered into the POS by hand;
   takeAway won't auto-retry past the 3-attempt budget.

**Webhook isn't doing anything.**

1. Confirm Poster is sending — its admin panel logs every webhook
   delivery.
2. Tail the api log for `Poster webhook for brand=...` lines.
3. If you see `signature mismatch, ignored` — the secret doesn't match.
4. If you see `no connected integration, ignored` — the brand id in
   the URL doesn't match a `CONNECTED` `PosIntegration` row.
