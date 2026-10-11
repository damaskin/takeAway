import { ConflictException } from '@nestjs/common';
import { BrandModerationStatus, Currency, Locale, Prisma, Role } from '@prisma/client';

import type { PasswordService } from '../auth/services/password.service';
import type { TokensService } from '../auth/services/tokens.service';
import type { OnboardingNotifier } from '../onboarding/onboarding-notifier.service';
import type { PrismaService } from '../prisma/prisma.service';
import { BusinessService } from './business.service';
import type { BusinessRegisterDto } from './dto/business-register.dto';

const dto: BusinessRegisterDto = {
  brandName: 'Кофейня Ромашка',
  ownerName: 'Ион Попеску',
  email: 'Owner@Romashka.md',
  password: 'correct-horse',
  phone: '+37369123456',
  currency: Currency.MDL,
  locale: Locale.RU,
};

function uniqueViolation(target: string[] | string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.0.0',
    meta: { target },
  });
}

async function conflictCode(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ConflictException);
    return ((err as ConflictException).getResponse() as { code?: string }).code;
  }
  throw new Error('expected a ConflictException');
}

describe('BusinessService.register', () => {
  let takenSlugs: Set<string>;
  let tx: {
    brand: { findUnique: jest.Mock; create: jest.Mock };
    user: { create: jest.Mock };
  };
  let prisma: {
    user: { findUnique: jest.Mock };
    device: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let notifier: { brandSubmitted: jest.Mock };
  let service: BusinessService;

  beforeEach(() => {
    takenSlugs = new Set();
    tx = {
      brand: {
        findUnique: jest.fn(({ where }: { where: { slug: string } }) =>
          Promise.resolve(takenSlugs.has(where.slug) ? { id: 'other' } : null),
        ),
        create: jest.fn(({ data }) => Promise.resolve({ id: 'brand-1', ...data })),
      },
      user: {
        create: jest.fn(({ data }) => Promise.resolve({ id: 'user-1', telegramUserId: null, ...data })),
      },
    };
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      device: { create: jest.fn().mockResolvedValue({ id: 'device-1' }) },
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    };
    notifier = { brandSubmitted: jest.fn().mockResolvedValue(undefined) };
    service = new BusinessService(
      prisma as unknown as PrismaService,
      { hash: jest.fn().mockResolvedValue('hashed') } as unknown as PasswordService,
      {
        issue: jest.fn().mockResolvedValue({
          accessToken: 'a',
          refreshToken: 'r',
          accessTokenExpiresInSeconds: 900,
          refreshTokenExpiresInSeconds: 604_800,
        }),
      } as unknown as TokensService,
      notifier as unknown as OnboardingNotifier,
    );
  });

  it('creates the brand and its owner in the currency and language the owner picked', async () => {
    const result = await service.register(dto);

    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'owner@romashka.md',
        phone: '+37369123456',
        role: Role.BRAND_ADMIN,
        currency: Currency.MDL,
        locale: Locale.RU,
      }),
    });
    expect(tx.brand.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Кофейня Ромашка',
        slug: 'kofeynya-romashka',
        contactPhone: '+37369123456',
        currency: Currency.MDL,
        locale: Locale.RU,
        moderationStatus: BrandModerationStatus.PENDING,
      }),
    });
    expect(result.brand).toEqual({
      id: 'brand-1',
      slug: 'kofeynya-romashka',
      name: 'Кофейня Ромашка',
      moderationStatus: BrandModerationStatus.PENDING,
    });
    expect(result.session.user).toEqual(expect.objectContaining({ role: Role.BRAND_ADMIN, locale: Locale.RU }));
  });

  it('picks the slug inside the transaction, stepping past taken ones', async () => {
    takenSlugs.add('kofeynya-romashka');

    await service.register(dto);

    expect(tx.brand.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: 'kofeynya-romashka' } }));
    expect(tx.brand.create).toHaveBeenCalledWith({ data: expect.objectContaining({ slug: 'kofeynya-romashka-2' }) });
  });

  it('tells the owner of a staff account to sign in, without creating anything', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: Role.BRAND_ADMIN });

    await expect(conflictCode(service.register(dto))).resolves.toBe('EMAIL_TAKEN');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // A customer who signs in with Google has no password and can never reach
  // the admin; upgrading their account silently would be worse.
  it("asks for another email when it belongs to a customer, and leaves the customer's account alone", async () => {
    prisma.user.findUnique.mockResolvedValue({ role: Role.CUSTOMER });

    await expect(conflictCode(service.register(dto))).resolves.toBe('EMAIL_CUSTOMER_ACCOUNT');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // The owner is often a customer of the app already, with this very number
  // on their customer account. The team still needs the number to call.
  it('signs up with a phone another account has: it is the brand phone, just not on the owner account', async () => {
    prisma.user.findUnique.mockImplementation(({ where }: { where: { phone?: string } }) =>
      Promise.resolve(where.phone ? { id: 'customer' } : null),
    );

    await expect(service.register(dto)).resolves.toEqual(expect.objectContaining({ brand: expect.anything() }));

    expect(tx.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ phone: null }) });
    expect(tx.brand.create).toHaveBeenCalledWith({ data: expect.objectContaining({ contactPhone: '+37369123456' }) });
  });

  it.each([[['phone']], ['User_phone_key']])(
    'keeps the sign-up when the phone is claimed in a race on %j, without the phone on the account',
    async (target) => {
      tx.user.create.mockRejectedValueOnce(uniqueViolation(target));

      await expect(service.register(dto)).resolves.toEqual(expect.objectContaining({ brand: expect.anything() }));

      expect(tx.user.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ phone: null }) });
      expect(tx.brand.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ contactPhone: '+37369123456' }),
      });
    },
  );

  it('maps a race lost on the email to EMAIL_TAKEN', async () => {
    tx.user.create.mockRejectedValue(uniqueViolation(['email']));

    await expect(conflictCode(service.register(dto))).resolves.toBe('EMAIL_TAKEN');
  });

  it('retries a slug lost to a simultaneous sign-up instead of failing the owner', async () => {
    tx.brand.create.mockRejectedValueOnce(uniqueViolation(['slug']));

    await expect(service.register(dto)).resolves.toEqual(expect.objectContaining({ brand: expect.anything() }));
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('lets unexpected failures through untouched', async () => {
    const boom = new Error('database is on fire');
    tx.user.create.mockRejectedValue(boom);

    await expect(service.register(dto)).rejects.toBe(boom);
  });

  it('announces the new brand without waiting for the mail to go out', async () => {
    // A relay that never answers must not hold up the sign-up.
    notifier.brandSubmitted.mockReturnValue(new Promise(() => undefined));

    await expect(service.register(dto)).resolves.toBeDefined();
    expect(notifier.brandSubmitted).toHaveBeenCalledWith('brand-1');
  });
});
