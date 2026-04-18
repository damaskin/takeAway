import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Modifier, Product, Variation } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type { AddCartItemDto, UpdateCartItemDto } from './dto/add-cart-item.dto';
import type { CartDto, CartItemDto } from './dto/cart.dto';

interface PricedItem {
  unitPriceCents: number;
  unitPrepSeconds: number;
  variationIds: string[];
  modifiers: Record<string, number>;
}

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async getForUserAndStore(userId: string, storeId: string): Promise<CartDto> {
    const cart = await this.prisma.cart.findUnique({
      where: { userId_storeId: { userId, storeId } },
      include: { items: { include: { product: { select: { name: true } } } } },
    });
    if (!cart) {
      return this.emptyCartShape(userId, storeId);
    }
    return this.toDto(cart);
  }

  async addItem(userId: string, dto: AddCartItemDto): Promise<CartDto> {
    const product = await this.loadProduct(dto.productId);
    if (!product) throw new NotFoundException('Product not found');
    if (product.brandId !== (await this.getStoreBrandId(dto.storeId))) {
      throw new BadRequestException('Product does not belong to this store brand');
    }

    const priced = this.priceItem(product, dto.variationIds ?? [], dto.modifiers ?? {});

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

    const variationIds = dto.variationIds ?? item.variationIds;
    const modifiers = dto.modifiers ?? (item.modifiersJson as Record<string, number>);
    const priced = this.priceItem(item.product, variationIds, modifiers);

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

  private priceItem(
    product: Product & { variations: Variation[]; modifiers: Modifier[] },
    rawVariationIds: string[],
    rawModifiers: Record<string, number>,
  ): PricedItem {
    const knownVariationIds = new Set(product.variations.map((v) => v.id));
    const variationIds = rawVariationIds.filter((id) => knownVariationIds.has(id));

    const modifiers: Record<string, number> = {};
    for (const m of product.modifiers) {
      const count = Number(rawModifiers[m.id] ?? 0);
      const clamped = Math.max(m.minCount, Math.min(m.maxCount, Math.floor(count)));
      if (clamped > 0) modifiers[m.id] = clamped;
    }

    let unitPriceCents = product.basePriceCents;
    let unitPrepSeconds = product.prepTimeSeconds;

    for (const v of product.variations) {
      if (variationIds.includes(v.id)) {
        unitPriceCents += v.priceDeltaCents;
        unitPrepSeconds += v.prepTimeDeltaSeconds;
      }
    }
    for (const m of product.modifiers) {
      const count = modifiers[m.id] ?? 0;
      unitPriceCents += m.priceDeltaCents * count;
      unitPrepSeconds += m.prepTimeDeltaSeconds * count;
    }

    return { unitPriceCents, unitPrepSeconds, variationIds, modifiers };
  }

  private async recalculate(cartId: string): Promise<CartDto> {
    const cart = await this.prisma.cart.findUnique({
      where: { id: cartId },
      include: {
        items: { include: { product: { select: { name: true } } } },
        store: { select: { currentEtaSeconds: true } },
      },
    });
    if (!cart) throw new NotFoundException('Cart not found');

    const subtotalCents = cart.items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
    const maxItemPrep = cart.items.reduce((max, i) => Math.max(max, i.unitPrepSeconds), 0);
    // Store baseline accounts for queue + staffing; single-item prep is the
    // serial bottleneck. Sum-of-all would double-count parallel work.
    const etaSeconds = cart.items.length === 0 ? 0 : cart.store.currentEtaSeconds + maxItemPrep;

    await this.prisma.cart.update({
      where: { id: cart.id },
      data: { subtotalCents, etaSeconds },
    });

    return this.toDto({ ...cart, subtotalCents, etaSeconds });
  }

  private async loadProduct(productId: string) {
    return this.prisma.product.findUnique({
      where: { id: productId },
      include: { variations: true, modifiers: true },
    });
  }

  private async getStoreBrandId(storeId: string): Promise<string> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { brandId: true },
    });
    if (!store) throw new NotFoundException('Store not found');
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
