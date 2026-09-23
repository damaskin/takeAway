# Agroprombank («Клевер») card payments

Tokenized card payments for Transnistria, implemented against _«Рекуррентные
платежи в ПС Клевер» v1.3_ (ЗАО «Агропромбанк», 2025).

The customer binds a card once — last four digits, phone, issuer, plus an SMS
one-time password — and every later charge runs against an opaque 64-character
token with no customer interaction. That is what makes one-tap checkout in the
Telegram mini app possible.

Card details never reach our servers, and the token, although it carries no PAN,
authorises charges on its own — so it is stored encrypted at rest.

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
contract has no preauthorization.

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

The same implementation backs three things, which is why they cannot drift:

| Surface                                            | Command                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| Protocol test suite                                | `npx jest --config apps/api/jest.config.cts --testPathPatterns agroprombank` |
| Standalone gateway for local dev                   | `pnpm agro:mock`                                                             |
| Sandbox stack (API + Postgres + Redis + fake bank) | `deploy/docker-compose.sandbox.yml`                                          |

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
