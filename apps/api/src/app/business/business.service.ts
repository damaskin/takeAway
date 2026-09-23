import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { BrandModerationStatus, Currency, Locale, Prisma, Role } from '@prisma/client';

import { PasswordService } from '../auth/services/password.service';
import { TokensService } from '../auth/services/tokens.service';
import type { AuthSessionDto } from '../auth/dto/auth-response.dto';
import { codedConflict } from '../common/http/coded-conflict';
import { uniqueSlug } from '../common/text/slug';
import { OnboardingNotifier } from '../onboarding/onboarding-notifier.service';
import { PrismaService } from '../prisma/prisma.service';
import type { BusinessRegisterDto } from './dto/business-register.dto';
import type { BusinessRegisterResponseDto } from './dto/business-register-response.dto';

/** Why a sign-up was refused, as the `code` of the 409 — the admin translates these. */
export const SignupConflict = {
  /** A staff account already uses this email: sign in or reset the password instead. */
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  /** A customer signs in with this email (Google / Apple) and has no password to sign in with here. */
  EMAIL_CUSTOMER_ACCOUNT: 'EMAIL_CUSTOMER_ACCOUNT',
  PHONE_TAKEN: 'PHONE_TAKEN',
} as const;

/**
 * Two sign-ups with the same brand name at the same moment can both find a
 * slug free; the loser of the insert just takes the next one.
 */
const SLUG_ATTEMPTS = 3;

const BRAND_SLUG_MAX_LENGTH = 40;

interface RegisterInput {
  email: string;
  passwordHash: string;
  ownerName: string;
  phone: string | undefined;
  locale: Locale;
  currency: Currency;
  brandName: string;
}

@Injectable()
export class BusinessService {
  private readonly logger = new Logger(BusinessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
    private readonly notifier: OnboardingNotifier,
  ) {}

  async register(dto: BusinessRegisterDto): Promise<BusinessRegisterResponseDto> {
    const email = dto.email.toLowerCase();
    await this.assertAvailable(email, dto.phone);

    const passwordHash = await this.passwords.hash(dto.password);
    const { brand, user } = await this.createBrandAndOwner({
      email,
      passwordHash,
      ownerName: dto.ownerName,
      phone: dto.phone,
      locale: dto.locale,
      currency: dto.currency,
      brandName: dto.brandName,
    });

    const device = await this.prisma.device.create({
      data: { userId: user.id, type: 'WEB', locale: user.locale },
    });
    const tokens = await this.tokens.issue(user.id, device.id);

    // Not awaited: a slow mail relay must not keep the owner from their
    // first look at the admin panel. The notifier never rejects.
    void this.notifier.brandSubmitted(brand.id);

    const session: AuthSessionDto = {
      ...tokens,
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        name: user.name,
        locale: user.locale,
        currency: user.currency,
        role: user.role,
        telegramUserId: user.telegramUserId?.toString() ?? null,
      },
    };

    return {
      brand: {
        id: brand.id,
        slug: brand.slug,
        name: brand.name,
        moderationStatus: brand.moderationStatus,
      },
      session,
    };
  }

  /**
   * Refuses up front, with the reason, what the insert would refuse anyway.
   * Existing accounts are never upgraded into brand owners here: a customer
   * account has no password to sign in to the admin with, and turning it
   * into a staff account behind its owner's back is worse than asking for a
   * different address.
   */
  private async assertAvailable(email: string, phone: string | undefined): Promise<void> {
    const byEmail = await this.prisma.user.findUnique({ where: { email }, select: { role: true } });
    if (byEmail?.role === Role.CUSTOMER) {
      throw codedConflict(
        SignupConflict.EMAIL_CUSTOMER_ACCOUNT,
        'This email belongs to a customer account. Use a different email for the business.',
        'email',
      );
    }
    if (byEmail) throw emailTaken();

    if (phone) {
      const byPhone = await this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
      if (byPhone) throw phoneTaken();
    }
  }

  private async createBrandAndOwner(input: RegisterInput) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.runRegisterTx(input);
      } catch (err) {
        // The checks above and the insert are not atomic: a concurrent
        // sign-up can still claim the email, phone or slug in between.
        // Answer with the field that actually clashed.
        const field = uniqueViolationField(err);
        if (field === 'slug' && attempt < SLUG_ATTEMPTS) continue;
        if (field === 'email') throw emailTaken();
        if (field === 'phone') throw phoneTaken();
        if (field === 'slug') throw new ConflictException('Could not reserve an address for this brand — try again');

        this.logger.error(
          `register failed for email=${input.email}: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
        );
        throw err;
      }
    }
  }

  private runRegisterTx(input: RegisterInput) {
    return this.prisma.$transaction(async (tx) => {
      // Picked right before the insert, inside the transaction, so the
      // window for a clash is one statement wide; createBrandAndOwner
      // retries the rare loser. Cyrillic names transliterate:
      // «Кофейня Ромашка» → kofeynya-romashka.
      const slug = await uniqueSlug(
        input.brandName,
        async (candidate) => (await tx.brand.findUnique({ where: { slug: candidate }, select: { id: true } })) !== null,
        'brand',
        BRAND_SLUG_MAX_LENGTH,
      );
      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
          name: input.ownerName,
          phone: input.phone,
          role: Role.BRAND_ADMIN,
          locale: input.locale,
          currency: input.currency,
        },
      });
      const brand = await tx.brand.create({
        data: {
          slug,
          name: input.brandName,
          ownerId: user.id,
          currency: input.currency,
          locale: input.locale,
          moderationStatus: BrandModerationStatus.PENDING,
        },
      });
      return { brand, user };
    });
  }
}

function emailTaken(): ConflictException {
  return codedConflict(
    SignupConflict.EMAIL_TAKEN,
    'An account with this email already exists. Sign in or reset the password.',
    'email',
  );
}

function phoneTaken(): ConflictException {
  return codedConflict(SignupConflict.PHONE_TAKEN, 'This phone number is already used by another account.', 'phone');
}

/**
 * The column a unique-constraint violation (P2002) tripped on. Prisma puts
 * the fields in `meta.target` — an array of column names, or the constraint
 * name ("User_phone_key") depending on the query path — so both are read.
 */
function uniqueViolationField(err: unknown): 'email' | 'phone' | 'slug' | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return null;
  const target = err.meta?.['target'];
  const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return (['email', 'phone', 'slug'] as const).find((field) => text.includes(field)) ?? null;
}
