# takeAway

**Pre-order. Skip the queue. Pick it up.**

Global pre-order first platform for coffee and food takeaway. Customers place orders in advance, track live ETA and status, then walk in and pick up ready orders — no queues, no cashiers.

## Status

Early stage. Requirements and design in progress. No code yet.

## Documentation

Read in this order for full context:

1. **[CLAUDE.md](./CLAUDE.md)** — entry point for any development session
2. **[00_PROJECT_BRIEF.md](./00_PROJECT_BRIEF.md)** — product concept, audience, business model, roadmap
3. **[01_TECHNICAL_SPEC.md](./01_TECHNICAL_SPEC.md)** — full technical specification: architecture, stack, features, data model, API, milestones
4. **[02_CLAUDE_PROMPT.md](./02_CLAUDE_PROMPT.md)** — system prompt with working rules, stack, code style, process
5. **[03_PENCIL_PROMPT.md](./03_PENCIL_PROMPT.md)** — design brief for pencil.dev (design system, screens, tokens)
6. **[03a_PENCIL_PATCH.md](./03a_PENCIL_PATCH.md)** — design patch after the pre-order first pivot

Design source file: `takeAway.pen` — opens with [pencil.dev](https://pencil.dev).
Exported screens: `images/`.

## Core mechanic

Every order is a **pre-order** with:

- Pickup time (ASAP or scheduled)
- Live ETA and real-time status (Received → Preparing → Ready → Picked up)
- 4-digit order code + QR for pickup
- Geofencing «customer on the way» notification to the barista
- Smart pickup via shelf / counter / locker

Delivery by courier is **out of core MVP scope** — optional v1.5 feature. Dine-in is secondary. The main flow is always pickup by pre-order.

## Stack

TypeScript monorepo (pnpm + Nx):

- **Backend**: NestJS 11 (Fastify) + Prisma + PostgreSQL 16 + Redis 7 + BullMQ + Socket.io
- **Frontend (web/PWA, Telegram Mini App, admin, KDS)**: Angular 19+ standalone + signals + Tailwind CSS 4
- **Mobile (v2)**: Flutter 3 + Riverpod + Dio
- **Payments**: Stripe
- **Auth**: OTP + OAuth (Google, Apple, Telegram)
- **Third-party**: Twilio, Mailgun, Firebase FCM, Mapbox, Mixpanel, Sentry

## Target markets

Global from day one, starting with English-speaking cities: Dubai, London, Lisbon, Bangkok, Bali.

## Competitor reference

[drinkit.io](https://drinkit.io) (Dodo Brands) — visual and customization reference. We differ in the core mechanic (pre-order first vs in-store flow), expanded menu (coffee + breakfast + lunch + desserts), and omnichannel presence.
