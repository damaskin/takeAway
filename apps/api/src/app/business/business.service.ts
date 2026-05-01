import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { BrandModerationStatus, Currency, Locale, Prisma, Role } from '@prisma/client';

import { PasswordService } from '../auth/services/password.service';
import { TokensService } from '../auth/services/tokens.service';
import type { AuthSessionDto } from '../auth/dto/auth-response.dto';
import { PrismaService } from '../prisma/prisma.service';
import type { BusinessRegisterDto } from './dto/business-register.dto';
import type { BusinessRegisterResponseDto } from './dto/business-register-response.dto';

const MAX_SLUG_COLLISIONS = 50;

@Injectable()
export class BusinessService {
  private readonly logger = new Logger(BusinessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
  ) {}

  async register(dto: BusinessRegisterDto): Promise<BusinessRegisterResponseDto> {
    const email = dto.email.toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Account reuse is deliberately out of scope here — the sign-up form is
      // one-per-brand. Owners reopening a rejected brand go through support.
      throw new ConflictException('An account with this email already exists');
    }

    const slug = await this.allocateBrandSlug(dto.brandName);
    const passwordHash = await this.passwords.hash(dto.password);

    let result: Awaited<ReturnType<typeof this.runRegisterTx>>;
    try {
      result = await this.runRegisterTx({
        email,
        passwordHash,
        ownerName: dto.ownerName,
        phone: dto.phone,
        locale: dto.locale ?? Locale.EN,
        currency: dto.currency ?? Currency.USD,
        slug,
        brandName: dto.brandName,
      });
    } catch (err) {
      // Race window between the email-uniqueness check above and the User
      // create — two simultaneous registrations of the same email both pass
      // findUnique, then one of them trips Prisma's unique constraint. Map
      // it back to the same friendly Conflict the up-front check produces.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.warn(`Race-condition duplicate during register for ${email}: ${err.message}`);
        throw new ConflictException('An account with this email already exists');
      }
      // Anything else gets logged with full stack so the admin terminal
      // shows what actually went wrong instead of a bare 500.
      this.logger.error(
        `register failed for email=${email}: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
    const { brand, user } = result;

    const device = await this.prisma.device.create({
      data: { userId: user.id, type: 'WEB', locale: user.locale },
    });
    const tokens = await this.tokens.issue(user.id, device.id);

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

  private runRegisterTx(input: {
    email: string;
    passwordHash: string;
    ownerName: string;
    phone: string | undefined;
    locale: Locale;
    currency: Currency;
    slug: string;
    brandName: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
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
          slug: input.slug,
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

  /**
   * kebab-case the brand name, fall back to `brand-<cuid-suffix>` if the
   * input has no alphanumerics, and append `-2`, `-3`… on collision. Retries
   * up to {@link MAX_SLUG_COLLISIONS} before bailing — at that point something
   * is wrong (abuse or truly pathological input) and a ConflictException
   * tells the caller to pick a different name.
   */
  private async allocateBrandSlug(name: string): Promise<string> {
    const base = slugify(name) || `brand-${Math.random().toString(36).slice(2, 8)}`;
    let candidate = base;
    for (let i = 2; i < MAX_SLUG_COLLISIONS + 2; i++) {
      const hit = await this.prisma.brand.findUnique({ where: { slug: candidate }, select: { id: true } });
      if (!hit) return candidate;
      candidate = `${base}-${i}`;
    }
    throw new ConflictException('Could not allocate a unique brand slug — try a different brand name');
  }
}

function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
