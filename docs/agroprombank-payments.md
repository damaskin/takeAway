# Agroprombank («Клевер») card payments

Tokenized card payments for Transnistria, implemented against _«Рекуррентные
платежи в ПС Клевер» v1.3_ (ЗАО «Агропромбанк», 2025).

The customer binds a card once — last four digits, phone, issuer, plus an SMS
one-time password — and every later charge runs against an opaque 64-character
token with no customer interaction. That is what makes one-tap checkout in the
Telegram mini app possible.

Card details never reach our servers, and the token, although it carries no PAN,
authorises charges on its own — so it is stored encrypted at rest.

A second flow, the bank's hosted payment page «Web-платёж», is described in
[section 11](#11-web-платёж-the-banks-payment-page). `CARD_PAYMENT_FLOW`
chooses which one the clients run.

A third, «Мобильный платёж» — an invoice paid by QR in the bank's own app —
is offered next to either; see
[section 12](#12-мобильный-платёж-paying-by-qr-in-the-banks-app).

---

## 1. What the bank gives you

Signing the merchant contract gets you:

| Value                    | Env var                              | Example     |
| ------------------------ | ------------------------------------ | ----------- |
| Merchant id              | `AGROPROMBANK_MERCHANT_ID`           | `M00012345` |
| Terminal id              | `AGROPROMBANK_TERMINAL_ID`           | `E1016682`  |
| Bank signing certificate | `AGROPROMBANK_BANK_CERTIFICATE_FILE` | PEM         |

You generate your own key pair; the bank issues the matching certificate.

## 2. Getting the merchant certificate

1. Open the CA at <https://ca.agroprombank.com> and follow the key-generation
   instructions there.
2. Step 1 — pick certificate type **«Нестандартный сертификат»**.
3. Step 2 — tick **«Показывать системные настройки»**, then in the expanded
   purpose tree choose
   **«Пластиковые карты» → «Система E-Commerce» → «Сертификат E-Commerce терминала»**.
4. Mark the key as exportable, and do **not** password-protect it — the server
   reads the PEM unattended at boot.
5. Keep the key identifier the CA shows on the last screen. The bank checks it
   against the request when the application for the certificate is signed, and
   the CA does not show it again.
6. Take the documents the CA regulations list to the bank. The certificate is
   issued off the request; nothing in the integration can be exercised against
   the real gateway until it is.
7. Once issued, export the key pair from the Windows certificate store as a
   `.pfx` and split it into the two PEMs the API reads:

   ```bash
   # private key — AGROPROMBANK_PRIVATE_KEY_FILE
   openssl pkcs12 -in merchant.pfx -nocerts -nodes -out agroprombank-private-key.pem
   # our own certificate — AGROPROMBANK_CERTIFICATE_FILE, required, because the
   # gateway will not verify a request that carries no <KeyInfo>
   openssl pkcs12 -in merchant.pfx -clcerts -nokeys -out agroprombank-certificate.pem
   ```

   `-nodes` leaves the key unencrypted, which is the point: the API reads it at
   boot with nobody there to type a passphrase. Both files belong on the server
   only, readable by the API user and nobody else (`chmod 600`).

   On the production host they go in `/opt/takeaway/secrets`, which the api
   container mounts read-only as `/run/secrets` — that is where the paths in
   `.env.production` point. Writing them straight into `/run/secrets` on the
   host instead would work until the next reboot, `/run` being tmpfs.

   Do the conversion on the server, so the key exists in exactly one place:

   ```bash
   # from your machine, with the .pfx exported from the Windows store
   scp merchant.pfx deploy@<host>:/tmp/merchant.pfx

   # on the server
   cd /opt/takeaway/secrets
   openssl pkcs12 -in /tmp/merchant.pfx -nocerts -nodes -out agroprombank-private-key.pem
   openssl pkcs12 -in /tmp/merchant.pfx -clcerts -nokeys -out agroprombank-certificate.pem
   shred -u /tmp/merchant.pfx

   # the api container runs as uid 10001, not as deploy
   sudo chown 10001:10001 agroprombank-private-key.pem
   sudo chmod 400 agroprombank-private-key.pem
   chmod 644 agroprombank-certificate.pem agroprombank-bank-certificate.pem
   ```

   The ownership step is the one that is easy to miss and hard to read back
   from the symptom: a key the container cannot open reports as the gateway
   being unconfigured, exactly as a missing key does. `/opt/takeaway/secrets`
   is 0751 for the same reason — the container has to traverse it — and the
   certificates are world-readable because certificates are public.

   OpenSSL 3 refuses the `.pfx` Windows writes — `digital envelope routines::
unsupported` — because Windows still wraps it in RC2. Add `-legacy` to both
   commands in that case; the resulting PEMs are identical.

8. Try taking the bank's certificate from the bank. Every response is signed,
   and an XMLDSig signature may carry the signer's certificate inline, in which
   case one harmless call settles it:

   ```bash
   docker run --rm \
     -v /opt/takeaway/secrets:/secrets:ro \
     -v /opt/takeaway/repo/tools:/tools:ro -v /tmp/agro:/out \
     -e AGROPROMBANK_MERCHANT_ID=M000... \
     -e AGROPROMBANK_PRIVATE_KEY_FILE=/secrets/agroprombank-private-key.pem \
     -e AGROPROMBANK_OUT=/out/agroprombank-bank-certificate.pem \
     node:22-alpine node /tools/agroprombank-fetch-bank-cert.mjs
   ```

   `tools/agroprombank-fetch-bank-cert.mjs` checks a token that cannot exist:
   it moves no money and creates nothing, and the rejection is as good as an
   acceptance, because what it is after is the signature. It is a single
   dependency-free file because it has to run on the production host, where the
   key is and where there is no `node_modules`. It prints the whole response,
   so a "no certificate inline" answer is at least a look at what the gateway
   really sends.

   Run against production on 21.09.2026 it answered: the certificate is there,
   in `<KeyInfo>`, and no correspondence was needed. `ЗАО "АГРОПРОМБАНК"`,
   issued by APB External CA, valid to 01.04.2027. It is in the repository as
   `testing/bank-response.fixture.ts` too, so the verifier is tested against a
   signature the bank really made rather than only against our own signer.

9. If the response carries no certificate, ask the bank for its signing
   certificate —
   `AGROPROMBANK_BANK_CERTIFICATE_FILE`. Without it the service refuses to
   start unless `AGROPROMBANK_VERIFY_RESPONSES=false`, and with verification
   off nothing but TLS separates a real "payment succeeded" from a forged one.

10. Check that the bank accepts _our_ signature. It is a separate question from
    the one above — the first production call came back `result=-1`, «Ошибка
    проверки подписи», while the response it rejected us with verified
    perfectly on our side. The documentation does not pin down the shape of
    `<Signature>` the gateway wants, so rather than guess one change at a time:

    ```bash
    docker run --rm \
      -v /opt/takeaway/secrets:/secrets:ro \
      -v /opt/takeaway/repo/tools:/tools:ro \
      -e AGROPROMBANK_MERCHANT_ID=M000... \
      -e AGROPROMBANK_PRIVATE_KEY_FILE=/secrets/agroprombank-private-key.pem \
      -e AGROPROMBANK_CERTIFICATE_FILE=/secrets/agroprombank-certificate.pem \
      node:22-alpine node /tools/agroprombank-signature-probe.mjs
    ```

    `tools/agroprombank-signature-probe.mjs` sends the same impossible
    CheckToken five times, varying `<KeyInfo>` (absent / certificate /
    certificate + `<RSAKeyValue>`) and the transform chain (enveloped alone /
    enveloped + exclusive c14n), and reports what the bank says to each. A
    variant that gets an answer about the token instead of about the signature
    is the one to configure. If every variant is refused, the disagreement is
    not about the XML and the bank has to check that our certificate is bound
    to the merchant on their side.

    Run on 21.09.2026 it answered both halves of the question at once. Without
    `<KeyInfo>` the gateway says «Ошибка проверки подписи» — so it does not
    identify us by merchant id, whatever the samples show, and
    `AGROPROMBANK_INCLUDE_KEYINFO` now defaults to on. With `<KeyInfo>` the
    message changed to a complaint about base64, which was ours: the
    certificate body was being folded together with the `Bag Attributes` and
    `subject=` lines `openssl pkcs12 -clcerts` writes above the PEM block. Both
    are fixed; the second is covered by a test.

The private key must live only on the server. The documentation is explicit
that storing key material client-side (mobile app, browser) compromises the
merchant key — our design keeps every bank call server-side for this reason.

## 3. Configuration

All settings are documented in [`.env.example`](../.env.example). The minimum
for a live deployment:

```bash
AGROPROMBANK_ENABLED=true
AGROPROMBANK_MERCHANT_ID=M00012345
AGROPROMBANK_TERMINAL_ID=E1016682
AGROPROMBANK_PRIVATE_KEY_FILE=/run/secrets/agroprombank-private-key.pem
AGROPROMBANK_CERTIFICATE_FILE=/run/secrets/agroprombank-certificate.pem
AGROPROMBANK_BANK_CERTIFICATE_FILE=/run/secrets/agroprombank-bank-certificate.pem
```

Our own certificate is in that list because `AGROPROMBANK_INCLUDE_KEYINFO`
defaults to on: the gateway refuses a request that does not carry it.

`AGROPROMBANK_VERIFY_RESPONSES` defaults to `true` and the service refuses to
start a call without the bank certificate. Setting it to `false` is only for the
integration window before the bank hands its certificate over — with it off,
nothing but TLS distinguishes a real "payment succeeded" from a forged one.

`AGROPROMBANK_HOLD_UNTIL_ACCEPTED` defaults to `true`: the card is authorized at
checkout and only debited when the store accepts the order — see «Hold at
checkout, capture on accept». Turn it off for a merchant whose acquiring
contract has no preauthorization. Production runs with it off: terminal
`E1043280` answers every preauthorization with `Invalid operation type
"Preauthorization" for terminal "E1043280"`, and every refund with `Invalid
operation type "Refund"`. With holds off the card is therefore charged only
when the store accepts the order — see «Charge on accept» below — so an order
the store turns down never needs money back. `AGROPROMBANK_CHARGE_AT_CHECKOUT=true`
restores the old charge at checkout (a rejected order then needs a manual
refund through the bank).

`AGROPROMBANK_INVOICE_PREFIX` must differ per environment. The `invoiceid` we
send has to stay unique for the entire life of the merchant contract, and a
staging deployment sharing production's numbering would collide with it. It is
**digits only**: the bank reads `invoiceid` as a number, and the first live
charges, sent with the prefix `TA`, all came back as .NET's "Input string was
not in a correct format." (`result=-1`). A prefix with anything but digits is
now reported as a missing setting and stops every call before it leaves.
Production uses `1`. The number after the prefix comes from the Postgres
sequence `agroprombank_invoice_seq` (from 100000), so ids read `1100000`,
`1100001`… — short, like the bank's own example `123456`. The timestamp +
random ids used before ran to 18 digits, and every charge that carried one
failed inside the bank ("Произошла ошибка", no operation on record). A
database restored from a backup rewinds the sequence: move it past the highest
invoice id the bank has seen (`SELECT setval('agroprombank_invoice_seq', …)`)
before taking payments again.

The brand's currency must be one the bank settles: `RUP` (Transnistrian rouble,
bank code `000`) in practice. `USD`, `EUR` and `MDL` are mapped too; anything
else is refused before a request goes out.

## 4. Transport

- Endpoint: `https://ws.agroprombank.com/merchant/MerchantCAPService.asmx`
  (the address inside the WSDL points at an internal cluster host — do not use
  it).
- SOAP 1.1, namespace `http://services.agroprombank.com`, SOAPAction
  `<namespace>/<Function>`.
- Every operation has the same signature: `Fn(merchantId, request) → string`,
  where `request` and the result are both signed XML documents.

Signature profile, fixed by the bank:

| Part             | Algorithm                                                |
| ---------------- | -------------------------------------------------------- |
| Canonicalization | Canonical XML 1.0 (`REC-xml-c14n-20010315`)              |
| Signature        | RSA-SHA256 (`xmldsig-more#rsa-sha256`)                   |
| Digest           | SHA-256 (`xmlenc#sha256`)                                |
| Reference        | one `<Reference URI="">` + enveloped-signature transform |

Implemented in [`xmldsig.ts`](../apps/api/src/app/payments/agroprombank/xmldsig.ts)
on top of a small canonical-XML implementation in
[`xml.ts`](../apps/api/src/app/payments/agroprombank/xml.ts) — no new runtime
dependency. Both directions are covered by round-trip tests, including a
pretty-printed response signed the way the bank signs it, which is the case a
naive re-serializing implementation gets wrong.

Note the bank's WSDL misspells one operation as `CompletePreAuthorizaion`. The
spelling is preserved deliberately; correcting it breaks the call.

## 5. Flows

### Binding a card

```
POST /api/payments/agroprombank/cards/bind
     { lastDigits, phone, institute, fio?, deactivateOld?, label? }
  → { bindingId, completed: false, expiresAt }      # bank SMSes the password

POST /api/payments/agroprombank/cards/bind/:bindingId/confirm
     { code }
  → { id, maskedPan, embossing, … }                 # token stored, encrypted
```

Prepaid cards short-circuit: the bank answers `NewTokenRequest` with the token
itself and the response comes back `completed: true` with the card attached.

The one-time password window is ten minutes and three attempts by default
(`AGROPROMBANK_BINDING_TTL_MINUTES`, `AGROPROMBANK_BINDING_MAX_ATTEMPTS`); both
endpoints are rate-limited on top of that.

### Paying

```
POST /api/payments/agroprombank/pay
     { orderId, cardId, tipCents? }
  → { paymentId, status, operationId, invoiceId, authCode, rrn, … }
```

The service checks the token (`CheckToken`) before every charge — a customer can
revoke a token in their banking app, and we would otherwise only learn that from
a declined payment. A successful charge settles the order through the shared
`OrderSettlementService`, so the KDS board, customer/staff push, loyalty credit,
POS push and receipt mail behave exactly as they do for Stripe.

### Hold at checkout, capture on accept

`AGROPROMBANK_HOLD_UNTIL_ACCEPTED` (on by default) decides whether the charge
above debits the card or only authorizes it. With it on:

1. Checkout sends `ProcessCardAutoPayment` with `preauth=1`. The `Payment` row
   sits in `REQUIRES_ACTION`, the order stays `CREATED`, and the customer's
   order screen says the money is on hold.
2. A staff member accepting the order on the KDS triggers
   `CompletePreAuthorizaion` for exactly the held amount — never the order's
   current total, because the customer only agreed to what they saw. The
   capture settles the order to `PAID`, and the accept then moves it to
   `ACCEPTED`. A bank refusal fails the accept, so the kitchen never starts on
   an unpaid ticket.
3. Cancelling the order releases the hold with `ReverseOperation`. That runs
   after the cancellation commits and never throws: the cancel itself is
   already done, an uncleared hold expires bank-side anyway, and the
   reconciliation cron picks the row up on the next pass.

The policy is not a client choice — `/pay` takes no `preauth` flag, so a
customer cannot ask for money to be frozen instead of taken. What was asked of
the bank is written onto the `Payment` row (`rawJson.requestedPreauth`) before
the call, so reconciliation after a timeout does not mistake a hold for a
capture: `CheckOperation` reports that an operation exists, not that it was
captured.

### Charge on accept (no hold)

With `AGROPROMBANK_HOLD_UNTIL_ACCEPTED=false` (and `AGROPROMBANK_CHARGE_AT_CHECKOUT`
unset) nothing about money reaches the bank at checkout:

1. `/pay` checks the token (`CheckToken`) and writes a `Payment` in
   `REQUIRES_ACTION` with no `invoiceId` and `rawJson.deferred = true`. The
   order stays `CREATED`, goes onto the kitchen board and staff are notified,
   exactly like a held order. The customer's order screen shows `HELD`
   ("charged when the store accepts").
2. Accepting on the KDS claims the row (`REQUIRES_ACTION` → `PENDING` with a
   fresh `invoiceId`, conditional update, so two accepts cannot both charge)
   and sends `ProcessCardAutoPayment` with `preauth=0` for the checkout amount.
   Success settles the order to `PAID` and the accept moves it to `ACCEPTED`.
   A transport failure leaves the row `PENDING` for the reconciliation cron.
3. A definitive refusal (declined card, revoked token, card unbound) fails the
   payment and cancels the order (`reason=CARD_DECLINED`): promo, gift card and
   points go back, the customer gets a push to order again with another card,
   and the KDS gets `400 {code: "CARD_DECLINED"}`.
4. Rejecting or expiring the order closes the row as `FAILED` with
   `rawJson.voided = true` — no bank call — and the customer sees no payment.

Ops can still capture by hand with
`POST /api/admin/payments/agroprombank/:paymentId/complete`, for up to 110% of
the held amount.

### Refunds and reversals

Back-office routes, brand-scoped through the order's store, open to
`SUPER_ADMIN`, `BRAND_ADMIN` and `STORE_MANAGER`:

| Route                                                | Effect                                 |
| ---------------------------------------------------- | -------------------------------------- |
| `GET  /api/admin/payments/agroprombank/:id`          | the bank's own record (`GetOperation`) |
| `POST /api/admin/payments/agroprombank/:id/refund`   | full or partial refund                 |
| `POST /api/admin/payments/agroprombank/:id/reverse`  | cancel before settlement               |
| `POST /api/admin/payments/agroprombank/:id/complete` | capture a preauthorization             |

Both refunds and reversals are irreversible on the bank side.

## 6. Money safety

Three rules shape the implementation, and changing them needs care:

1. **The `invoiceid` is allocated before the call, never reused.** It is the
   only handle the bank has on the operation, and every later call (reverse,
   refund, status) addresses the operation through it. The DB unique index — not
   the generator — is the actual guarantee.

2. **A transport failure leaves the payment `PENDING`, never `FAILED`.** A
   charge that times out mid-flight is genuinely ambiguous: the card may well
   have been debited. Marking it failed would hand out an unpaid order for money
   that was actually taken. The reconciliation cron
   (`agroprombank-reconcile`, every five minutes) asks the bank via
   `CheckOperation` until it answers, and a retry for the same order resolves
   the stale payment before sending anything new.

3. **Only a verified `result=1` flips the order to `PAID`.** A response whose
   signature does not verify is treated as a transport failure, not a success.

A composite transaction (payment plus a tip routed to an employee token) can
come back with `cos=0`, meaning only one leg settled. The customer was charged,
so the order is still paid, but the incident is logged for ops to chase.

## 7. Data model

| Table                | Purpose                                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CardToken`          | one bound card. `tokenCipher` is AES-256-GCM (same key as POS credentials, `POS_CREDENTIALS_KEY`); `tokenFingerprint` is a SHA-256 of the plaintext used for lookup and uniqueness. |
| `CardBindingRequest` | one binding attempt: bank request id, attempts, expiry.                                                                                                                             |
| `Payment`            | gains `invoiceId`, `tipCents` and `cardTokenId`.                                                                                                                                    |

`PaymentProvider` gains `AGROPROMBANK`; `Currency` gains `RUP`.

Two migrations, deliberately split: PostgreSQL refuses to _use_ an enum value
added by `ALTER TYPE` inside the same transaction that added it, and the second
migration uses `AGROPROMBANK` as a column default.

`RUP` has no ISO 4217 code. `Intl.NumberFormat` still formats it (as
`RUP 33,00`) because the code is well-formed, so nothing throws — but a nicer
symbol would need a shared money formatter, which does not exist yet.

## 8. Customer-facing UI

Telegram mini app:

- **Profile → Payment** opens `/cards`: list, set default, unbind, and the
  two-step binding form.
- **Checkout** shows a card picker when `agroprombankEnabled` is on, and the
  Telegram main button places the order and charges the selected card in one
  go. A declined charge keeps the order and retries against it rather than
  placing a duplicate.
- With no card bound, or with the flag off, checkout places the order unpaid —
  exactly how it behaved before this integration.

## 9. Testing before the bank issues credentials

Nothing here can talk to the real gateway without a bank-issued certificate, so
the repo ships a sandbox that speaks the same protocol —
`apps/api/src/app/payments/agroprombank/testing/sandbox-bank.ts`. It verifies
our signature and signs its own replies, so a broken canonicalization fails
against it exactly as it would fail against the bank.

The same implementation backs four things, which is why they cannot drift:

| Surface                                            | Command                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| Protocol test suite                                | `npx jest --config apps/api/jest.config.cts --testPathPatterns agroprombank` |
| Standalone gateway for local dev                   | `pnpm agro:mock`                                                             |
| Sandbox stack (API + Postgres + Redis + fake bank) | `deploy/docker-compose.sandbox.yml`                                          |
| Staging, test.takeaway.md                          | `deploy/docker-compose.staging.yml` — docs/environments.md                   |

On staging the mock runs with `AGRO_MOCK_OTP=111111` (one SMS code for every
binding, since testers cannot read its log) and `AGRO_MOCK_STATE_FILE` (what it
issued survives a restart, so bound cards keep working across deploys); its
Web-платёж page is served at `https://test-api.takeaway.md/sandbox-bank/PaymentStart`.

Local development against the mock:

```bash
pnpm agro:dev-keys
```

That prints the environment to paste into `.env` — endpoint, merchant id and
the generated key paths. Then `pnpm agro:mock` in one terminal and the API in
another.

Test affordances the sandbox offers, since there is no real SMS:

- `GET /__sandbox/otp/:requestid` — the one-time password the bank "sent"
- `GET /__sandbox/state` — every token request, token and operation
- card ending `0000` refuses to bind
- an amount of exactly `66600` is declined for insufficient funds

### Sandbox stack

`deploy/docker-compose.sandbox.yml` brings up an isolated stack — its own
compose project, network, volumes and database, so it cannot touch production:

```bash
docker compose -f docker-compose.sandbox.yml --env-file .env.sandbox up -d --build
```

The API binds to **loopback only**. Docker publishes ports straight into
iptables and bypasses ufw, so a normal port mapping would put a gateway backed
by a fake bank on the public internet. Reach it through a tunnel:

```bash
ssh -L 3100:127.0.0.1:3100 <host>
```

`tools/agroprombank-mock/smoke.mjs` then walks the whole customer path against
it — bind a card, order, charge, settle, refund, decline, unbind — asserting
the outcome at each step. It is re-runnable; it clears what the previous run
left behind.

## 10. Going live checklist

- [ ] Merchant certificate generated with the E-Commerce terminal purpose and
      installed as `AGROPROMBANK_PRIVATE_KEY_FILE`.
- [ ] Key material checked on the host that will use it:

      ```bash
      AGROPROMBANK_PROBE_OFFLINE=1 pnpm agro:probe
      ```

      It reports whether the certificate and the key are one pair, whether the
      certificate is inside its validity window, and whether the identifiers
      the bank stamped into it match `AGROPROMBANK_MERCHANT_ID` and
      `AGROPROMBANK_TERMINAL_ID`. Nothing leaves the host. Drop the variable to
      then make the one harmless call to the gateway.

- [ ] Bank certificate installed; `AGROPROMBANK_VERIFY_RESPONSES=true`.
- [ ] `AGROPROMBANK_INVOICE_PREFIX` distinct from every other environment.
- [ ] Brand currency set to `RUP`.
- [ ] Migrations applied (`pnpm prisma:deploy`).
- [ ] `AGROPROMBANK_ENABLED=true`.
- [ ] Decide the money-taking moment: `AGROPROMBANK_HOLD_UNTIL_ACCEPTED=true`
      (default) holds at checkout and captures on accept — confirm the acquiring
      contract allows preauthorization.
- [ ] One live low-value charge, then refunded from the admin route, with the
      bank's record checked via `GET /api/admin/payments/agroprombank/:id`. With
      holds on, walk the whole path: place the order, see it held, accept it on
      the KDS, see it captured, then place a second one and cancel it to confirm
      the hold is released.

---

## 11. Web-платёж: the bank's payment page

Implemented against _«Техническое описание настройки Интернет-магазина» v2.0_
(ЗАО «Агропромбанк», 2025). The customer types the card into the bank's own
page at `https://epay.apb.online/PaymentStart`; the bank tells us the result.
Nothing is bound, no key pair is needed, and card data never touches us.

The goal is the same as with bound cards: **money is taken only when the
kitchen accepts the order.** At checkout the page runs with `ispreauth=1`, so
the amount is only blocked; accepting the order on the KDS captures it
(`ComplitionOperation`); a cancel by the customer, a rejection by the kitchen,
or nobody accepting in time releases it (`CancelOperation`).

### 11.1 Choosing the flow

| Env                        | Effect                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CARD_PAYMENT_FLOW`        | `token` (default) — bound cards; `web` — the bank's page. Served to the clients as `cardPaymentFlow` in `GET /config/features` (`token` / `web` / `none`).                         |
| `AGROPROMBANK_WEB_ENABLED` | `web` takes effect only once this is on, so the switch can be set ahead of the bank's credentials. With it off the clients keep the bound-card flow (or none, if that is off too). |

`agroprombankEnabled` in the feature flags keeps meaning "bound cards work",
so app builds that predate `cardPaymentFlow` carry on with the bound-card flow.
Both flows can stay enabled at once: Web-платёж routes work regardless of
which one the clients are told to use, and a hold of either kind is captured,
released and refunded by the right bank call (`Payment.provider` is
`AGROPROMBANK` or `AGROPROMBANK_WEB`).

### 11.2 What to register at the bank

The bank registers fixed addresses — ResultURL may carry no query string at
all, which is why the routes below carry none:

| Item              | Value                                                       |
| ----------------- | ----------------------------------------------------------- |
| Resource name     | takeAway                                                    |
| ResultURL         | `https://takeaway.md/api/payments/agroprombank-web/result`  |
| ResultURL method  | POST (GET also works)                                       |
| SuccessURL        | `https://takeaway.md/api/payments/agroprombank-web/success` |
| SuccessURL method | GET (POST also works)                                       |
| FailURL           | `https://takeaway.md/api/payments/agroprombank-web/fail`    |
| FailURL method    | GET (POST also works)                                       |
| Support email     | help@takeaway.md                                            |
| Invoice lifetime  | 15 minutes                                                  |
| Logo, description | brand assets, ≤100 KB / ≤500 characters                     |
| Preauthorization  | **required** — ask for `ispreauth` on this merchant         |

All three routes are public and accept both methods with a query string or a
form body (`application/x-www-form-urlencoded`, which Nest's Fastify adapter
already parses), or JSON.

The bank then issues `MerchantLogin` (`AGROPROMBANK_WEB_MERCHANT_LOGIN`) and
`MerchantPass` (`AGROPROMBANK_WEB_MERCHANT_PASS` or `_FILE`). The pass signs
everything in both directions — treat it like a private key. The admin web
service's answers are signed with the bank's site certificate
(`AGROPROMBANK_WEB_BANK_CERT_FILE`).

### 11.3 Flow

```
POST /api/payments/agroprombank-web/start   { orderId, returnTo: web | tma | mobile }
  → { paymentId, invoiceId, status, page: { method: POST, action, fields, url } | null, expiresAt }
```

1. **Start.** Idempotent per order: an order already held or paid gets
   `page: null`; an earlier invoice still `PENDING` is checked with GetState
   first (if the customer paid it in another tab, that is the payment). Each
   start that needs a page issues a new `nivid` — from the same
   `agroprombank_invoice_seq` and `AGROPROMBANK_INVOICE_PREFIX` as the
   bound-card flow — signed
   `MD5(MerchantLogin:nivid:IsTest:RequestSum:RequestCurrCode:Desc:MerchantPass)`.
   `Desc` is ASCII (`takeAway order 4242`) on purpose, see the questions below.
   The web posts `fields` to `action` from a form; the TMA opens `url` with
   Telegram's `openLink`; the app opens `url` in an in-app browser.
2. **ResultURL.** The notification's MD5 is checked (paid:
   `invoiceid:status:paymentsum:paymentcurrency:date:pass`; fail:
   `invoiceid:status:date:pass`); a bad one gets HTTP 400 and changes nothing.
   Then — as the bank's scheme requires — the outcome is taken from **GetState**
   and only from there: `state=1` with `usepreauth=1` → `REQUIRES_ACTION`
   (HELD) and the order appears on the kitchen board; `usepreauth=0` →
   `SUCCEEDED` and the order is settled as paid. The answer is `200 OK`.
3. **SuccessURL / FailURL.** The customer's redirect reconciles the payment
   with GetState again (never trusting its parameters) and sends them, with a
   302, to their order: `PUBLIC_WEB_URL/orders/:id?payment=success|pending|fail`,
   `PUBLIC_TMA_URL/orders/:id?…` (or, when `PUBLIC_TMA_URL` is a
   `t.me/<bot>/<app>` link, `?startapp=order_<id>` so the mini app reopens in
   Telegram), or `MOBILE_PAYMENT_RETURN_URL?orderId=…&status=…`
   (`takeaway://pay`, the app's deep link). Only configured bases and our own
   ids go into the URL — it cannot be turned into an open redirect.
4. **Accept** on the KDS → `ComplitionOperation` for exactly the held amount
   → `SUCCEEDED`, order `PAID` → `ACCEPTED`. A refusal fails the accept.
5. **Release** → `CancelOperation`: customer cancel, kitchen rejection
   (`POST /kds/orders/:id/reject`), or expiry. Expiry: a held order waits
   `ORDER_ACCEPT_TTL_MINUTES` (30) for the kitchen, and a scheduled one at
   least until its pickup time plus `ORDER_ACCEPT_GRACE_MINUTES` (15).

Money-safety rules on top of section 6:

- A state change is claimed with a conditional update, so a notification and
  a redirect arriving in the same second settle the order once.
- Money that arrives for an order that cannot use it — cancelled, expired,
  already paid by another invoice, or an amount the bank changed — is given
  back straight away (hold: `CancelOperation`, retried by the cron; capture:
  `CancelOperation`, and a loud `REFUND NEEDED` log if the bank refuses).
- The reconciliation cron (`agroprombank-reconcile`, 5 min) asks GetState about
  every `PENDING` invoice older than two minutes — a lost notification is
  found there — and fails it once the page has stopped taking it (lifetime +
  5 minutes). The unpaid-order expiry spares an order whose latest payment
  attempt is younger than `ORDER_PAYMENT_TTL_MINUTES`, so nobody is expired
  while on the bank's page; keep `AGROPROMBANK_WEB_LIFETIME_MINUTES` at or
  below it.
- The same cron retries hold releases that failed (either flow): a hold on a
  cancelled or expired order, or one flagged for release, is retried up to 20
  times, then left with an error in the log.

Refunds from the admin (`POST /admin/orders/:id/refund`, and
`/admin/payments/agroprombank/:paymentId/{refund,reverse,complete}`) go to
the provider that took the payment. A full refund on the day of payment is
sent as `CancelOperation` (the charge disappears from the statement), falling
back to `RefundOperation`.

### 11.4 The bank's signature

The documentation says the admin web service answers with a base64 string
holding `<envelope><response>base64 XML</response><signature>base64</signature></envelope>`,
that the signature covers the response, and that the site certificate checks
it — not the algorithm. The verifier accepts RSA-SHA256 or RSA-SHA1, over the
decoded document or over its base64 text, and logs which variant matched
(debug level), so the first live call pins it down. Each variant is still a
signature only the bank's key can make. `AGROPROMBANK_WEB_VERIFY_RESPONSES=false`
switches the check off for the integration window; every call then logs a
warning. A bare response without the signing envelope is accepted only with
verification off.

### 11.5 Questions for the bank

1. What should the ResultURL response body be? We answer `200 OK` with text
   `OK`; is a specific body or status expected, and does the bank retry?
2. Is `InvoiceId` in the admin web service our `nivid`?
3. `complitionAmount` (and `refundAmount`) — kopecks, like `RequestSum`?
4. Does `CancelOperation` release a **preauthorization**? And after the day of
   payment — how is a hold released then (the documentation limits cancel to
   the same day; a scheduled order accepted tomorrow may need it)?
5. The algorithm and certificate of the response signature (11.4).
6. Encoding of `Desc` in the MD5 (UTF-8? CP1251?). We send ASCII until told.
7. Is `ispreauth=1` allowed for our Web-платёж merchant? (The bound-card
   terminal E1043280 refuses preauthorization.)
8. The WSDL namespace / SOAPAction of `APB.SV.WebPayment.AgentService.asmx`
   (we default to `http://services.agroprombank.com`,
   `AGROPROMBANK_WEB_NAMESPACE`), and the exact `GetState` answer for an
   invoice that was never opened.
9. Can a `nivid` be presented to `PaymentStart` again after the customer left
   the page? (We never do — every retry gets a new one.)

### 11.6 Sandbox

`pnpm agro:mock` serves a sandbox Web-платёж on `:8898` next to the bound-card
gateway: the page (`/PaymentStart`, with «Оплатить» / «Отказаться»), the
notification to `AGRO_WEB_MOCK_API_BASE/payments/agroprombank-web/result`,
and the admin web service, signing its answers as described above. `pnpm
agro:dev-keys` prints the environment for the API. Test affordances:
`POST /__sandbox/web/pay/:nivid`, `POST /__sandbox/web/decline/:nivid`,
`GET /__sandbox/web/state`; an amount of exactly `66600` is declined.

The same sandbox backs `agroprombank-web.e2e.spec.ts` (client and service end
to end, including capture, cancel, expiry, a lost notification and a forged
one) and the sandbox compose stack, where `tools/agroprombank-mock/smoke.mjs`
now walks the Web-платёж path too: page → pay → held → KDS accept
(ComplitionOperation) → customer cancel → kitchen reject → expiry.

### 11.7 Going live

- [ ] Registration at the bank with the addresses in 11.2; preauthorization
      enabled for the merchant.
- [ ] `AGROPROMBANK_WEB_MERCHANT_LOGIN`, pass in
      `/opt/takeaway/secrets/agroprombank-web-merchant-pass` (chown 10001,
      chmod 400), bank certificate in `agroprombank-web-bank-certificate.pem`.
- [ ] `PUBLIC_WEB_URL`, `PUBLIC_TMA_URL`, `MOBILE_PAYMENT_RETURN_URL` set.
- [ ] Migration `20261004120000_agroprombank_web_provider` applied.
- [ ] `AGROPROMBANK_WEB_ENABLED=true` with `AGROPROMBANK_WEB_IS_TEST=true`
      first: one order paid in test mode end to end, the log line
      "bank signature verified (…)" checked.
- [ ] `CARD_PAYMENT_FLOW=web`, `AGROPROMBANK_WEB_IS_TEST=false`; one live
      low-value order held, accepted (captured) and refunded from the admin;
      a second one cancelled to see the hold released.

## 12. Мобильный платёж: paying by QR in the bank's app

Implemented against _«Мобильный платеж. Веб сервис для работы с QR-кодом»_
(ЗАО «Агропромбанк»). The customer pays an invoice we issue on a QR terminal
(`QRT` + 15 digits) from the bank's own mobile app: they scan the QR code
shown at checkout or, on the phone itself, open the bank app through a link.
No card is bound, no key pair is needed, card data never touches us.

### 12.1 How it differs from the card flows

- **There is no hold.** A QR invoice, once paid, is money taken. To keep the
  rule «the kitchen only ever sees paid orders, and an order it turns down
  costs the customer nothing», a paid QR payment is parked on the order exactly
  like a hold: the `Payment` row goes to `REQUIRES_ACTION`, the order appears
  on the kitchen board, accepting it settles the row as `SUCCEEDED` **without
  any bank call**, and a customer cancel before the accept, a kitchen
  rejection or an expiry gives the money back with `ReversePayment`
  (`REFUNDED`, `Order.cancelMoney = REFUNDED`). `PaymentProvider` gains
  `AGROPROMBANK_QR`, and it joins `CARD_PROVIDERS`, so every hold rule in
  sections 5, 6 and 11 applies to it unchanged.
- **The bank's callback is not signed.** It is only a hint that something
  happened: the outcome is always read back with `GetPaymentStateExtId`
  (authenticated with our login over TLS), never taken from the callback.
- **One amount, RUP only.** No tips (the QR carries one sum), currency code
  `000` (рубль ПМР). A store selling in another currency cannot use it.
- **Full refunds only.** `ReversePayment` takes no amount, so the admin
  refund of a QR payment is all or nothing.

### 12.2 Configuration

| Env                                        | Meaning                                                                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AGROPROMBANK_QR_ENABLED`                  | Switches the QR payment on. It is offered **next to** the card flow (`CARD_PAYMENT_FLOW`), not instead of it: with both on the customer chooses at checkout, with cards off it is the only way to pay. |
| `AGROPROMBANK_QR_SERVICE_URL`              | default `https://api.agroprombank.com/mobile/QRMobileService.asmx`                                                                                                                                     |
| `AGROPROMBANK_QR_NAMESPACE`                | default `http://services.agroprombank.com/` (SOAPAction = namespace + function)                                                                                                                        |
| `AGROPROMBANK_QR_LOGIN`                    | login for remote operations, issued by the bank                                                                                                                                                        |
| `AGROPROMBANK_QR_PASSWORD` / `_FILE`       | its password                                                                                                                                                                                           |
| `AGROPROMBANK_QR_EXTERNAL_TOKEN` / `_FILE` | optional token the bank may issue instead of login/password; when set, `Login` and `Password` go out empty                                                                                             |
| `AGROPROMBANK_QR_TERMINAL_ID`              | the QR terminal, `QRT\d{15}`                                                                                                                                                                           |
| `AGROPROMBANK_QR_CODE_FORMAT`              | what the QR code says. Default `{terminal}:{rub}:{extid}`; placeholders `{terminal}`, `{rub}` (sum as `12.50`), `{kop}` (sum in kopecks), `{extid}`. See question 1.                                   |
| `AGROPROMBANK_QR_APP_LINK`                 | optional link that opens the bank app on the same phone with the code; placeholders `{code}` (URL-encoded QR text), `{extid}`, `{terminal}`. Unset: the clients show the QR code only. See question 2. |
| `AGROPROMBANK_QR_LIFETIME_MINUTES`         | how long an invoice is offered, default 10; then it is closed (`ClosePaymentExtId`). Keep it at or below `ORDER_PAYMENT_TTL_MINUTES`.                                                                  |
| `AGROPROMBANK_QR_TIMEOUT_MS`               | per call, default 15000                                                                                                                                                                                |

The external id of an invoice (`extid`) is our `Payment.invoiceId`, taken from
the same `agroprombank_invoice_seq` with the same digits-only
`AGROPROMBANK_INVOICE_PREFIX` as the other flows: unique for the terminal
forever, never reused. The SOAP header always carries `DeviceId` and `PushId`
`-1`, as the documentation asks of a non-mobile client.

`GET /config/features` gains `qrPaymentCurrencies: string[]` — `["RUP"]` while
the QR payment is on and configured, `[]` otherwise; always present. A client
offers «Оплатить по QR» only for a store whose currency is in that list.
`PaymentHoldsService.cardPaymentRequired` treats an order as needing payment
when the card flow is on, or when the QR payment is on and the order is in a
currency it takes — a QR-only deployment does not lock a USD order out.

Switching `AGROPROMBANK_QR_ENABLED` off stops new invoices only. As long as
the terminal and the credentials are configured, money already taken by QR
is still looked after: reversals, the cron, the callback and the status poll
keep calling the bank.

### 12.3 API

```
POST /api/payments/agroprombank-qr/start        { orderId }
  → AgroprombankQrPaymentDto
GET  /api/payments/agroprombank-qr/:paymentId   (customer polls every 3 s)
  → AgroprombankQrPaymentDto
POST /api/payments/agroprombank-qr/:paymentId/cancel   (customer closed the QR screen)
  → AgroprombankQrPaymentDto
POST /api/payments/agroprombank-qr/callback     (the bank; public; form fields `payments`, `trx`)
  → 200 "OK"
```

```ts
interface AgroprombankQrPaymentDto {
  paymentId: string;
  orderId: string;
  /** PENDING — waiting for the customer to pay; PAID — the money is on the
   *  order (held until the kitchen accepts; also after the accept); EXPIRED —
   *  the invoice lapsed or was closed unpaid; REFUNDED — paid, then given back;
   *  FAILED — the bank refused to issue the invoice. */
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'REFUNDED' | 'FAILED';
  amountCents: number;
  currency: 'RUP';
  /** While PENDING: what to show. Null otherwise. */
  qr: {
    /** Text to render as the QR code. */
    code: string;
    /** Opens the bank app with this invoice on the same phone; null when not configured. */
    appLink: string | null;
    /** ISO instant the invoice stops being offered. */
    expiresAt: string;
  } | null;
}
```

The DTO lives in `@takeaway/shared-types` (`AgroprombankQrPaymentDto`,
`AgroprombankQrPaymentStatus`). Customer-only routes (the order's owner; any
other payment id is 404). `start` and `cancel` answer `200`, not `201`.
Errors carry `{ statusCode, error, code, message }`
(`AgroprombankQrErrorBody`, `AgroprombankQrErrorCode` in shared-types):
`QR_PAYMENT_DISABLED` (409), `QR_CURRENCY_UNSUPPORTED` (409, store not in
RUP), `ORDER_NOT_PAYABLE` (409: cancelled, expired or nothing to pay),
`QR_BANK_UNAVAILABLE` (503: the bank could not be reached — retry; `start`
and `cancel` only, the status `GET` answers from the database instead).

1. **Start** is idempotent per order. An order already paid (a card hold or
   capture, a paid QR invoice, or money taken by any provider) answers that
   payment — `PAID`, `qr: null`, its own `paymentId`, even when it is not a
   QR payment. A `PENDING` QR invoice still inside its lifetime is checked
   with `GetPaymentStateExtId` and answered again (same code) — a reload
   never issues a second invoice. A lapsed one — or one issued for a total
   the order no longer has — is closed first (`ClosePaymentExtId`) and
   checked once more, so a payment that landed in the last second is not
   lost; only then a new `extid` is allocated and
   `CreatePaymentID(terminal, amountKopecks, "000", extid)` called. The
   returned bank id is stored as `Payment.providerRef` (and
   `rawJson.qrPaymentId`); the QR text is fixed at issue
   (`rawJson.qrCode`). A SOAP fault from `CreatePaymentID` answers the DTO
   with `FAILED`; no answer at all leaves the invoice `PENDING` (it may exist
   at the bank) and answers 503 — the next start finds it at the bank and
   answers it, or closes it once its call is long over and the bank knows
   nothing of it. While the bank cannot say whether an earlier invoice was
   paid, no new one is issued (503).
2. **Status** (`GET`) answers from the database, and while `PENDING` asks the
   bank (`GetPaymentStateExtId`) at most once every 3 s per payment. An
   invoice past its lifetime is closed right there (`EXPIRED`), so the
   screen stops showing a code the bank should no longer take.
3. **Paid** — from the callback, the status poll, or the cron — is claimed
   with a conditional update (`PENDING` → `REQUIRES_ACTION`), so it settles
   the order once: the order goes onto the kitchen board and the staff are
   told, as with a card hold. `rawJson` keeps `qrPaymentId` and `rrn` (the
   card transaction's RRN) — `ReversePayment` needs both.
4. **Cancel** closes an unpaid invoice (`ClosePaymentExtId`), re-checks it,
   and marks it `EXPIRED` (stored as `FAILED` with `rawJson.closed = true`).
   The order stays, so the customer can start again or pay by card. Found
   paid on the re-check, it answers `PAID`. A bank that could not be told to
   close it answers 503 and the invoice stays `PENDING`.
5. **Accept** on the KDS: `CardPaymentsService.captureHoldForOrder` settles
   the QR row as `SUCCEEDED` with no bank call (the money was taken at payment).
6. **Release** (customer cancel before the accept, kitchen rejection, expiry):
   `PaymentHoldsService.release` sends `ReversePayment(qrterminal, paymetid,
rrn)` — the parameter names are the bank's, typos included — and marks the
   row `REFUNDED` (event `REFUND_ISSUED`, `kind: "reversal"`). `paymetid` and
   `rrn` come from `rawJson`, or from `GetPaymentStateExtId` when missing. The
   order's `cancelMoney` reads `REFUNDED` (not `RELEASED`): the money was
   taken. A failure is retried by the reconciliation cron like any hold
   release (`PENDING` until then); the last try logs `REFUND NEEDED`.
   Since `ReversePayment` answers nothing, the invoice is read back after it
   and its `state` logged (question 6).
7. **Back office** (`/admin/payments/agroprombank/:paymentId…`): `GET` —
   the bank's record (`GetPaymentStateExtId`); `reverse` — `ReversePayment`
   for a payment waiting for the kitchen or settled; `refund` — full only,
   anything else is 400 `QR_PARTIAL_REFUND_UNSUPPORTED`; `complete` — settles
   a waiting payment as the accept would, for exactly the paid amount (else
   400 `QR_PARTIAL_CAPTURE_UNSUPPORTED`). `POST /admin/orders/:id/refund`
   goes through the same full-only refund.

The callback route parses `payments` (XML, one or more `<Payment>`), looks up
each `externalid` among our `PENDING` QR payments — and `FAILED` ones, since a
closed invoice may still have been paid in the app: if its order still waits
for payment the money is used, otherwise it goes back — and runs the same
check as the status poll. Unknown ids, another terminal, bad XML, or a bank
that is down still get `200 OK` (and a log line); nothing in the callback
body is trusted, `trx` included.

**The order as the customer sees it.** `OrderDto.payment` gains an optional
`provider` (`PaymentProvider`, `null` with `NONE`). For `AGROPROMBANK_QR`,
`HELD` means the money is taken and waits on the order (given back in full if
the store turns it down), `PAID` settled, `REFUNDED` reversed; a QR invoice
closed unpaid — by the customer or once it lapsed — reads `NONE`, so the
order offers payment again. `cardMask` stays `null` for QR.

**What a client can rely on:**

- `qr` is never `null` while `status` is `PENDING`, and always `null` otherwise.
- An invoice past `qr.expiresAt` can still come back `PENDING` — until a poll
  gets through to the bank (the next one at most 3 s later closes it and
  answers `EXPIRED`) or, with the bank unreachable, until the cron closes it.
  It can also still turn `PAID`: a payment from the last second is never
  dropped. Show «Счёт истёк» locally and keep polling for a few minutes.
- `start` on an order that cannot be paid — not `CREATED` (cancelled,
  expired, or taken on by the kitchen) or with nothing to pay — answers 409
  `ORDER_NOT_PAYABLE`, unless it already carries a payment: then that payment
  is answered (`200`, `PAID`).

### 12.4 State and money safety

- Paid means `state = 2` in `GetPaymentStateExtId`. Any other state is
  "not paid yet" until the lifetime runs out (question 3).
- The paid sum must equal the invoice. The documentation does not say whether
  `amount` comes back in rubles or kopecks, so both readings are accepted —
  `amount` and `transactionamount` each on its own, `12.50`, `12,5` or
  `1250` — and the one that matched is logged and kept in
  `rawJson.amountReadings` (question 4); anything else, or a currency other
  than `000`, is a mismatch — the money is reversed straight away and the
  order stays unpaid. A record with no sum at all is accepted: the invoice
  fixed it.
- Money that arrives for an order that cannot use it — cancelled, expired,
  already paid by another invoice — is reversed straight away; a refusal is
  retried by the cron and logged loudly (`REFUND NEEDED`) after the last try.
  A cancelled or expired order then reads `cancelMoney = REFUNDED` (or
  `PENDING` until the retry lands).
- The reconciliation cron (`agroprombank-reconcile`, the existing 5-minute
  job) checks every `PENDING` QR invoice older than one minute, closes the
  ones past their lifetime + 2 minutes — and at once those whose order was
  cancelled or expired — and retries failed reversals (QR is in
  `CARD_PROVIDERS`, so `retryPendingReleases` covers it).
- A refusal (SOAP fault) of `GetPaymentStateExtId` reads as "not paid", like
  an empty answer; only a bank that cannot be reached leaves things as they
  are. The unpaid-order expiry spares an order whose latest payment attempt
  is younger than `ORDER_PAYMENT_TTL_MINUTES`, QR included.
- A transport failure never marks anything `FAILED`.

### 12.5 Registration at the bank

| Item         | Value                                                                                 |
| ------------ | ------------------------------------------------------------------------------------- |
| QR terminal  | one, for takeAway (all brands), currency RUP                                          |
| Callback URL | `https://takeaway.md/api/payments/agroprombank-qr/callback`                           |
| Method       | POST, `application/x-www-form-urlencoded`                                             |
| Staging      | a test terminal with `https://test.takeaway.md/api/payments/agroprombank-qr/callback` |

### 12.6 Questions for the bank

1. The QR text for an invoice made with `CreatePaymentID`: is it
   `QRT…:<сумма>:<extid>`? Is the sum in rubles (`12.50`) or kopecks
   (`1250`)? May it be left empty, since the invoice already carries it?
2. **How does a customer pay from the phone the QR is shown on?** takeAway is
   ordered from a phone (Telegram mini app, iOS/Android app, mobile site). Is
   there a link (`https://…` or an app scheme) that opens the Агропромбанк
   app with the QR text, on iOS and Android? Without it the QR can only be
   scanned from a second device.
3. The list of `state` values in `GetPaymentState*` (2 = «Оплачен»; created,
   closed, expired, reversed?).
4. Units of `amount` and `transactionamount` in the state XML and the callback.
5. How long does an unpaid invoice stay payable, and does `ClosePaymentExtId`
   stop the bank app from paying it?
6. `ReversePayment`: does it work on a later day (the order may be rejected
   tomorrow for a pre-order)? It returns nothing — how do we learn that it
   went through (`state` after the reversal)? Is there a partial refund?
7. The callback: is it signed, from which IP addresses does it come, does the
   bank retry on a non-200 answer, and what body does it expect?
8. The exact XML of `GetPaymentStateExtIdResult` (as in the callback?) and
   its answer for an `extid` that was never paid or does not exist.
9. Login/password or `ExternalToken` — which will we get? Are `DeviceId` and
   `PushId` `-1` right for a server?
10. Where does the money of the QR terminal settle (takeAway's account, as
    with the card terminal), and is the bank's fee the same?

### 12.7 Sandbox

`pnpm agro:mock` also serves the QR web service at `/mobile/QRMobileService.asmx`
on the Web-платёж port (`:8898`, so the staging proxy serves both) — every
function of the documentation, SOAP 1.1, header checked against
`AGRO_QR_MOCK_LOGIN` / `AGRO_QR_MOCK_PASSWORD` (default `sandbox` /
`sandbox-pass`, `DeviceId`/`PushId` must be `-1`) — a fake «bank app» page at
`/__sandbox/qr/app?code=…` with «Оплатить» / «Отказаться», and test
affordances: `POST /__sandbox/qr/pay/:extid` (pays and fires the callback to
`AGRO_QR_MOCK_API_BASE/payments/agroprombank-qr/callback`, default
`AGRO_WEB_MOCK_API_BASE`), `POST /__sandbox/qr/pay/:extid?silent=1` (pays
without the callback — a lost notification), `GET /__sandbox/qr/state`. An
amount of exactly `66600` cannot be invoiced (CreatePaymentID answers a SOAP
fault). Its states are 1 waiting, 2 paid, 3 closed, 4 reversed (only 2 is the
bank's documented value); an unknown `extid` answers an empty `<Payments />`;
`AGRO_QR_MOCK_AMOUNT_UNIT=rubles` reports sums in rubles instead of kopecks.
`pnpm agro:dev-keys` prints the API environment for it. Locally,
`AGROPROMBANK_QR_APP_LINK=http://localhost:8898/__sandbox/qr/app?code={code}`
makes the «open the bank app» button work.

The same sandbox backs `agroprombank-qr.e2e.spec.ts` (client and service end
to end: issue, callback, accept with no bank call, reversal on rejection, a
lost callback found by the poll and by the cron, a lapsed invoice, late money,
a wrong sum, a bank reporting rubles, a refused reversal retried) and the
sandbox compose stack, where `tools/agroprombank-mock/smoke.mjs` walks the QR
path too.

### 12.8 Going live

- [ ] Answers to 12.6, then `AGROPROMBANK_QR_CODE_FORMAT` and
      `AGROPROMBANK_QR_APP_LINK` set from them.
- [ ] Terminal and callback registered (12.5); login/password (or token) in
      `/opt/takeaway/secrets/agroprombank-qr-password`.
- [ ] Migration `20261110100000_agroprombank_qr_provider` applied.
- [ ] Staging first: one order paid by QR, accepted, one rejected (money back),
      one left to expire; log lines checked for the amount unit and states.
- [ ] Production with `AGROPROMBANK_QR_ENABLED=true`: one low-value live order
      paid, accepted; a second one rejected to see `ReversePayment` work.
