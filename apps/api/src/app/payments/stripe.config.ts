/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StripeCtor = require('stripe') as any;

export const STRIPE_CLIENT = Symbol('STRIPE_CLIENT');

@Injectable()
export class StripeConfig {
  constructor(private readonly config: ConfigService) {}

  get secretKey(): string | null {
    return this.config.get<string>('STRIPE_SECRET_KEY') ?? null;
  }

  get webhookSecret(): string | null {
    return this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? null;
  }

  get isConfigured(): boolean {
    return Boolean(this.secretKey);
  }
}

export const stripeClientProvider = {
  provide: STRIPE_CLIENT,
  inject: [StripeConfig],
  useFactory: (cfg: StripeConfig): unknown => {
    if (!cfg.isConfigured) return null;
    return new StripeCtor(cfg.secretKey, { apiVersion: '2024-12-18.acacia' });
  },
};
