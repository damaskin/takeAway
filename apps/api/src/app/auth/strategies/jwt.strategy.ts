import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Role, type User } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../../users/users.service';
import { jwtAccessSecret } from '../jwt-secrets';
import { KDS_PIN_LEGACY_SENTINEL_PREFIX } from '../services/kds-pin.service';

interface JwtPayload {
  sub: string;
  jti: string;
  /** A kitchen PIN session: the brand of the tablet. See TokensService.SessionScope. */
  kdsb?: string;
  /** A kitchen PIN session: the store picked at sign-in; alone on sessions from before 2026-10-20. */
  kds?: string;
}

export interface AuthenticatedUser {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  role: Role;
  /**
   * Set when the session was opened with a kitchen PIN: the brand of the
   * tablet. Such a session reaches only the endpoints marked
   * `@KdsSessionAllowed()`, and on those only {@link kdsStoreIds}
   * (KdsSessionGuard). Absent on an email + password session.
   */
  kdsBrandId?: string;
  /**
   * A kitchen PIN session's stores: the ones the person works at in
   * {@link kdsBrandId}, read on this very request — taking someone off a
   * store takes the store out of their tablet session at once. Present
   * exactly when `kdsBrandId` is.
   */
  kdsStoreIds?: readonly string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtAccessSecret(config),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.users.findById(payload.sub);
    if (!user || user.blockedAt) {
      throw new UnauthorizedException('User not found or blocked');
    }
    const authenticated: AuthenticatedUser = {
      id: user.id,
      phone: user.phone,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    const brandId = await this.kitchenBrand(payload);
    if (brandId) {
      authenticated.kdsBrandId = brandId;
      authenticated.kdsStoreIds = await this.kitchenStores(user, brandId);
    }
    return authenticated;
  }

  /** The brand a PIN session is bound to; null for a password session. */
  private async kitchenBrand(payload: JwtPayload): Promise<string | null> {
    if (typeof payload.kdsb === 'string' && payload.kdsb) return payload.kdsb;
    if (typeof payload.kds !== 'string' || !payload.kds) return null;
    // Opened before 2026-10-20: the token names the store, the brand is its.
    const store = await this.prisma.store.findUnique({ where: { id: payload.kds }, select: { brandId: true } });
    if (!store) throw new UnauthorizedException('Kitchen session ended');
    return store.brandId;
  }

  /**
   * The person's stores in the session's brand, checked on every request.
   * A PIN that was reset, or moved to another brand, ends the session here
   * and now instead of when its access token runs out.
   */
  private async kitchenStores(user: User, brandId: string): Promise<string[]> {
    const links = await this.prisma.userStore.findMany({
      where: { userId: user.id, store: { brandId } },
      select: { storeId: true },
    });
    const storeIds = links.map((l) => l.storeId);
    const usable = !!user.kdsPinHash && !user.kdsPinHash.startsWith(KDS_PIN_LEGACY_SENTINEL_PREFIX);
    const pinHere =
      usable &&
      (user.kdsPinBrandId === brandId ||
        (user.kdsPinBrandId === null && !!user.kdsPinStoreId && storeIds.includes(user.kdsPinStoreId)));
    if (!pinHere) throw new UnauthorizedException('Kitchen session ended');
    return storeIds;
  }
}
