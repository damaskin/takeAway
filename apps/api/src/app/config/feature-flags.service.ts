import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
   * Phone + SMS OTP login path. When off, `/auth/otp/send` and
   * `/auth/otp/verify` return 404 and clients hide the phone form —
   * Telegram Login Widget / Mini App init-data become the only auth paths.
   */
  get authOtpEnabled(): boolean {
    return this.parseBool(this.config.get<string>('AUTH_OTP_ENABLED'));
  }

  /** Serialized payload for the `/config/features` endpoint. */
  snapshot(): { deliveryEnabled: boolean; authOtpEnabled: boolean } {
    return {
      deliveryEnabled: this.deliveryEnabled,
      authOtpEnabled: this.authOtpEnabled,
    };
  }

  private parseBool(raw: string | undefined): boolean {
    if (!raw) return false;
    const v = raw.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
  }
}
