# Customer sign-in: Telegram, Google, Apple, a code by email

Customers never have a password. They sign in with one of three providers, or
with a one-time code mailed to them:

| Client                | Telegram              | Google                   | Apple                         | Code by email    |
| --------------------- | --------------------- | ------------------------ | ----------------------------- | ---------------- |
| Telegram Mini App     | automatic (initData)  | —                        | —                             | —                |
| Website `takeaway.md` | Telegram Login popup  | Google Identity Services | Sign in with Apple JS (popup) | «Войти по почте» |
| iOS app (TestFlight)  | Telegram Login (PKCE) | `google_sign_in`         | native `sign_in_with_apple`   | «Войти по почте» |
| Android app           | Telegram Login (PKCE) | `google_sign_in`         | —                             | «Войти по почте» |

Each client obtains a signed OpenID Connect ID token and posts it to the API
(`/auth/telegram/oidc`, `/auth/google`, `/auth/apple`), which verifies the
signature against the provider's JWKS and checks `iss`, `aud` and `exp`.
A provider with no client ids configured is switched off on the server and its
button is hidden in every client.

## One customer, several ways in

Sign-in resolves to a profile in this order:

1. The provider account was seen before → that profile.
2. Google or Apple vouch for a **verified** email that a customer already has
   → linked to that customer. Staff accounts are never linked this way.
3. Otherwise a new customer.

Step 2 cannot help a customer who started in the Telegram Mini App: Telegram
shares no email. For them, **Profile → Sign-in methods** (website and app)
links the other providers explicitly (`/auth/me/sign-in-methods`). When the
provider already has its own profile:

- that profile has no orders → the provider moves to the current profile;
- the current profile has no orders → its providers move to the other one and
  the client switches to it (the response carries a new session), so the
  customer ends up where their order history is;
- both have orders → refused; joining histories, loyalty and saved cards is
  left to support.

Telegram cannot be unlinked (the Mini App signs in by Telegram id without
asking, so unlinking would quietly open an empty profile), and the last
remaining method cannot be removed. A proven email (below) counts as a method.

## Sign-in with a code by email

For customers with none of the three providers — a mail.ru address and no
Telegram. It needs SMTP on the server: without `SMTP_HOST` the API answers 503
`EMAIL_LOGIN_UNAVAILABLE` and the website and the app hide the button.

```
GET  /auth/methods                    → { email, google, apple, telegram }   (public)
POST /auth/email/start  { email, locale? } → 204
POST /auth/email/verify { email, code }    → the same session as /auth/google
```

- Clients show «Войти по почте» only while `GET /auth/methods` says
  `email: true`, i.e. the server has SMTP.
- `start` answers 204 for every well-formed address, whether a profile has it
  or not, and never looks the address up. The letter is one short paragraph,
  in Russian when `locale` starts with `ru` and in English otherwise:
  «Код для входа в takeAway: 123456. Он действует 10 минут. Если вы не
  запрашивали код — просто проигнорируйте письмо.» The subject carries no code
  (MailService logs subjects).
- A code lives 10 minutes; a new one replaces the previous one. Five wrong
  tries delete it. One address gets a code once a minute and five an hour; on
  top of that the throttler allows a client address 5 starts and 10 verifies a
  minute. Redis keeps the code only as an HMAC keyed by a secret derived from
  `JWT_ACCESS_SECRET`, and the address only as an HMAC in the key names.

Refusals carry a stable `code`, which the clients word:

| Status | `code`                         | When                                                                                                          |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 503    | `EMAIL_LOGIN_UNAVAILABLE`      | no SMTP on the server                                                                                         |
| 503    | `EMAIL_CODE_NOT_SENT`          | the mail server refused the letter; the address may ask again at once                                         |
| 429    | `EMAIL_CODE_COOLDOWN`          | a code went to the address under a minute ago (`retryAfterSeconds`); the clients go straight to the code step |
| 429    | `EMAIL_CODE_LIMIT`             | five codes to the address this hour (`retryAfterSeconds`)                                                     |
| 400    | `EMAIL_CODE_INVALID`           | wrong code (`attemptsLeft`)                                                                                   |
| 400    | `EMAIL_CODE_EXPIRED`           | no code, timed out or already used                                                                            |
| 400    | `EMAIL_CODE_TOO_MANY_ATTEMPTS` | the fifth wrong try; the code is gone                                                                         |
| 401    | `EMAIL_LOGIN_STAFF_ACCOUNT`    | the address belongs to a staff or admin account                                                               |

The account is found by the same rules as a Google sign-in with a verified
address:

1. A customer whose address is **proven** (`emailVerifiedAt` — set by an
   earlier code, by Google or by Apple) → that profile.
2. An address that was only typed into a profile (`PATCH /auth/me`) is not
   proof: the address moves to a new profile and the other one is not opened,
   so nobody can plant a victim's address on their own profile and wait.
3. A staff or admin account → refused; those sign in with a password.
4. Otherwise a new customer with the address proven and the language of the
   request.

So a customer who signed up with a code and later taps «Continue with Google»
with the same address lands in the same profile, and the other way round. The
proven address shows in Profile → Sign-in methods as «Почта» and counts as a
way in when Google or Apple is unlinked. While it is the profile's only way in,
`PATCH /auth/me` refuses to replace it (409 `EMAIL_IS_SIGN_IN_METHOD`): a newly
typed address is unproven, and the customer would lose the way back. There is no «link an email» button
yet: a Telegram customer who wants codes to lead into their profile links
Google with that address first.

Turning it on: fill `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
`SMTP_PASS` and `SMTP_FROM` in `deploy/.env.production` and redeploy the API.
Set SPF and DKIM for the sender's domain, or mail.ru files the codes as spam.

## What to create

### Google (Google Cloud Console → APIs & Services → Credentials)

1. OAuth consent screen: app name takeAway, support email, domain
   `takeaway.md`, scopes `openid`, `email`, `profile`. Publish it.
2. OAuth client **Web application**: authorised JavaScript origin
   `https://takeaway.md`. Its client id is the _web client id_.
3. OAuth client **iOS**: bundle id `md.takeaway.ios`, team `FGN8R2D6QW`. Its
   client id is the _iOS client id_.
4. OAuth client **Android** (when Android ships): package `md.takeaway.app`,
   SHA-1 of the release and debug signing keys. It needs no configuration in
   the app; Android tokens carry the web client id as their audience.

### Apple (developer.apple.com → Certificates, Identifiers & Profiles)

1. App ID `md.takeaway.ios` has the _Sign in with Apple_ capability (fastlane's
   `register_bundle_id` lane turns it on). Nothing else is needed for the app.
2. For the website: an **Services ID**, e.g. `md.takeaway.web`, with Sign in
   with Apple enabled, primary App ID `md.takeaway.ios`, domain `takeaway.md`
   and return URL `https://takeaway.md/login`.
3. A **key** with _Sign in with Apple_ enabled (Keys → +), primary App ID
   `md.takeaway.ios`. Download the `.p8` once and note its Key ID. Signing in
   does not need it — the API only verifies Apple's ID tokens — but deleting
   an account does: Apple requires the app to revoke the customer's Apple
   tokens, and the API signs its requests to Apple with this key. Without it
   the account is still deleted and the API logs a warning.

## Where the values go

Server, `deploy/.env.production` (then redeploy):

```
GOOGLE_OAUTH_CLIENT_IDS=<web client id>,<iOS client id>
APPLE_OAUTH_CLIENT_IDS=md.takeaway.ios,md.takeaway.web
GOOGLE_OAUTH_WEB_CLIENT_ID=<web client id>
APPLE_OAUTH_SERVICES_ID=md.takeaway.web
APPLE_OAUTH_REDIRECT_URI=https://takeaway.md/login
APPLE_TEAM_ID=FGN8R2D6QW
APPLE_KEY_ID=<key id>
APPLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
```

iOS build, `apps/mobile/config/prod.json` on the Mac that builds:

```
"GOOGLE_SERVER_CLIENT_ID": "<web client id>",
"GOOGLE_IOS_CLIENT_ID": "<iOS client id>",
"APPLE_SIGN_IN": "true"
```

fastlane's `archive` lane derives the iOS URL scheme (the reversed iOS client
id) from `GOOGLE_IOS_CLIENT_ID` into `ios/Flutter/GoogleLocal.xcconfig`, so
nothing in the repository needs editing.

## Checking it

- `https://api.takeaway.md/api/auth/google` with a junk token answers 401
  "Malformed identity token" when Google is configured, and "not configured on
  this server" when it is not.
- The login page on the website shows a button for each configured provider.
- In the TestFlight build, Profile → Sign-in methods lists all three and
  connects the missing ones.
- `https://api.takeaway.md/api/auth/methods` says `"email": true` once SMTP is
  set; then «Войти по почте» appears on the website and in the app, and a code
  sent to your own address signs you in.
