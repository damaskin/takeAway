# Customer sign-in: Telegram, Google, Apple

Customers never have a password. They sign in with one of three providers:

| Client                | Telegram              | Google                   | Apple                         |
| --------------------- | --------------------- | ------------------------ | ----------------------------- |
| Telegram Mini App     | automatic (initData)  | —                        | —                             |
| Website `takeaway.md` | Telegram Login popup  | Google Identity Services | Sign in with Apple JS (popup) |
| iOS app (TestFlight)  | Telegram Login (PKCE) | `google_sign_in`         | native `sign_in_with_apple`   |
| Android app           | Telegram Login (PKCE) | `google_sign_in`         | —                             |

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
remaining method cannot be removed.

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

No private key is needed: the API only verifies Apple's ID tokens.

## Where the values go

Server, `deploy/.env.production` (then redeploy):

```
GOOGLE_OAUTH_CLIENT_IDS=<web client id>,<iOS client id>
APPLE_OAUTH_CLIENT_IDS=md.takeaway.ios,md.takeaway.web
GOOGLE_OAUTH_WEB_CLIENT_ID=<web client id>
APPLE_OAUTH_SERVICES_ID=md.takeaway.web
APPLE_OAUTH_REDIRECT_URI=https://takeaway.md/login
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
