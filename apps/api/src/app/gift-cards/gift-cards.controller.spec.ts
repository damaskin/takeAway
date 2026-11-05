import { BadRequestException } from '@nestjs/common';
import { type GiftCard, Role } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import type { BrandScopeService } from '../auth/services/brand-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { PrismaService } from '../prisma/prisma.service';
import { IssueGiftCardDto } from './dto/issue-gift-card.dto';
import { GiftCardsController } from './gift-cards.controller';
import type { GiftCardsService } from './gift-cards.service';

const OWNER: AuthenticatedUser = { id: 'u1', role: Role.BRAND_ADMIN, email: null, phone: null, name: null };
const PLATFORM: AuthenticatedUser = { id: 'u0', role: Role.SUPER_ADMIN, email: null, phone: null, name: null };

async function errors(plain: Record<string, unknown>): Promise<Record<string, string[]>> {
  const found = await validate(plainToInstance(IssueGiftCardDto, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return Object.fromEntries(found.map((e) => [e.property, Object.values(e.constraints ?? {})]));
}

describe('IssueGiftCardDto', () => {
  it('issues a card in RUP', async () => {
    expect(await errors({ amountCents: 50_000, currency: 'RUP' })).toEqual({});
  });

  it('refuses any other currency, saying RUP is the only one', async () => {
    for (const currency of ['USD', 'MDL', 'EUR']) {
      expect(await errors({ amountCents: 50_000, currency })).toEqual({
        currency: ['gift cards are issued in RUP only'],
      });
    }
  });

  it('needs the currency named', async () => {
    expect(Object.keys(await errors({ amountCents: 50_000 }))).toEqual(['currency']);
  });
});

describe('GiftCardsController — the brand an admin acts on', () => {
  const card: GiftCard = {
    id: 'gc1',
    code: 'ABCD-EFGH',
    brandId: 'b2',
    initialAmountCents: 50_000,
    balanceCents: 50_000,
    currency: 'RUP',
    status: 'ACTIVE',
    recipientEmail: null,
    recipientName: null,
    message: null,
    expiresAt: null,
    purchaserUserId: null,
    createdAt: new Date('2026-11-05T10:00:00Z'),
    updatedAt: new Date('2026-11-05T10:00:00Z'),
  };

  function controller(scope: string[] | null) {
    const cards = { list: jest.fn().mockResolvedValue([card]), issue: jest.fn().mockResolvedValue(card) };
    const brandScope = { resolveBrandIds: jest.fn().mockResolvedValue(scope) };
    const ctrl = new GiftCardsController(
      cards as unknown as GiftCardsService,
      {} as PrismaService,
      brandScope as unknown as BrandScopeService,
    );
    return { ctrl, cards };
  }

  const dto = plainToInstance(IssueGiftCardDto, { amountCents: 50_000, currency: 'RUP' });

  it('lists and issues for the brand picked in the top bar, not the first one the owner has', async () => {
    const { ctrl, cards } = controller(['b1', 'b2']);
    await ctrl.list(OWNER, 'b2');
    expect(cards.list).toHaveBeenCalledWith('b2');
    await ctrl.issue(OWNER, dto, 'b2');
    expect(cards.issue).toHaveBeenCalledWith(expect.objectContaining({ brandId: 'b2', currency: 'RUP' }));
  });

  it('lets the platform admin act on the brand they picked', async () => {
    const { ctrl, cards } = controller(null);
    await ctrl.issue(PLATFORM, dto, 'b2');
    expect(cards.issue).toHaveBeenCalledWith(expect.objectContaining({ brandId: 'b2' }));
  });

  it('still asks the platform admin to name a brand', async () => {
    const { ctrl } = controller(null);
    await expect(ctrl.list(PLATFORM)).rejects.toBeInstanceOf(BadRequestException);
  });
});
