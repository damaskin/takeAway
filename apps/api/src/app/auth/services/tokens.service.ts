import { randomUUID } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { RedisService } from '../../redis/redis.service';

interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
  refreshTokenExpiresInSeconds: number;
}

interface RefreshSession {
  userId: string;
  deviceId: string | null;
  issuedAt: number;
}

@Injectable()
export class TokensService {
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlSeconds: number;
  private readonly refreshSecret: string;

  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.accessTtlSeconds = parseDurationSeconds(config.get<string>('JWT_ACCESS_TTL') ?? '15m');
    this.refreshTtlSeconds = parseDurationSeconds(config.get<string>('JWT_REFRESH_TTL') ?? '7d');
    this.refreshSecret = config.get<string>('JWT_REFRESH_SECRET') ?? 'change-me-in-prod-refresh';
  }

  async issue(userId: string, deviceId: string | null): Promise<IssuedTokens> {
    const jti = randomUUID();
    const accessToken = await this.jwt.signAsync({ sub: userId, jti }, { expiresIn: this.accessTtlSeconds });

    const refreshTokenId = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, jti: refreshTokenId, typ: 'refresh' },
      { secret: this.refreshSecret, expiresIn: this.refreshTtlSeconds },
    );

    const session: RefreshSession = { userId, deviceId, issuedAt: Date.now() };
    await this.redis.set(this.refreshKey(userId, refreshTokenId), JSON.stringify(session), this.refreshTtlSeconds);

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresInSeconds: this.accessTtlSeconds,
      refreshTokenExpiresInSeconds: this.refreshTtlSeconds,
    };
  }

  async rotate(refreshToken: string): Promise<IssuedTokens> {
    const payload = await this.verifyRefresh(refreshToken);
    const key = this.refreshKey(payload.sub, payload.jti);
    const session = await this.redis.get(key);
    if (!session) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }

    const parsed = JSON.parse(session) as RefreshSession;
    await this.redis.del(key);
    return this.issue(parsed.userId, parsed.deviceId);
  }

  async revokeRefresh(refreshToken: string): Promise<void> {
    try {
      const payload = await this.verifyRefresh(refreshToken);
      await this.redis.del(this.refreshKey(payload.sub, payload.jti));
    } catch {
      // Swallow — logout must be idempotent even on stale or invalid tokens.
    }
  }

  private async verifyRefresh(token: string): Promise<{ sub: string; jti: string }> {
    try {
      return await this.jwt.verifyAsync<{ sub: string; jti: string; typ: string }>(token, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private refreshKey(userId: string, tokenId: string): string {
    return `auth:refresh:${userId}:${tokenId}`;
  }
}

function parseDurationSeconds(input: string): number {
  const match = /^(\d+)([smhd])$/.exec(input.trim());
  if (!match) return Number(input);
  const [, valueStr, unit] = match;
  const value = Number(valueStr);
  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 60 * 60;
    case 'd':
      return value * 60 * 60 * 24;
    default:
      return value;
  }
}
