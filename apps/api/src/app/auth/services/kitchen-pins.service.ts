import { ConflictException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { KdsPinService } from './kds-pin.service';
import { TokensService } from './tokens.service';

/** The PIN columns of a user row. */
export interface KitchenPinRow {
  kdsPinHash: string | null;
  kdsPinBrandId: string | null;
  kdsPinStoreId: string | null;
}

/** What a user row is written with to hold a PIN. */
export interface KitchenPinData {
  kdsPinHash: string;
  kdsPinBrandId: string;
  kdsPinStoreId: null;
}

/** 409 `KDS_PIN_TAKEN`: somebody else at the brand already unlocks the tablet with this PIN. */
export function kdsPinTaken(): ConflictException {
  return new ConflictException({
    statusCode: HttpStatus.CONFLICT,
    error: 'Conflict',
    code: 'KDS_PIN_TAKEN',
    message: 'Another employee of this business already uses this PIN',
  });
}

/** 409 `KDS_PIN_MULTI_BRAND`: a PIN belongs to one brand, and this person works for several. */
export function kdsPinMultiBrand(): ConflictException {
  return new ConflictException({
    statusCode: HttpStatus.CONFLICT,
    error: 'Conflict',
    code: 'KDS_PIN_MULTI_BRAND',
    message: 'This person works for more than one business — they sign in on the tablet with a password',
  });
}

/**
 * Setting and resetting kitchen PINs, for the Staff pages.
 *
 * A person has one PIN for every store they work at in the brand
 * (KdsPinService.brandHash). It is unique within the brand — two people
 * typing the same digits on one tablet could not be told apart — and that
 * includes the store-scoped PINs from before 2026-10-20 that still work at
 * the brand's stores. A new PIN replaces whatever the person had, old kind
 * included.
 *
 * Changing or resetting a PIN ends the person's kitchen sessions: whoever
 * knew the old PIN must not stay on a tablet with it. Their password
 * sessions stay.
 */
@Injectable()
export class KitchenPinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pins: KdsPinService,
    private readonly tokens: TokensService,
  ) {}

  /**
   * The columns for a new PIN at the brand, once it is known to be allowed
   * (6 digits, not a first guess: 400) and free (409 `KDS_PIN_TAKEN`).
   * For an account created together with its PIN; the unique index still
   * has the last word on a race.
   */
  async newPinData(brandId: string, pin: string, exceptUserId?: string): Promise<KitchenPinData> {
    // Without KDS_PIN_SECRET there is nothing to hash with — 503
    // KDS_PIN_NOT_CONFIGURED rather than storing a PIN nobody can check.
    this.pins.assertConfigured();
    this.pins.assertNewPinAllowed(pin);
    await this.assertFree(brandId, pin, exceptUserId);
    return { kdsPinHash: this.pins.brandHash(brandId, pin), kdsPinBrandId: brandId, kdsPinStoreId: null };
  }

  /** Gives an existing account its PIN at the brand, replacing any it had. */
  async assign(userId: string, brandId: string, pin: string): Promise<void> {
    const data = await this.newPinData(brandId, pin, userId);
    try {
      await this.prisma.user.update({ where: { id: userId }, data });
    } catch (err) {
      throw isPinCollision(err) ? kdsPinTaken() : err;
    }
    await this.tokens.revokeKitchenSessions(userId);
  }

  /** Takes the person's PIN away, whichever kind it is. */
  async clear(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { kdsPinHash: null, kdsPinBrandId: null, kdsPinStoreId: null },
    });
    await this.tokens.revokeKitchenSessions(userId);
  }

  /**
   * The one brand a PIN for this person belongs to: the brand of every store
   * they work at. 409 `KDS_PIN_MULTI_BRAND` when they work for several, and
   * null when they work nowhere yet.
   */
  async brandOf(userId: string): Promise<string | null> {
    const links = await this.prisma.userStore.findMany({
      where: { userId },
      select: { store: { select: { brandId: true } } },
    });
    const brands = new Set(links.map((l) => l.store.brandId));
    if (brands.size > 1) throw kdsPinMultiBrand();
    return [...brands][0] ?? null;
  }

  /** Whether the PIN on a row is a real one (not empty, not a placeholder from a build without a secret). */
  isUsable(row: KitchenPinRow): boolean {
    return this.pins.isUsableHash(row.kdsPinHash);
  }

  /**
   * Whether the row's PIN opens this store's tablet: a brand PIN at any
   * store of its brand the person works at, an old PIN at its one store.
   */
  opensStore(row: KitchenPinRow, store: { id: string; brandId: string }, worksHere: boolean): boolean {
    if (!this.isUsable(row)) return false;
    if (row.kdsPinBrandId !== null) return row.kdsPinBrandId === store.brandId && worksHere;
    return row.kdsPinStoreId === store.id;
  }

  private async assertFree(brandId: string, pin: string, exceptUserId?: string): Promise<void> {
    const notThem: Prisma.UserWhereInput = exceptUserId ? { id: { not: exceptUserId } } : {};
    const holder = await this.prisma.user.findFirst({
      where: { ...notThem, kdsPinBrandId: brandId, kdsPinHash: this.pins.brandHash(brandId, pin) },
      select: { id: true },
    });
    if (holder) throw kdsPinTaken();

    // An old store PIN with the same digits at one of the brand's stores
    // would make the tablet unable to tell the two people apart.
    const stores = await this.prisma.store.findMany({ where: { brandId }, select: { id: true } });
    if (stores.length === 0) return;
    const legacy = await this.prisma.user.findFirst({
      where: {
        ...notThem,
        kdsPinBrandId: null,
        OR: stores.map((s) => ({ kdsPinStoreId: s.id, kdsPinHash: this.pins.storeHash(s.id, pin) })),
      },
      select: { id: true },
    });
    if (legacy) throw kdsPinTaken();
  }
}

/** The partial unique index on (brand, hash) — Prisma reports it as P2002, not always by name. */
export function isPinCollision(err: unknown): boolean {
  return (
    (err as { code?: string }).code === 'P2002' ||
    (err instanceof Error &&
      (err.message.includes('User_kdsPinBrand_uniq') || err.message.includes('User_kdsPin_uniq')))
  );
}
