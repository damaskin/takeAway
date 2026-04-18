import { createHash, createHmac } from 'node:crypto';

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface VerifiedInitData {
  user: TelegramUser;
  authDate: number;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(private readonly config: ConfigService) {}

  verifyInitData(initData: string): VerifiedInitData {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    const userRaw = params.get('user');
    const authDate = Number(params.get('auth_date') ?? 0);

    if (!hash || !userRaw) {
      throw new UnauthorizedException('Invalid Telegram init data');
    }

    const botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    const allowUnverified = this.config.get<string>('NODE_ENV') !== 'production' && !botToken;

    if (!allowUnverified) {
      if (!botToken) {
        throw new UnauthorizedException('Telegram bot token is not configured');
      }
      const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
      const fields = [...params.entries()]
        .filter(([k]) => k !== 'hash')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
      const expected = createHmac('sha256', secret).update(fields).digest('hex');
      if (!timingSafeEqualHex(hash, expected)) {
        throw new UnauthorizedException('Telegram init data signature mismatch');
      }
    } else {
      this.logger.warn('TELEGRAM_BOT_TOKEN is not set — accepting init data without HMAC verification (dev only)');
    }

    let user: TelegramUser;
    try {
      user = JSON.parse(userRaw) as TelegramUser;
    } catch {
      throw new UnauthorizedException('Malformed Telegram user payload');
    }
    if (typeof user.id !== 'number') {
      throw new UnauthorizedException('Missing Telegram user id');
    }

    return { user, authDate };
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const h = createHash('sha256').update(a).digest();
  const g = createHash('sha256').update(b).digest();
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= (h[i] ?? 0) ^ (g[i] ?? 0);
  return diff === 0;
}
