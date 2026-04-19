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

/**
 * Shape coming back from the Telegram Login Widget
 * (https://core.telegram.org/widgets/login). The widget calls
 * `window.onTelegramAuth(user)` with these fields and expects the server to
 * verify the `hash` against a SHA-256 derivation of the bot token (different
 * from the Mini App init-data HMAC — don't conflate the two).
 */
export interface TelegramLoginWidgetPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

// Telegram recommends rejecting payloads older than ~24h. Use 1 day so the
// widget can still work if the tab was idle a while but not if someone
// replays an ancient auth_date.
const LOGIN_WIDGET_MAX_AGE_SECONDS = 24 * 60 * 60;

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

  /**
   * Verify a Telegram Login Widget payload. The widget's key derivation is
   * `sha256(bot_token)` (plain SHA, not HMAC with "WebAppData" like the Mini
   * App init-data path). Data-check-string is the non-hash fields sorted
   * alphabetically and joined by \n.
   */
  verifyLoginWidget(payload: TelegramLoginWidgetPayload): TelegramUser {
    const { hash, ...rest } = payload;
    if (!hash || typeof payload.id !== 'number') {
      throw new UnauthorizedException('Invalid Telegram widget payload');
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec - payload.auth_date > LOGIN_WIDGET_MAX_AGE_SECONDS) {
      throw new UnauthorizedException('Telegram login is stale; please sign in again');
    }

    const botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    const allowUnverified = this.config.get<string>('NODE_ENV') !== 'production' && !botToken;

    if (!allowUnverified) {
      if (!botToken) {
        throw new UnauthorizedException('Telegram bot token is not configured');
      }
      const secret = createHash('sha256').update(botToken).digest();
      const fields = Object.entries(rest)
        .filter(([, v]) => v !== undefined && v !== null)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
      const expected = createHmac('sha256', secret).update(fields).digest('hex');
      if (!timingSafeEqualHex(hash, expected)) {
        throw new UnauthorizedException('Telegram widget signature mismatch');
      }
    } else {
      this.logger.warn('TELEGRAM_BOT_TOKEN is not set — accepting widget payload without HMAC verification (dev only)');
    }

    return {
      id: payload.id,
      first_name: payload.first_name,
      last_name: payload.last_name,
      username: payload.username,
    };
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
