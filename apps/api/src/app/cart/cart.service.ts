import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Modifier, Prisma, Product, Variation, VariationType } from '@prisma/client';
import type { OrderItemModifier, OrderItemVariation } from '@takeaway/shared-types';
import { sortVariationsForDisplay } from '@takeaway/utils';

import { KitchenLoadService } from '../kitchen/kitchen-load.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AddCartItemDto, UpdateCartItemDto } from './dto/add-cart-item.dto';
import type { CartDto, CartItemDto } from './dto/cart.dto';

/** A product with everything that goes into its price. */
export type PricedProduct = Product & { variations: Variation[]; modifiers: Modifier[] };

/** One line priced against the menu as it stands. */
export interface PricedLine {
  unitPriceCents: number;
  unitPrepSeconds: number;
  variationIds: string[];
  modifiers: Record<string, number>;
  /** The variations the line is made with — chosen or defaulted — size first. */
  variations: OrderItemVariation[];
  /** Extras with a positive count, in menu order. */
  modifierLines: OrderItemModifier[];
}

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kitchen: KitchenLoadService,
  ) {}

  async getForUserAndStore(userId: string, storeId: string): Promise<CartDto> {
    const cart = await this.prisma.cart.findUnique({
      where: { userId_storeId: { userId, storeId } },
      include: { items: { include: { product: { select: { name: true } } } } },
    });
    if (!cart) {
      return this.emptyCartShape(userId, storeId);
    }
    // Re-quote on read: the stored value was right when the cart last
    // changed, but the queue moves on without us. A customer who opened the
    // app ten minutes ago should not be shown a wait from ten minutes ago.
    const etaSeconds = await this.quoteEta(cart.storeId, cart.items);
    return this.toDto({ ...cart, etaSeconds });
  }

  async addItem(userId: string, dto: AddCartItemDto): Promise<CartDto> {
    const product = await this.loadProduct(dto.productId);
    // A hidden product is off the menu — the catalog answers 404 for it, and
    // so does the cart, or checkout would only turn it away later.
    if (!product || !product.visible) throw new NotFoundException('Product not found');
    if (product.brandId !== (await this.assertStoreTakesOrders(dto.storeId))) {
      throw new BadRequestException('Product does not belong to this store brand');
    }

    await this.assertNotOnStopList(dto.storeId, [product.id]);

    const priced = this.priceOrReject(product, dto.variationIds ?? [], dto.modifiers ?? {});

    const cart = await this.prisma.cart.upsert({
      where: { userId_storeId: { userId, storeId: dto.storeId } },
      update: {},
      create: { userId, storeId: dto.storeId },
    });

    await this.prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId: product.id,
        quantity: dto.quantity,
        variationIds: priced.variationIds,
        modifiersJson: priced.modifiers,
        unitPriceCents: priced.unitPriceCents,
        unitPrepSeconds: priced.unitPrepSeconds,
        notes: dto.notes,
      },
    });

    return this.recalculate(cart.id);
  }

  async updateItem(userId: string, itemId: string, dto: UpdateCartItemDto): Promise<CartDto> {
    const item = await this.prisma.cartItem.findUnique({
      where: { id: itemId },
      include: { cart: true, product: { include: { variations: true, modifiers: true } } },
    });
    if (!item || item.cart.userId !== userId) throw new NotFoundException('Item not found');

    await this.assertNotOnStopList(item.cart.storeId, [item.productId]);

    const variationIds = dto.variationIds ?? item.variationIds;
    const modifiers = dto.modifiers ?? storedModifiers(item.modifiersJson);
    const priced = this.priceOrReject(item.product, variationIds, modifiers);

    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: {
        quantity: dto.quantity ?? item.quantity,
        variationIds: priced.variationIds,
        modifiersJson: priced.modifiers,
        unitPriceCents: priced.unitPriceCents,
        unitPrepSeconds: priced.unitPrepSeconds,
        notes: dto.notes ?? item.notes,
      },
    });

    return this.recalculate(item.cartId);
  }

  async removeItem(userId: string, itemId: string): Promise<CartDto> {
    const item = await this.prisma.cartItem.findUnique({
      where: { id: itemId },
      include: { cart: true },
    });
    if (!item || item.cart.userId !== userId) throw new NotFoundException('Item not found');

    await this.prisma.cartItem.delete({ where: { id: itemId } });
    return this.recalculate(item.cartId);
  }

  async clear(userId: string, storeId: string): Promise<CartDto> {
    const cart = await this.prisma.cart.findUnique({
      where: { userId_storeId: { userId, storeId } },
    });
    if (!cart) return this.emptyCartShape(userId, storeId);

    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return this.recalculate(cart.id);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Prices what the customer asked for, or answers 400 saying why it cannot be made. */
  private priceOrReject(
    product: PricedProduct,
    variationIds: readonly string[],
    modifiers: Record<string, unknown>,
  ): PricedLine {
    const { line, problems } = this.priceItem(product, variationIds, modifiers);
    if (problems.length > 0) throw new BadRequestException(problems.join('; '));
    return line;
  }

  /**
   * The single definition of what a line costs — add-to-cart and checkout
   * both come through here.
   *
   * Option rules: at most one variation of each type; a type the customer
   * left open gets its default (the one marked default, else the first on
   * the menu), because that is what ends up in the cup and the price and the
   * kitchen ticket should both say so; extra counts are clamped to the
   * modifier's limits. An id the product does not have is reported, not
   * dropped — dropping it would sell a latte without the syrup the customer
   * saw on screen. The caller decides what a problem means.
   */
  private priceItem(
    product: PricedProduct,
    rawVariationIds: readonly string[],
    rawModifiers: Record<string, unknown>,
  ): { line: PricedLine; problems: string[] } {
    const problems: string[] = [];

    const variationsById = new Map(product.variations.map((v) => [v.id, v]));
    const chosen = new Map<VariationType, Variation>();
    for (const id of new Set(rawVariationIds)) {
      const variation = variationsById.get(id);
      if (!variation) {
        problems.push(`Option not available for ${product.name}: ${id}`);
      } else if (chosen.has(variation.type)) {
        problems.push(`Choose one ${variation.type.toLowerCase()} for ${product.name}`);
      } else {
        chosen.set(variation.type, variation);
      }
    }
    const variationMenu = byMenuOrder(product.variations);
    for (const variation of variationMenu) {
      if (chosen.has(variation.type)) continue;
      chosen.set(variation.type, variationMenu.find((v) => v.type === variation.type && v.isDefault) ?? variation);
    }

    const knownModifiers = new Set(product.modifiers.map((m) => m.id));
    for (const [id, count] of Object.entries(rawModifiers)) {
      if (!knownModifiers.has(id) && toCount(count) > 0) {
        problems.push(`Option not available for ${product.name}: ${id}`);
      }
    }

    let unitPriceCents = product.basePriceCents;
    let unitPrepSeconds = product.prepTimeSeconds;
    for (const v of chosen.values()) {
      unitPriceCents += v.priceDeltaCents;
      unitPrepSeconds += v.prepTimeDeltaSeconds;
    }

    const modifiers: Record<string, number> = {};
    const modifierLines: OrderItemModifier[] = [];
    for (const m of byMenuOrder(product.modifiers)) {
      const count = Math.max(m.minCount, Math.min(m.maxCount, toCount(rawModifiers[m.id])));
      if (count <= 0) continue;
      modifiers[m.id] = count;
      modifierLines.push({ id: m.id, name: m.name, count, priceCents: m.priceDeltaCents });
      unitPriceCents += m.priceDeltaCents * count;
      unitPrepSeconds += m.prepTimeDeltaSeconds * count;
    }

    const variations = sortVariationsForDisplay([...chosen.values()]);
    return {
      line: {
        // A discount-style delta can outweigh the base price; a line never
        // pays the customer, and a drink never takes negative time.
        unitPriceCents: Math.max(0, unitPriceCents),
        unitPrepSeconds: Math.max(0, unitPrepSeconds),
        variationIds: variations.map((v) => v.id),
        modifiers,
        variations: variations.map((v) => ({
          id: v.id,
          type: v.type,
          name: v.name,
          priceDeltaCents: v.priceDeltaCents,
        })),
        modifierLines,
      },
      problems,
    };
  }

  private async recalculate(cartId: string): Promise<CartDto> {
    const cart = await this.prisma.cart.findUnique({
      where: { id: cartId },
      include: { items: { include: { product: { select: { name: true } } } } },
    });
    if (!cart) throw new NotFoundException('Cart not found');

    const subtotalCents = cart.items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
    const etaSeconds = await this.quoteEta(cart.storeId, cart.items);

    await this.prisma.cart.update({
      where: { id: cart.id },
      data: { subtotalCents, etaSeconds },
    });

    return this.toDto({ ...cart, subtotalCents, etaSeconds });
  }

  /**
   * ETA for what is in the cart right now, against the store's live queue.
   * Zero for an empty cart — there is nothing to wait for, and quoting the
   * queue wait alone would show a countdown for no order.
   */
  private async quoteEta(
    storeId: string,
    items: readonly { quantity: number; unitPrepSeconds: number }[],
  ): Promise<number> {
    if (items.length === 0) return 0;
    const { prepSeconds } = this.kitchen.timings(items);
    const quote = await this.kitchen.quote(storeId, prepSeconds);
    return quote.etaSeconds;
  }

  /**
   * Refuse products the store has taken off sale.
   *
   * The catalogue already flags them with `onStopList`, but that is a hint
   * for the UI — nothing stopped a stale screen, a deep link or a direct
   * API call from putting an out-of-stock item on the kitchen board. An
   * entry with a past `expiresAt` has auto-restocked and does not block.
   */
  async assertNotOnStopList(storeId: string, productIds: readonly string[]): Promise<void> {
    if (productIds.length === 0) return;

    const stopped = await this.prisma.stopListEntry.findMany({
      where: {
        storeId,
        productId: { in: [...productIds] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { product: { select: { name: true } } },
    });
    if (stopped.length === 0) return;

    const names = stopped.map((e) => e.product.name).join(', ');
    throw new BadRequestException(`Currently unavailable at this store: ${names}`);
  }

  private async loadProduct(productId: string) {
    return this.prisma.product.findUnique({
      where: { id: productId },
      include: { variations: true, modifiers: true },
    });
  }

  /**
   * The store exists, is not switched off, and its brand passed moderation.
   * The catalog only hides the rest; a direct link, a QR code or an old cart
   * could still order from a closed store or an unapproved brand. Returns
   * the store's brand id.
   */
  async assertStoreTakesOrders(storeId: string): Promise<string> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { brandId: true, status: true, brand: { select: { moderationStatus: true } } },
    });
    if (!store || store.brand.moderationStatus !== 'APPROVED') throw new NotFoundException('Store not found');
    if (store.status === 'CLOSED') throw new BadRequestException('This store is not taking orders right now');
    return store.brandId;
  }

  private toDto(cart: {
    id: string;
    userId: string;
    storeId: string;
    subtotalCents: number;
    etaSeconds: number;
    updatedAt: Date;
    items: Array<{
      id: string;
      productId: string;
      product: { name: string };
      quantity: number;
      variationIds: string[];
      modifiersJson: unknown;
      unitPriceCents: number;
      unitPrepSeconds: number;
      notes: string | null;
    }>;
  }): CartDto {
    return {
      id: cart.id,
      userId: cart.userId,
      storeId: cart.storeId,
      subtotalCents: cart.subtotalCents,
      etaSeconds: cart.etaSeconds,
      items: cart.items.map<CartItemDto>((i) => ({
        id: i.id,
        productId: i.productId,
        productName: i.product.name,
        quantity: i.quantity,
        variationIds: i.variationIds,
        modifiers: (i.modifiersJson ?? {}) as Record<string, number>,
        unitPriceCents: i.unitPriceCents,
        unitPrepSeconds: i.unitPrepSeconds,
        notes: i.notes,
      })),
      updatedAt: cart.updatedAt.toISOString(),
    };
  }

  private emptyCartShape(userId: string, storeId: string): CartDto {
    return {
      id: '',
      userId,
      storeId,
      subtotalCents: 0,
      etaSeconds: 0,
      items: [],
      updatedAt: new Date().toISOString(),
    };
  }
}

/** Menu order: the admin's sort order, then id so equal sort orders stay put. */
function byMenuOrder<T extends { id: string; sortOrder: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

/** A requested extra count as a whole number; anything unreadable counts as none. */
function toCount(raw: unknown): number {
  const n = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

/** The `{ modifierId: count }` a cart row keeps, read without trusting the JSON. */
function storedModifiers(json: Prisma.JsonValue): Record<string, unknown> {
  return typeof json === 'object' && json !== null && !Array.isArray(json) ? json : {};
}
