import type { ConfigService } from '@nestjs/config';
import type { OptionLine } from '@takeaway/shared-types';
import { describeOrderItemOptions, readOrderItemSnapshot } from '@takeaway/utils';
import type { Queue } from 'bullmq';

import type { BrandScopeService } from '../auth/services/brand-scope.service';
import type { CheckoutLine } from '../cart/cart.service';
import type { SecretCipher } from '../common/crypto/secret-cipher';
import type { NotificationsService } from '../notifications/notifications.service';
import { PosService } from '../pos/pos.service';
import type { IikoProvider } from '../pos/providers/iiko.provider';
import type { PosterProvider } from '../pos/providers/poster.provider';
import type { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from './orders.service';

const line = (patch: Partial<OptionLine> & Pick<OptionLine, 'optionId' | 'name'>): OptionLine => ({
  groupId: 'og',
  groupName: '',
  kind: 'ADDON',
  type: 'A',
  qty: 1,
  unitPriceCents: 0,
  freeQty: 0,
  totalCents: 0,
  ...patch,
});

/** The spec's cappuccino (§6), as checkout hands it to the order. */
const OPTION_LINES: OptionLine[] = [
  line({ groupId: 'og_coffee_size', groupName: 'Размер (кофе)', kind: 'VARIANT', optionId: 'oi_m', name: 'M' }),
  line({ groupId: 'og_serving', groupName: 'Подача', kind: 'VARIANT', optionId: 'oi_hot', name: 'Горячий' }),
  line({
    groupId: 'og_milk',
    groupName: 'Молоко',
    optionId: 'oi_oat',
    name: 'Овсяное',
    unitPriceCents: 1000,
    totalCents: 1000,
  }),
  line({ groupId: 'og_syrups', groupName: 'Сиропы', optionId: 'oi_vanilla', name: 'Ваниль', totalCents: 800 }),
  line({ groupId: 'og_syrups', groupName: 'Сиропы', optionId: 'oi_salted', name: 'Солёная карамель', totalCents: 800 }),
  line({ groupId: 'og_sugar', groupName: 'Сахар', type: 'C', optionId: 'oi_sugar', name: 'Сахар', qty: 2 }),
];

const CHECKOUT_LINE: CheckoutLine = {
  productId: 'p-cappuccino',
  productSlug: 'cappuccino',
  productName: 'Капучино',
  quantity: 1,
  notes: 'без крышки',
  unitPriceCents: 7100,
  unitPrepSeconds: 180,
  variationIds: [],
  modifiers: {},
  variations: [],
  modifierLines: [],
  options: OPTION_LINES.map((l) => ({ optionId: l.optionId, qty: l.qty })),
  optionLines: OPTION_LINES,
};

describe('order lines of the options catalog', () => {
  const snapshotItem = (l: CheckoutLine) =>
    (OrdersService.prototype as unknown as { snapshotItem: (l: CheckoutLine) => unknown }).snapshotItem.call({}, l);

  it('freezes the picks with their names and prices into the snapshot', () => {
    const snapshot = snapshotItem(CHECKOUT_LINE);

    expect(snapshot).toMatchObject({ id: 'p-cappuccino', name: 'Капучино', optionLines: OPTION_LINES });
    // What the kitchen board, the receipt, the order screens and the admin read back.
    const read = readOrderItemSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(read.optionLines).toEqual(OPTION_LINES);
    expect(describeOrderItemOptions(read)).toBe('M, Горячий · Овсяное · Ваниль + Солёная карамель · Сахар ×2');
  });

  it('reads an order placed before the catalog with no option lines', () => {
    const read = readOrderItemSnapshot({ id: 'p-latte', name: 'Латте', variationIds: [], modifiers: {} });
    expect(read.optionLines).toEqual([]);
    expect(describeOrderItemOptions(read)).toBe('');
  });
});

describe('POS push of a catalog line', () => {
  function service(snapshot: unknown) {
    const prisma = {
      posIntegration: { findUnique: jest.fn().mockResolvedValue({ provider: 'POSTER' }) },
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-1',
          orderCode: '1234',
          customerName: 'Аня',
          customerPhone: null,
          notes: null,
          totalCents: 7100,
          currency: 'MDL',
          store: { externalProvider: 'POSTER', externalId: '7' },
          items: [{ productSnapshot: snapshot, quantity: 2, unitPriceCents: 7100 }],
        }),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([{ id: 'p-cappuccino', externalProvider: 'POSTER', externalId: '100' }]),
      },
      modifier: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const pos = new PosService(
      prisma as unknown as PrismaService,
      {} as SecretCipher,
      {} as BrandScopeService,
      {} as IikoProvider,
      {} as PosterProvider,
      {} as NotificationsService,
      {} as ConfigService,
      {} as Queue,
    );
    return { pos, prisma };
  }

  it('sends the picks as the line comment, before the note, and no modifiers', async () => {
    const snapshot = JSON.parse(JSON.stringify(snapshotOf()));
    const { pos, prisma } = service(snapshot);

    const order = await pos.loadOrderForPush('order-1', 'int-1');

    expect(order.items).toEqual([
      {
        productExternalId: '100',
        name: 'Капучино',
        quantity: 2,
        unitPriceCents: 7100,
        modifiers: [],
        notes: 'M, Горячий · Овсяное · Ваниль + Солёная карамель · Сахар ×2 · без крышки',
      },
    ]);
    expect(prisma.modifier.findMany).not.toHaveBeenCalled();
  });

  function snapshotOf() {
    return (OrdersService.prototype as unknown as { snapshotItem: (l: CheckoutLine) => unknown }).snapshotItem.call(
      {},
      CHECKOUT_LINE,
    );
  }
});
