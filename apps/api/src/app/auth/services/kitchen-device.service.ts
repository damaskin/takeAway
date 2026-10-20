import { ForbiddenException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type {
  KitchenDeviceBinding,
  KitchenDeviceStores,
  KitchenDeviceSummary,
  KitchenPairingCode,
} from '@takeaway/shared-types';
import { createHash, randomBytes } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import type { AuthenticatedUser } from '../strategies/jwt.strategy';
import { BrandScopeService } from './brand-scope.service';
import { KDS_PIN_LEGACY_SENTINEL_PREFIX } from './kds-pin.service';
import { UserStoreScopeService } from './user-store-scope.service';

/** How long a tablet link from the Staff page can be opened, once. */
export const KITCHEN_PAIRING_TTL_SECONDS = 24 * 60 * 60;

/** Who may bind the tablet they are signed in on: everyone who works the kitchen board. */
const KITCHEN_ROLES: ReadonlySet<Role> = new Set([Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER, Role.STAFF]);
/** Who manages a brand's tablets on the Staff page. */
const MANAGER_ROLES: ReadonlySet<Role> = new Set([Role.SUPER_ADMIN, Role.BRAND_ADMIN, Role.STORE_MANAGER]);

/** Someone who can actually unlock a store's tablet: kitchen staff or a manager with a working PIN. */
const PIN_HOLDER: Prisma.UserWhereInput = {
  role: { in: [Role.STAFF, Role.STORE_MANAGER] },
  blockedAt: null,
  kdsPinHash: { not: null },
  NOT: { kdsPinHash: { startsWith: KDS_PIN_LEGACY_SENTINEL_PREFIX } },
};

/** A bound tablet, as the PIN sign-in needs it. */
export interface ResolvedKitchenDevice {
  id: string;
  brandId: string;
  brandName: string;
}

interface PairingRecord {
  brandId: string;
  createdById: string;
}

/** SHA-256 of a tablet token — what the table stores; the raw token stays on the tablet. */
export function hashKitchenDeviceToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Kitchen tablets bound to a brand.
 *
 * The PIN screen used to fill its store picker from the public storefront
 * list — every store of every brand — and PIN sign-in took any store id from
 * anyone. A tablet is now bound once, and from then on the PIN screen lists
 * only its brand's stores and PIN sign-in only works from it:
 *
 *  - a signed-in employee of the brand (owner, manager, kitchen staff)
 *    opens the kitchen board on the tablet, which binds it on the spot —
 *    this is also how tablets that were already signed in on the day this
 *    shipped bind themselves, so nobody has to touch them;
 *  - or the owner/manager makes a one-time link on the Staff page and opens
 *    it on the tablet (no password typed on a shared device).
 *
 * The tablet keeps a random 256-bit token in localStorage; only its SHA-256
 * is stored. The owner can unbind a tablet on the Staff page.
 */
@Injectable()
export class KitchenDeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storeScope: UserStoreScopeService,
    private readonly brandScope: BrandScopeService,
  ) {}

  /** Binds the tablet a signed-in employee is on to the brand of a store they work at. */
  async bindForUser(user: AuthenticatedUser, storeId: string): Promise<KitchenDeviceBinding> {
    if (!KITCHEN_ROLES.has(user.role)) throw new ForbiddenException('Insufficient permissions');
    // A PIN session may only re-bind to the brand of its own stores.
    if (user.kdsStoreIds && !user.kdsStoreIds.includes(storeId)) {
      throw new ForbiddenException('Store is outside your scope');
    }
    const scope = await this.storeScope.getScope(user.id, user.role);
    if (scope !== '*' && !scope.includes(storeId)) throw new ForbiddenException('Store is outside your scope');

    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { brandId: true, brand: { select: { name: true } } },
    });
    if (!store) throw new NotFoundException('Store not found');
    return this.issue(store.brandId, store.brand.name, user.id);
  }

  /** A one-time code for the "open this on the kitchen tablet" link on the Staff page. */
  async createPairingCode(user: AuthenticatedUser, brandId: string): Promise<KitchenPairingCode> {
    await this.assertManages(user, brandId);
    const code = randomBytes(24).toString('base64url');
    const record: PairingRecord = { brandId, createdById: user.id };
    await this.redis.set(this.pairingKey(code), JSON.stringify(record), KITCHEN_PAIRING_TTL_SECONDS);
    return { code, expiresAt: new Date(Date.now() + KITCHEN_PAIRING_TTL_SECONDS * 1000).toISOString() };
  }

  /** Exchanges a tablet link's code for a tablet token. The code works once. */
  async redeemPairingCode(code: string): Promise<KitchenDeviceBinding> {
    const invalid = new UnauthorizedException({
      statusCode: HttpStatus.UNAUTHORIZED,
      error: 'Unauthorized',
      code: 'KDS_PAIRING_INVALID',
      message: 'This tablet link is invalid, already used or expired',
    });
    // GETDEL: two tablets opening the same link cannot both get in.
    const raw = await this.redis.raw.getdel(this.pairingKey(code));
    if (!raw) throw invalid;
    let record: PairingRecord;
    try {
      record = JSON.parse(raw) as PairingRecord;
    } catch {
      throw invalid;
    }
    const brand = await this.prisma.brand.findUnique({
      where: { id: record.brandId },
      select: { id: true, name: true },
    });
    if (!brand) throw invalid;
    return this.issue(brand.id, brand.name, record.createdById ?? null);
  }

  /** The tablet behind a token, or null for an unknown or unbound one. */
  async resolve(token: string | null | undefined): Promise<ResolvedKitchenDevice | null> {
    if (!token) return null;
    const row = await this.prisma.kitchenDevice.findUnique({
      where: { tokenHash: hashKitchenDeviceToken(token) },
      select: { id: true, brandId: true, revokedAt: true, brand: { select: { name: true } } },
    });
    if (!row || row.revokedAt) return null;
    return { id: row.id, brandId: row.brandId, brandName: row.brand.name };
  }

  /**
   * What the PIN screen of a bound tablet needs: its brand, and the brand's
   * stores where somebody can actually sign in with a PIN — someone with
   * the brand's PIN working there, or an old store PIN of that store. 401
   * `KDS_DEVICE_UNKNOWN` for a token that is unknown or was unbound — the
   * tablet forgets it and asks to be bound again.
   */
  async storesFor(token: string | null | undefined): Promise<KitchenDeviceStores> {
    const device = await this.resolve(token);
    if (!device) throw unknownDevice();
    const stores = await this.prisma.store.findMany({
      where: {
        brandId: device.brandId,
        OR: [
          { userStores: { some: { user: { ...PIN_HOLDER, kdsPinBrandId: device.brandId } } } },
          { kdsPinUsers: { some: { ...PIN_HOLDER, kdsPinBrandId: null } } },
        ],
      },
      select: { id: true, name: true, city: true },
      orderBy: { name: 'asc' },
    });
    return { brandId: device.brandId, brandName: device.brandName, stores };
  }

  /** Stamps a successful PIN sign-in. Best effort — the sign-in has already succeeded. */
  async touch(deviceId: string): Promise<void> {
    await this.prisma.kitchenDevice
      .update({ where: { id: deviceId }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }

  /** The brand's bound tablets for the Staff page, newest first. */
  async list(user: AuthenticatedUser, brandId: string): Promise<KitchenDeviceSummary[]> {
    await this.assertManages(user, brandId);
    const rows = await this.prisma.kitchenDevice.findMany({
      where: { brandId, revokedAt: null },
      select: { id: true, createdAt: true, createdById: true, lastUsedAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const ids = [...new Set(rows.map((r) => r.createdById).filter((id): id is string => !!id))];
    const people =
      ids.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true, email: true, login: true },
          })
        : [];
    const names = new Map(people.map((p) => [p.id, p.name?.trim() || p.email || p.login || null]));
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      createdByName: r.createdById ? (names.get(r.createdById) ?? null) : null,
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    }));
  }

  /** Unbinds a tablet: its token stops opening the PIN screen. The people signed in on it stay until sign-out. */
  async revoke(user: AuthenticatedUser, brandId: string, deviceId: string): Promise<void> {
    await this.assertManages(user, brandId);
    const result = await this.prisma.kitchenDevice.updateMany({
      where: { id: deviceId, brandId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException('Kitchen tablet not found');
  }

  private async assertManages(user: AuthenticatedUser, brandId: string): Promise<void> {
    if (!MANAGER_ROLES.has(user.role) || user.kdsBrandId) throw new ForbiddenException('Insufficient permissions');
    await this.brandScope.assertBrand(user, brandId);
  }

  private async issue(brandId: string, brandName: string, createdById: string | null): Promise<KitchenDeviceBinding> {
    const deviceToken = randomBytes(32).toString('base64url');
    await this.prisma.kitchenDevice.create({
      data: { brandId, tokenHash: hashKitchenDeviceToken(deviceToken), createdById },
    });
    return { deviceToken, brandId, brandName };
  }

  private pairingKey(code: string): string {
    return `kds-pair:${hashKitchenDeviceToken(code)}`;
  }
}

/** 401 for a tablet token that opens nothing (never bound, or unbound on the Staff page). */
export function unknownDevice(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: HttpStatus.UNAUTHORIZED,
    error: 'Unauthorized',
    code: 'KDS_DEVICE_UNKNOWN',
    message: 'This tablet is not bound to a business',
  });
}
