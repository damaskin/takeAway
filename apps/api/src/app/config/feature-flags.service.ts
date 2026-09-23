import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Where a business owner writes when moderation stalls or a rejection is unclear. */
export interface SupportContact {
  email: string | null;
  /** Always a `https://t.me/...` link, whichever form `SUPPORT_TELEGRAM` was written in. */
  telegram: string | null;
}

export interface FeatureFlagsSnapshot {
  deliveryEnabled: boolean;
  agroprombankEnabled: boolean;
  support: SupportContact;
}

/**
 * Runtime feature flags. Single source of truth for the server — every
 * delivery gate (store feed filter, order validation, dispatcher endpoints)
 * and every client (web/TMA/admin) reads the same effective value.
 *
 * Flags default to OFF so an ops team that forgot to set the env var can't
 * accidentally expose an unfinished feature to customers.
 */
@Injectable()
export class FeatureFlagsService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Master switch for the M6 delivery module. When off:
   *  - `GET /stores*` strips `DELIVERY` from `fulfillmentTypes`
   *  - `POST /orders` rejects `fulfillmentType=DELIVERY`
   *  - Admin UI hides Dispatch / Riders nav + guards the routes
   *
   * Flip to `true` when ops is ready to launch delivery.
   */
  get deliveryEnabled(): boolean {
    return this.parseBool(this.config.get<string>('DELIVERY_ENABLED'));
  }

  /**
   * Agroprombank («Клевер») card payments. When off, the clients hide card
   * binding and the pay-by-card button; the API refuses the routes anyway, so
   * this only keeps customers from meeting a dead end.
   */
  get agroprombankEnabled(): boolean {
    return this.parseBool(this.config.get<string>('AGROPROMBANK_ENABLED'));
  }

  /**
   * The platform's support contact (`SUPPORT_EMAIL`, `SUPPORT_TELEGRAM`).
   * Not a flag, but it rides the same public snapshot: the admin shows it
   * next to a moderation verdict before anyone has signed in anywhere else.
   */
  get support(): SupportContact {
    return {
      email: this.config.get<string>('SUPPORT_EMAIL')?.trim() || null,
      telegram: telegramLink(this.config.get<string>('SUPPORT_TELEGRAM')),
    };
  }

  /** Serialized payload for the `/config/features` endpoint. */
  snapshot(): FeatureFlagsSnapshot {
    return {
      deliveryEnabled: this.deliveryEnabled,
      agroprombankEnabled: this.agroprombankEnabled,
      support: this.support,
    };
  }

  private parseBool(raw: string | undefined): boolean {
    if (!raw) return false;
    const v = raw.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
  }
}

/** `@takeaway_help`, `takeaway_help`, `t.me/takeaway_help` or a full URL → a link. */
function telegramLink(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const handle = value.replace(/^(?:www\.)?t\.me\//i, '').replace(/^@/, '');
  return handle ? `https://t.me/${handle}` : null;
}
