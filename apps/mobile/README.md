# takeAway Mobile (M6)

Flutter 3 client для iOS и Android. Покрывает customer-flow: auth → каталог → корзина → чекаут → оплата (Apple/Google Pay) → live-статус заказа → push.

## Status

**Не начато.** Скелет содержит план PR'ов и `pubspec.yaml` с целевым набором зависимостей. До первого `flutter create` ничего не собирается.

## Local setup (one-time)

```bash
# 1. Install Flutter 3.22+ (mise / fvm / asdf — на ваш вкус)
flutter --version

# 2. Initialise the Flutter project on top of this scaffold
cd apps/mobile
flutter create . \
  --org com.takeaway \
  --project-name takeaway_mobile \
  --platforms ios,android \
  --no-overwrite

# 3. Install deps from pubspec.yaml
flutter pub get

# 4. iOS — install pods
cd ios && pod install && cd ..

# 5. Sanity boot
flutter run
```

`flutter create` будет уважать существующие файлы — создаст недостающее (ios/, android/, web/, test/) и оставит наш `lib/` и `pubspec.yaml`.

## Phase-1 PR breakdown (M6 PR1 → M6 PR8)

### M6 PR1 — bootstrap

- `flutter create` over the scaffold, ios/ + android/ committed.
- `pubspec.yaml` locked, `flutter analyze` clean, `flutter test` green on a smoke test.
- CI (GitHub Actions): one job `flutter analyze && flutter test`.

### M6 PR2 — Dart API client

- Generate `libs/api-client-dart` from the existing OpenAPI document
  (`@nestjs/swagger` already publishes it). Use `openapi-generator-cli` with
  `dart-dio` template; commit the generated client and add a regen script.
- Wire `Dio` interceptors for JWT bearer + refresh + 401 retry.

### M6 PR3 — Auth

- Telegram login flow (deep-link to `t.me/<bot>?start=auth_<nonce>`; bot
  redirects back via universal link with `tgAuthResult` → POST
  `/auth/telegram/widget`).
- Email + password fallback (manager / staff use the same screen).
- Secure-storage of refresh token (flutter_secure_storage).

### M6 PR4 — Catalog + Cart

- Stores list with map (mapbox_gl), store detail.
- Menu by category, product detail with variations + modifiers.
- Cart screen, live ETA recompute on add/remove (calls `POST /cart/items`).

### M6 PR5 — Checkout + Stripe

- ASAP / scheduled pickup time picker.
- `flutter_stripe` PaymentSheet against `POST /payments/intent`.
- Apple Pay / Google Pay via Stripe.

### M6 PR6 — Order status

- Live status screen with Socket.io client (or SSE fallback).
- Order code + QR display (qr_flutter).
- "I'm here" geofencing button → `POST /orders/:id/location`.

### M6 PR7 — Push

- `firebase_messaging` for FCM (Android) / APNS (iOS via Firebase).
- Register `Device` row through `POST /devices` on every cold start.
- Notify on order events; deep-link from notification → order status.

### M6 PR8 — Polish + store submission

- Profile, orders history, loyalty.
- App icon + splash (flutter_launcher_icons).
- App Store / Google Play submission checklist (TestFlight first).

## Architecture

`lib/` follows the same feature-folder layout as the Angular apps:

```
apps/mobile/lib/
├── main.dart
├── app.dart                  ← MaterialApp + routing
├── core/                     ← cross-cutting: api client, auth, theme, i18n, push
└── features/
    ├── auth/
    ├── catalog/
    ├── cart/
    ├── checkout/
    ├── order_status/
    ├── orders_history/
    └── profile/
```

State: `flutter_riverpod` providers per feature. No global redux-like store.

## Out of scope for M6

- Brand admin mobile views (admin app remains web-only — desktop ergonomics).
- KDS app on mobile — KDS stays an Angular tablet app.
- Rider app — eventual M7+ if delivery volumes justify it.
