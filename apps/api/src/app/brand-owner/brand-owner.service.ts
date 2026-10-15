import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BrandModerationStatus, type BrandPlan, FeedbackKind, type Prisma, Role } from '@prisma/client';

import type { UpdateBrandDto } from '../admin/catalog/dto/admin-brand.dto';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { codedConflict } from '../common/http/coded-conflict';
import type { UploadedImageFile } from '../common/upload/uploaded-image.decorator';
import { FeatureFlagsService } from '../config/feature-flags.service';
import { FeedbackService } from '../feedback/feedback.service';
import { OnboardingNotifier } from '../onboarding/onboarding-notifier.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { onboardingFactsOf, progressOf } from './brand-onboarding';
import type { BrandOnboardingDto } from './dto/brand-onboarding.dto';

/** Why a brand-settings change was refused, as the `code` of the 409. */
export const BrandOwnerConflict = {
  CURRENCY_LOCKED: 'CURRENCY_LOCKED',
  NOT_REJECTED: 'NOT_REJECTED',
  PLAN_ALREADY_ACTIVE: 'PLAN_ALREADY_ACTIVE',
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
    private readonly feedback: FeedbackService,
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
    if (dto.contactPhone !== undefined) data.contactPhone = dto.contactPhone;
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

  /**
   * «Запуск бренда»: the required steps (a store, a menu customers can see,
   * payments, approval) and the recommendations (a logo, product photos).
   * Complete once the steps are done — or once the brand has sold, whatever
   * the checklist says. The rule is `brandLaunch` in `@takeaway/utils`.
   */
  async onboarding(user: AuthenticatedUser, brandId?: string): Promise<BrandOnboardingDto> {
    const { id } = await this.resolveBrand(user, brandId);
    const brand = await this.prisma.brand.findUniqueOrThrow({
      where: { id },
      select: { id: true, logoUrl: true, moderationStatus: true, moderationNote: true },
    });
    const progress = progressOf(await onboardingFactsOf(this.prisma, brand));
    return {
      brandId: id,
      moderationStatus: brand.moderationStatus,
      moderationNote: brand.moderationNote,
      brandProfile: progress.brandProfile,
      store: progress.store,
      menu: progress.menu,
      photos: progress.photos,
      cardPayments: this.flags.cardPaymentFlow !== 'none',
      hasOrders: progress.hasOrders,
      complete: progress.complete,
    };
  }

  /**
   * «Перейти на PRO»: the owner asks for another plan. Changing it stays the
   * platform's call, so this records the wish on the brand — the platform
   * admin sees it on the brands list — and writes to support through the
   * feedback inbox, which pings the platform team. Asking again for the same
   * plan answers with the standing request and wakes nobody.
   */
  async requestPlan(user: AuthenticatedUser, plan: BrandPlan, note: string | undefined, brandId?: string) {
    const { id } = await this.resolveBrand(user, brandId);
    const brand = await this.prisma.brand.findUniqueOrThrow({
      where: { id },
      select: { plan: true, requestedPlan: true, planRequestedAt: true },
    });
    if (brand.plan === plan) {
      throw codedConflict(BrandOwnerConflict.PLAN_ALREADY_ACTIVE, `The brand is already on ${plan}`, 'plan');
    }
    if (brand.requestedPlan === plan && brand.planRequestedAt) {
      return { requestedPlan: plan, planRequestedAt: brand.planRequestedAt.toISOString() };
    }

    const requestedAt = new Date();
    await this.prisma.brand.update({ where: { id }, data: { requestedPlan: plan, planRequestedAt: requestedAt } });
    try {
      await this.feedback.createFromBusiness(user.id, id, {
        kind: FeedbackKind.PLAN_CHANGE,
        message: note?.trim() ?? '',
      });
    } catch (err) {
      // Nobody was told (the hourly cap, most likely): the request is not
      // standing either, so the owner can ask again.
      await this.prisma.brand.update({
        where: { id },
        data: { requestedPlan: brand.requestedPlan, planRequestedAt: brand.planRequestedAt },
      });
      throw err;
    }
    return { requestedPlan: plan, planRequestedAt: requestedAt.toISOString() };
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
