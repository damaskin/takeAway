# Staff access: kitchen tablets, PINs, Telegram, passwords

How the people of a business get into takeAway, since round 2026-10-20
(owner decision 3, manager items 2, 8 and 14).

| Who            | Cabinet (admin.takeaway.md)            | Kitchen tablet | Work notifications        |
| -------------- | -------------------------------------- | -------------- | ------------------------- |
| Platform admin | email + password                       | —              | Telegram (linked via bot) |
| Brand owner    | email + password                       | —              | Telegram (linked via bot) |
| Store manager  | email or login + password              | PIN            | Telegram (linked via bot) |
| Kitchen staff  | email or login + password, **or none** | PIN            | Telegram (linked via bot) |
| Menu editor    | email or login + password              | —              | —                         |

## Kitchen tablets

A tablet is bound to one brand (`KitchenDevice`) and keeps a long-lived
token. It is bound by somebody of the brand opening «Кухня» on it while
signed in, or by opening a one-time link (24 h) made on «Сотрудники» →
«Планшеты кухни» — the same block now also sits on the store editor's
«Доступ на кухню» tab. Unbinding is on the same block.

## The kitchen PIN

- **One PIN per person for every store they work at in the brand.** It is
  set, changed and reset on the person's card (`/staff/:userId`), by the
  owner, a platform admin, or a store manager for their own kitchen staff.
- Stored as HMAC-SHA256(`KDS_PIN_SECRET`, `${brandId}|${pin}`) in
  `User.kdsPinHash` with `User.kdsPinBrandId`; unique per brand (partial
  index `User_kdsPinBrand_uniq`). A PIN already used at the brand — as
  somebody's brand PIN or as an old store PIN of one of its stores — is
  409 `KDS_PIN_TAKEN`.
- A new PIN is exactly 6 digits and not a first guess (one digit six
  times, a straight run): 400 `KDS_PIN_FORMAT` / `KDS_PIN_TOO_SIMPLE`.
- Only kitchen staff and store managers have one. Someone who also works
  for another brand cannot get one (409 `KDS_PIN_MULTI_BRAND`) and signs in
  on the tablet with a password.
- Changing or resetting a PIN ends the person's tablet sessions (their
  refresh tokens are revoked; the next request of a PIN session whose PIN
  is gone is refused at once). Their password sessions stay.
- Taking a person off every store of the PIN's brand resets the PIN.
- Without `KDS_PIN_SECRET` nothing PIN-related works: 503
  `KDS_PIN_NOT_CONFIGURED`.

### PINs set before 2026-10-20

They were per store (`kdsPinStoreId`, HMAC of `${storeId}|${pin}`) and keep
working on that one store until the person gets a new PIN or it is reset.
The card says «Старый PIN открывает только точку …». The store-centric
endpoints of older admin builds (`PUT/DELETE
/admin/stores/:storeId/staff/:userId/kds-pin`) now set and reset the brand
PIN as well.

## Signing in on the tablet

`/login/pin` shows the brand and the keypad — no store first.

```
POST /auth/kds/pin { pin, deviceToken, storeId? }
```

1. The tablet token is checked (401 `KDS_DEVICE_REQUIRED` /
   `KDS_DEVICE_UNKNOWN`) before any PIN is counted.
2. The PIN is looked up as the brand PIN, then as an old PIN of each of the
   brand's stores. Two people sharing an old PIN at different stores: 409
   `KDS_PIN_STORE_REQUIRED` (not counted as a failure) — the tablet asks
   for the store and sends the PIN again with `storeId`.
3. Lockouts are per tablet and brand: 5 free wrong PINs, then pauses of
   1, 2, 4 … 60 minutes (429 `KDS_PIN_LOCKED` with `retryAfterSeconds`); 100
   wrong PINs an hour across the brand's tablets pause the brand for 15
   minutes. nginx (10/min) and the API (8/min) throttle per address on top.
4. The answer carries `kdsBrandId`, `kdsStores` (the person's stores in the
   brand) and `kdsStoreId` (the one the board opens on). With more than one
   store the tablet asks «Где вы сегодня работаете?»; the board's store
   picker then switches between them **without the PIN again**.

## A PIN session

It reaches only routes marked `@KdsSessionAllowed()` — the kitchen board
(`/kds/*`), the stop-list, the brand and stores it needs to draw them, the
tablet binding, and the Telegram link — and on those only the person's
stores in the tablet's brand (403 `KDS_SESSION_LIMITED` /
`KDS_SESSION_STORE` otherwise). The cabinet shows «Кухня», «Стоп-лист» and
«Telegram», and no «Написать в поддержку» or «Сменить пароль».

Design:

- The access token carries `kdsb` (the tablet's brand) and `kds` (the store
  it opened on); the refresh session in Redis keeps both, so a refresh never
  widens it. `kds` alone is what builds before 2026-10-20 understood: a
  rolled-back API narrows such a session to that one store.
- The stores are **not** in the token. `JwtStrategy` reads the person's
  stores in `kdsb` from `UserStore` on every request
  (`AuthenticatedUser.kdsStoreIds`) and ends the session when the person's
  PIN no longer belongs to the brand. Taking someone off a store takes the
  store out of their tablet session immediately.
- Tokens and refresh sessions from before carry `kds` only; their brand is
  the store's (a store that is gone ends the session).
- The realtime gateway keeps the brand on the socket and lets a PIN socket
  follow the kitchens of the person's stores in that brand.

## Kitchen staff without a login

The invite form («Пригласить сотрудника») has «Как сотрудник входит» for the
Кухня role: «Только по PIN на планшете кухни» — a name, stores and a PIN.
The account has no email, login or password (`passwordHash` null): it
unlocks the kitchen tablet of its stores and cannot sign in to the cabinet.

- `POST /admin/staff { role: 'STAFF', name, pin, storeIds }` — other roles
  get 400 `STAFF_SIGN_IN_REQUIRED`. With an email or a login the temporary
  password stays required, and a PIN may come along for kitchen staff and
  managers (400 `KDS_PIN_ROLE` for a menu editor).
- The owner adds a way in later on the card («Вход в кабинет»):
  `PUT /admin/staff/:userId/sign-in { email | login, tempPassword }` (owner,
  platform admin; 409 `STAFF_HAS_SIGN_IN` for someone who already has one).
  An email gets the invite letter with a set-password link.
- «Сбросить пароль» on such an account answers 409 `STAFF_NO_SIGN_IN`.

## Telegram for work notifications

Notifications to staff, owners, riders and platform admins (new orders,
store alerts, POS errors, campaign verdicts, customer feedback) go to
`User.telegramNotifyChatId`. That is separate from `User.telegramUserId`,
the customer's Telegram sign-in, so:

- linking never conflicts with the person's own customer profile in the
  Mini App (it used to fail with "already linked to another user");
- a Telegram sign-in on the site or in the Mini App never lands in a staff
  account: a Telegram id still sitting on a staff account (linked on the
  old page) is moved off it at that moment — the account keeps the chat for
  notifications — and the sign-in opens a customer profile. A customer who
  links that Telegram account in «Способы входа» takes it over the same way.
- Customers' order pushes are unchanged (`telegramUserId`).

The migration `20261020110100_staff_telegram_notify` copied `telegramUserId`
into `telegramNotifyChatId` for every non-customer account, so everybody who
had linked before keeps getting messages.

### Linking through the bot

On «Telegram» (`/telegram-link`, also in a PIN session on the tablet):

1. «Привязать Telegram» → `POST /auth/telegram/notify-link` → a one-time
   `https://t.me/<bot>?start=link_<code>` for 10 minutes (a new one voids
   the previous; Redis keeps only the code's SHA-256). The page shows it as
   a QR code (generated in the browser, `qrcode-generator`) and as a link.
2. The person opens it on their own phone; Telegram starts the bot with
   `/start link_<code>`.
3. Telegram posts that to `POST /api/telegram/webhook`; the API links the
   chat and the bot answers «Готово! Уведомления о заказах для «…» будут
   приходить сюда. Отключить — на странице «Telegram» в кабинете.» A used
   or expired link gets «Ссылка устарела или уже использована…».
4. The page asks `GET /auth/telegram/notify-link` every 3 s and shows
   «Привязано».

«Отвязать» — `DELETE /auth/telegram/notify-link` — clears the chat.

Without a webhook on the server (`botLinkAvailable: false`) a password
session gets the older Telegram sign-in button instead; it now sets the
notification chat too.

### The webhook

- Public, trusted only with `X-Telegram-Bot-Api-Secret-Token` equal to
  `TELEGRAM_WEBHOOK_SECRET` (compared in constant time): 404 without a
  configured secret, 401 with a wrong one, 200 for every update with the
  right one (Telegram resends anything else).
- Only `/start` in a private chat is answered: `link_<code>` as above;
  `/start` alone or with another payload — a short greeting with a button
  that opens the Mini App (`PUBLIC_TMA_URL`). Everything else is ignored.
- Limits: 300 requests a minute per address (Telegram's servers), 5
  answers a minute per chat.
- `TelegramWebhookRegistrar` calls `setWebhook` (with `secret_token`,
  `allowed_updates: ["message"]`) at API start — only when
  `TELEGRAM_WEBHOOK_URL` and `TELEGRAM_WEBHOOK_SECRET` are set,
  `NODE_ENV=production` and the URL is https. A developer machine whose
  `.env` holds the production token never registers anything. A refusal is
  logged; the API runs on.
- A bot has one webhook: once it is set, nothing may poll the bot with
  `getUpdates`.

## Passwords

- **An employee** — «Сбросить пароль» on their card (owner, platform admin):
  a generated temporary password shown once, `passwordMustChange`, every
  session ended, earlier set-password links voided, a new link mailed when
  SMTP is configured.
- **A brand owner** — «Сбросить пароль» on «Владелец бренда»
  (`/staff/owner`), platform admins only:
  `POST /admin/brands/:brandId/owner/reset-password`, the same rules. An
  owner account that is a platform admin is refused (403
  `STAFF_NOT_EDITABLE`).
- **One's own** — «Сменить пароль» next to «Выйти» (password sessions) opens
  `/change-password` with a way back; the other sessions are signed out. The
  first sign-in with a temporary password still lands there with no way
  around it.
- «Забыли пароль?» mails a link and needs SMTP; production has none, so
  until it does the resets above are the way back in.

## Endpoints

| Method and path                                    | Who                                    | What                                        |
| -------------------------------------------------- | -------------------------------------- | ------------------------------------------- |
| `POST /auth/kds/pin`                               | a bound tablet                         | PIN sign-in, store optional                 |
| `PUT /admin/staff/:userId/kds-pin`                 | owner, platform admin, store manager   | set the person's PIN                        |
| `DELETE /admin/staff/:userId/kds-pin`              | same                                   | reset it                                    |
| `PUT /admin/staff/:userId/sign-in`                 | owner, platform admin                  | add an email or login to a PIN-only account |
| `POST /admin/staff`                                | owner, platform admin, store manager   | invite; PIN-only for kitchen staff          |
| `POST /admin/brands/:brandId/owner/reset-password` | platform admin                         | reset the owner's password                  |
| `GET/POST/DELETE /auth/telegram/notify-link`       | staff, owners, riders, platform admins | status / one-time bot link / unlink         |
| `POST /api/telegram/webhook`                       | Telegram (secret header)               | the bot's messages                          |

## Environment

| Variable                  | Where            | Meaning                                                            |
| ------------------------- | ---------------- | ------------------------------------------------------------------ |
| `KDS_PIN_SECRET`          | already required | HMAC key of every PIN; rotating it invalidates all PINs            |
| `TELEGRAM_BOT_TOKEN`      | already set      | the bot that sends notifications and answers the webhook           |
| `TELEGRAM_BOT_USERNAME`   | already set      | the `t.me/<bot>` of the link                                       |
| `TELEGRAM_WEBHOOK_URL`    | new              | `https://api.takeaway.md/api/telegram/webhook`; empty — no webhook |
| `TELEGRAM_WEBHOOK_SECRET` | new              | 16–256 of `[A-Za-z0-9_-]`, `openssl rand -hex 32`                  |
| `PUBLIC_TMA_URL`          | already set      | the Mini App button under the bot's greeting                       |

Staging: `deploy/scripts/staging-bootstrap.sh` writes the two new variables
for the test bot; see docs/environments.md for the existing staging host.

## Turning the bot link on in production

1. In `/opt/takeaway/repo/deploy/.env.production` add
   `TELEGRAM_WEBHOOK_URL=https://api.takeaway.md/api/telegram/webhook` and
   `TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32>`.
2. Make sure nothing else polls @takaway_tgbot with `getUpdates` (a webhook
   stops that), and that Cloudflare does not challenge
   `/api/telegram/webhook` (Bot Fight Mode / WAF: add a skip rule for the
   path, as for the bank and POS callbacks).
3. Deploy (or recreate the api container). The API log says
   `Bot webhook registered`. Check with
   `curl https://api.telegram.org/bot<token>/getWebhookInfo` — the URL,
   `allowed_updates: ["message"]`, no `last_error_message`.
4. Open «Telegram» in the cabinet, link a phone, receive a test order.
