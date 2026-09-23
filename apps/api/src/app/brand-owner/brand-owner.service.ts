import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BrandModerationStatus, type Prisma, Role } from '@prisma/client';

import type { UpdateBrandDto } from '../admin/catalog/dto/admin-brand.dto';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { codedConflict } from '../common/http/coded-conflict';
import type { UploadedImageFile } from '../common/upload/uploaded-image.decorator';
import { FeatureFlagsService } from '../config/feature-flags.service';
import { OnboardingNotifier } from '../onboarding/onboarding-notifier.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { BrandOnboardingDto } from './dto/brand-onboarding.dto';

/** Why a brand-settings change was refused, as the `code` of the 409. */
export const BrandOwnerConflict = {
  CURRENCY_LOCKED: 'CURRENCY_LOCKED',
  NOT_REJECTED: 'NOT_REJECTED',
} as const;

const BRAND_REF = { id: true, slug: true, currency: true } satisfies Prisma.BrandSelect;

type BrandRef = Prisma.BrandGetPayload<{ select: typeof BRAND_REF }>;

/**
 * The brand an owner runs from the admin panel: settings, logo, the launch
 * checklist, and sending a rejected brand back for review.
 *
 * Which brand: an owner may have several, so the admin sends the one picked
 * in the header as `?brandId=`, and it has to be one of theirs. Without it
 * they get the oldest — the one they signed up with — so the answer never
 * depends on row order. SUPER_ADMIN owns no brand and names the one they are
 * acting on; without a name they get the first alphabetically, which on a
 * one-brand install is the only one.
 */
@Injectable()
export class BrandOwnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly flags: FeatureFlagsService,
    private readonly notifier: OnboardingNotifier,
  ) {}

  /** `currencyLocked` lets /settings disable the currency before the owner tries. */
  async get(user: AuthenticatedUser, brandId?: string) {
    const { id } = await this.resolveBrand(user, brandId);
    const [brand, currencyLocked] = await Promise.all([
      this.prisma.brand.findUniqueOrThrow({
        where: { id },
        include: { _count: { select: { stores: true, products: true } } },
      }),
      this.hasOrders(id),
    ]);
    return { ...brand, currencyLocked };
  }

  async update(user: AuthenticatedUser, dto: UpdateBrandDto, brandId?: string) {
    const brand = await this.resolveBrand(user, brandId);

    // The owner cannot change their moderation status (that's what
    // SUPER_ADMIN is for) — and we lock the slug once assigned so the
    // storefront URL stays stable.
    const data: Prisma.BrandUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.locale !== undefined) data.locale = dto.locale;
    if (dto.logoUrl !== undefined) data.logoUrl = dto.logoUrl;
    if (dto.themeOverrides !== undefined) data.themeOverrides = sanitizeThemeOverrides(dto.themeOverrides);
    if (dto.currency !== undefined && dto.currency !== brand.currency) {
      // Revenue, analytics and payouts add a brand's orders up in its
      // currency. Once there are orders, switching it would put two
      // currencies into one ledger.
      if (await this.hasOrders(brand.id)) {
        throw codedConflict(
          BrandOwnerConflict.CURRENCY_LOCKED,
          'The currency cannot change once the brand has orders',
          'currency',
        );
      }
      data.currency = dto.currency;
    }

    return this.prisma.brand.update({ where: { id: brand.id }, data });
  }

  /** Stores the file and points `Brand.logoUrl` at it. */
  async uploadLogo(user: AuthenticatedUser, file: UploadedImageFile, brandId?: string): Promise<{ logoUrl: string }> {
    const brand = await this.resolveBrand(user, brandId);
    const { url } = await this.storage.uploadImage(`brands/${brand.slug}`, file.filename, file.mimetype, file.buffer);
    await this.prisma.brand.update({ where: { id: brand.id }, data: { logoUrl: url } });
    return { logoUrl: url };
  }

  async onboarding(user: AuthenticatedUser, brandId?: string): Promise<BrandOnboardingDto> {
    const { id } = await this.resolveBrand(user, brandId);
    const [brand, readyStores, categories, productsWithPhoto] = await Promise.all([
      this.prisma.brand.findUniqueOrThrow({
        where: { id },
        select: { logoUrl: true, moderationStatus: true, moderationNote: true },
      }),
      // A store a customer can order from needs somewhere to collect the
      // order and a time it is open.
      this.prisma.store.count({
        where: { brandId: id, addressLine: { not: '' }, workingHours: { some: { isClosed: false } } },
      }),
      this.prisma.category.count({ where: { brandId: id } }),
      this.prisma.product.count({ where: { brandId: id, imageUrls: { isEmpty: false } } }),
    ]);

    const brandProfile = Boolean(brand.logoUrl);
    const store = readyStores > 0;
    const menu = categories > 0 && productsWithPhoto > 0;
    return {
      brandId: id,
      moderationStatus: brand.moderationStatus,
      moderationNote: brand.moderationNote,
      brandProfile,
      store,
      menu,
      cardPayments: this.flags.agroprombankEnabled,
      complete: brandProfile && store && menu && brand.moderationStatus === BrandModerationStatus.APPROVED,
    };
  }

  /**
   * REJECTED → PENDING, with the old verdict cleared and the platform team
   * told. Conditional on the status, so a double click sends one review
   * request, not two.
   */
  async resubmit(user: AuthenticatedUser, brandId?: string) {
    const { id } = await this.resolveBrand(user, brandId);
    const { count } = await this.prisma.brand.updateMany({
      where: { id, moderationStatus: BrandModerationStatus.REJECTED },
      data: {
        moderationStatus: BrandModerationStatus.PENDING,
        moderationNote: null,
        moderatedAt: null,
        submittedAt: new Date(),
      },
    });
    if (count === 0) {
      throw codedConflict(BrandOwnerConflict.NOT_REJECTED, 'Only a rejected brand can be sent for review again');
    }

    void this.notifier.brandResubmitted(id);
    return this.prisma.brand.findUniqueOrThrow({ where: { id } });
  }

  private async resolveBrand(user: AuthenticatedUser, brandId: string | undefined): Promise<BrandRef> {
    if (user.role === Role.SUPER_ADMIN) {
      const brand = brandId
        ? await this.prisma.brand.findUnique({ where: { id: brandId }, select: BRAND_REF })
        : await this.prisma.brand.findFirst({ orderBy: { name: 'asc' }, select: BRAND_REF });
      if (!brand) throw new NotFoundException(brandId ? 'Brand not found' : 'No brands exist yet');
      return brand;
    }

    if (brandId) {
      const owned = await this.prisma.brand.findFirst({ where: { id: brandId, ownerId: user.id }, select: BRAND_REF });
      if (!owned) throw new ForbiddenException('Resource belongs to a brand outside your scope');
      return owned;
    }

    const oldest = await this.prisma.brand.findFirst({
      where: { ownerId: user.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: BRAND_REF,
    });
    if (!oldest) throw new NotFoundException('No brand for the current user');
    return oldest;
  }

  private async hasOrders(brandId: string): Promise<boolean> {
    const order = await this.prisma.order.findFirst({ where: { store: { brandId } }, select: { id: true } });
    return order !== null;
  }
}

/**
 * Only allow keys that look like CSS variables and string values. Drops
 * everything else silently — no stack-trace-leaking error for a malformed
 * key, just omission, which keeps the PATCH call idempotent for sensible
 * inputs and mildly defensive against injected nonsense.
 */
function sanitizeThemeOverrides(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!k.startsWith('--')) continue;
    if (typeof v !== 'string') continue;
    if (v.length > 120) continue; // defensive cap
    out[k] = v;
  }
  if (Object.keys(out).length === 0 && Object.keys(input).length > 0) {
    throw new BadRequestException('themeOverrides must be a map of --css-var keys to string values');
  }
  return out;
}
