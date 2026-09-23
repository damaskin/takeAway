import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrandModerationStatus, type Locale, type Prisma, Role } from '@prisma/client';

import { FeatureFlagsService } from '../config/feature-flags.service';
import { MailService } from '../mail/mail.service';
import { OpsChatService } from '../notifications/ops-chat.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  applicationReceivedMail,
  brandApprovedMail,
  brandRejectedMail,
  type MailContent,
  type OwnerMail,
  type PlatformReview,
  platformReviewChatText,
  platformReviewMail,
} from './onboarding-mail';

const BRAND_FOR_MAIL = {
  id: true,
  name: true,
  currency: true,
  locale: true,
  moderationNote: true,
  owner: { select: { name: true, email: true, phone: true } },
} satisfies Prisma.BrandSelect;

type BrandForMail = Prisma.BrandGetPayload<{ select: typeof BRAND_FOR_MAIL }>;

/**
 * Keeps both sides of moderation informed. The owner hears that the
 * application arrived and how it was decided; the platform team hears that a
 * brand is waiting, which is what makes "a decision within one business day"
 * a promise anyone can keep.
 *
 * Owner mail goes out in the brand's language, platform mail in each admin's
 * own. Every method resolves even when delivery fails — a sign-up or a
 * moderation decision is never undone because SMTP or Telegram was down — so
 * call sites fire and forget.
 */
@Injectable()
export class OnboardingNotifier {
  private readonly logger = new Logger(OnboardingNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly opsChat: OpsChatService,
    private readonly flags: FeatureFlagsService,
    private readonly config: ConfigService,
  ) {}

  /** A business has just signed up. */
  brandSubmitted(brandId: string): Promise<void> {
    return this.safely('application received', brandId, (brand) =>
      this.settle([this.mailOwner(brand, applicationReceivedMail), this.alertPlatform(brand, 'new')]),
    );
  }

  /** A rejected brand has been sent back for review by its owner. */
  brandResubmitted(brandId: string): Promise<void> {
    return this.safely('resubmitted', brandId, (brand) => this.settle([this.alertPlatform(brand, 'resubmitted')]));
  }

  /** A platform admin has decided. Moving a brand back to PENDING tells no one. */
  brandModerated(brandId: string, status: BrandModerationStatus): Promise<void> {
    if (status === BrandModerationStatus.APPROVED) {
      return this.safely('approved', brandId, (brand) => this.settle([this.mailOwner(brand, brandApprovedMail)]));
    }
    if (status === BrandModerationStatus.REJECTED) {
      return this.safely('rejected', brandId, (brand) =>
        this.settle([
          this.mailOwner(brand, (locale, p) =>
            brandRejectedMail(locale, { ...p, reason: brand.moderationNote, support: this.flags.support }),
          ),
        ]),
      );
    }
    return Promise.resolve();
  }

  private async mailOwner(brand: BrandForMail, build: (locale: Locale, p: OwnerMail) => MailContent): Promise<void> {
    // Brands a platform admin created by hand have no owner to tell.
    const to = brand.owner?.email;
    if (!to) return;
    const m = build(brand.locale, {
      ownerName: brand.owner?.name ?? null,
      brandName: brand.name,
      adminUrl: this.adminUrl,
    });
    await this.mail.send(to, m.subject, m.text, m.html);
  }

  /** Every platform admin with an email, plus the ops chat when there is one. */
  private async alertPlatform(brand: BrandForMail, kind: PlatformReview['kind']): Promise<void> {
    const review: PlatformReview = {
      kind,
      brandName: brand.name,
      ownerName: brand.owner?.name ?? null,
      ownerEmail: brand.owner?.email ?? null,
      ownerPhone: brand.owner?.phone ?? null,
      currency: brand.currency,
      adminUrl: this.adminUrl,
    };
    const admins = await this.prisma.user.findMany({
      where: { role: Role.SUPER_ADMIN, email: { not: null }, blockedAt: null },
      select: { email: true, locale: true },
    });
    await this.settle([
      ...admins.flatMap((admin) => {
        if (!admin.email) return [];
        const m = platformReviewMail(admin.locale, review);
        return [this.mail.send(admin.email, m.subject, m.text, m.html)];
      }),
      this.opsChat.send(platformReviewChatText(review)),
    ]);
  }

  /** Runs every delivery to the end, whatever happens to its neighbours, and logs the ones that failed. */
  private async settle(deliveries: Promise<unknown>[]): Promise<void> {
    const results = await Promise.allSettled(deliveries);
    for (const r of results) {
      if (r.status === 'rejected') this.logger.error(`Notification failed: ${messageOf(r.reason)}`);
    }
  }

  private async safely(event: string, brandId: string, work: (brand: BrandForMail) => Promise<void>): Promise<void> {
    try {
      const brand = await this.prisma.brand.findUnique({ where: { id: brandId }, select: BRAND_FOR_MAIL });
      if (!brand) return;
      await work(brand);
    } catch (err) {
      this.logger.error(`Could not send "${event}" notifications for brand ${brandId}: ${messageOf(err)}`);
    }
  }

  private get adminUrl(): string {
    return (this.config.get<string>('ADMIN_APP_URL') ?? 'http://localhost:4202').replace(/\/+$/, '');
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
