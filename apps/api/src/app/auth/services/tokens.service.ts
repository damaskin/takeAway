import { randomUUID } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { jwtRefreshSecret } from '../jwt-secrets';

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
  /** Set for a kitchen PIN session — kept across refreshes, see {@link SessionScope}. */
  kdsBrandId?: string;
  /** The store the PIN session opened on. Alone (no brand) on sessions opened before 2026-10-20. */
  kdsStoreId?: string;
}

/**
 * Narrows what a session may do. A session opened with a kitchen PIN works
 * the kitchen board and stop-list and nothing else: the PIN is short and
 * typed on a shared tablet, so it must not open a manager's menu, staff or
 * refunds. It is bound to the brand of the tablet it was opened on, and
 * reaches the stores the person works at in that brand — read from the
 * database on every request (JwtStrategy), never from the token.
 *
 * The access token carries the brand as the `kdsb` claim and the store
 * picked at sign-in as `kds`; a refresh keeps both, so a PIN session never
 * widens into a full one. `kds` alone is what a build before 2026-10-20
 * understands: rolled back, the API narrows such a session to that one
 * store instead of opening anything more.
 */
export interface SessionScope {
  kdsBrandId: string;
  kdsStoreId?: string;
}

/** Claims of a kitchen PIN session, see {@link SessionScope}. */
interface KitchenClaims {
  kdsb: string;
  kds?: string;
}

@Injectable()
export class TokensService {
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlSeconds: number;
  private readonly refreshSecret: string;

  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.accessTtlSeconds = parseDurationSeconds(config.get<string>('JWT_ACCESS_TTL') ?? '15m');
    this.refreshTtlSeconds = parseDurationSeconds(config.get<string>('JWT_REFRESH_TTL') ?? '7d');
    this.refreshSecret = jwtRefreshSecret(config);
  }

  async issue(userId: string, deviceId: string | null, scope?: SessionScope): Promise<IssuedTokens> {
    const jti = randomUUID();
    const claims: { sub: string; jti: string } & Partial<KitchenClaims> = { sub: userId, jti };
    if (scope) {
      claims.kdsb = scope.kdsBrandId;
      if (scope.kdsStoreId) claims.kds = scope.kdsStoreId;
    }
    const accessToken = await this.jwt.signAsync(claims, { expiresIn: this.accessTtlSeconds });

    const refreshTokenId = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, jti: refreshTokenId, typ: 'refresh' },
      { secret: this.refreshSecret, expiresIn: this.refreshTtlSeconds },
    );

    const session: RefreshSession = { userId, deviceId, issuedAt: Date.now() };
    if (scope) {
      session.kdsBrandId = scope.kdsBrandId;
      if (scope.kdsStoreId) session.kdsStoreId = scope.kdsStoreId;
    }
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
    // Blocking and account deletion both stamp `blockedAt`. A refresh token
    // minted before that — or one that slipped in while it happened — must
    // not keep the session alive.
    const user = await this.prisma.user.findUnique({ where: { id: parsed.userId }, select: { blockedAt: true } });
    if (!user || user.blockedAt) {
      throw new UnauthorizedException('User not found or blocked');
    }
    return this.issue(parsed.userId, parsed.deviceId, await this.scopeOf(parsed));
  }

  /**
   * The scope a refreshed session keeps. A PIN session from before
   * 2026-10-20 knows only its store; it continues bound to that store's
   * brand. One whose store is gone ends here rather than widen into a full
   * session.
   */
  private async scopeOf(session: RefreshSession): Promise<SessionScope | undefined> {
    if (session.kdsBrandId) {
      return session.kdsStoreId
        ? { kdsBrandId: session.kdsBrandId, kdsStoreId: session.kdsStoreId }
        : { kdsBrandId: session.kdsBrandId };
    }
    if (!session.kdsStoreId) return undefined;
    const store = await this.prisma.store.findUnique({ where: { id: session.kdsStoreId }, select: { brandId: true } });
    if (!store) throw new UnauthorizedException('Refresh token revoked or expired');
    return { kdsBrandId: store.brandId, kdsStoreId: session.kdsStoreId };
  }

  /**
   * Ends the user's kitchen PIN sessions and leaves the ones opened with a
   * password: their refresh tokens stop rotating. Called when the person's
   * PIN changes or is reset — whoever knew the old one must not stay on the
   * tablet for another week. Access tokens run out within minutes, and
   * JwtStrategy refuses a PIN session whose PIN is gone at once.
   */
  async revokeKitchenSessions(userId: string): Promise<number> {
    let cursor = '0';
    let removed = 0;
    do {
      const [next, keys] = await this.redis.raw.scan(
        cursor,
        'MATCH',
        this.refreshKey(escapeGlob(userId), '*'),
        'COUNT',
        200,
      );
      cursor = next;
      for (const key of keys) {
        const raw = await this.redis.get(key);
        if (!raw) continue;
        let session: RefreshSession;
        try {
          session = JSON.parse(raw) as RefreshSession;
        } catch {
          continue;
        }
        if (!session.kdsBrandId && !session.kdsStoreId) continue;
        await this.redis.del(key);
        removed++;
      }
    } while (cursor !== '0');
    return removed;
  }

  async revokeRefresh(refreshToken: string): Promise<void> {
    try {
      const payload = await this.verifyRefresh(refreshToken);
      await this.redis.del(this.refreshKey(payload.sub, payload.jti));
    } catch {
      // Swallow — logout must be idempotent even on stale or invalid tokens.
    }
  }

  /**
   * Ends every session of a user: all of their refresh tokens stop rotating.
   * Access tokens are short-lived and are refused by the JWT strategy once
   * the account is blocked, so there is nothing to revoke for them here.
   *
   * `keepRefreshToken` spares one session — the one changing its own
   * password stays signed in while every other device is signed out. It is
   * only honoured when it really is a live token of this same user.
   */
  async revokeAll(userId: string, keepRefreshToken?: string): Promise<number> {
    const keep = keepRefreshToken ? await this.ownSessionKey(userId, keepRefreshToken) : null;
    return this.redis.delMatching(this.refreshKey(escapeGlob(userId), '*'), keep ? new Set([keep]) : undefined);
  }

  private async ownSessionKey(userId: string, refreshToken: string): Promise<string | null> {
    try {
      const payload = await this.verifyRefresh(refreshToken);
      return payload.sub === userId ? this.refreshKey(userId, payload.jti) : null;
    } catch {
      return null;
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

/** User ids are cuids, but a glob must never widen because of one. */
function escapeGlob(value: string): string {
  return value.replace(/[*?[\]\\]/g, '\\$&');
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
