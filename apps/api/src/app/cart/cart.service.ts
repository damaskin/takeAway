import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { CartItem, Modifier, Prisma, Product, Variation, VariationType } from '@prisma/client';
import type {
  CartChangeReason,
  CartChangedItem,
  OptionLine,
  OptionSelection,
  OrderItemModifier,
  OrderItemVariation,
  ProductOptionGroup,
} from '@takeaway/shared-types';
import {
  type OptionPicks,
  defaultOptionPicks,
  fromOptionSelections,
  optionLinesFor,
  optionSelectionKey,
  priceWithOptionPicks,
  sortVariationsForDisplay,
  toOptionSelections,
  validateOptionPicks,
} from '@takeaway/utils';

import { checkoutError } from '../common/http/checkout-error';
import { activeStopWhere, availableOptionsIncludeAt } from '../catalog/option-availability';
import { soldOnItsOwn } from '../catalog/product-listing';
import { KitchenLoadService } from '../kitchen/kitchen-load.service';
import { QueuePolicyService, asapVerdict } from '../kitchen/queue-policy.service';
import { StoreAvailabilityService, type StoreAvailabilityView } from '../kitchen/store-availability.service';
import { optionsError } from '../option-groups/options-error';
import { ProductOptionGroupsService } from '../option-groups/product-option-groups.service';
import { PrismaService } from '../prisma/prisma.service';
import { CartChangedException } from './cart-changed.exception';
import type { AddCartItemDto, UpdateCartItemDto } from './dto/add-cart-item.dto';
import type { CartDto, CartItemDto, CartQueueFields } from './dto/cart.dto';

/** A product with everything that goes into its price. */
export type PricedProduct = Product & { variations: Variation[]; modifiers: Modifier[] };

/**
 * A product as one store sells it: only the options that store has in stock,
 * its listing row there — `stores` is empty when the store does not sell
 * the product at all — and what its category says about selling it.
 */
export type StoreProduct = PricedProduct & {
  stores: ReadonlyArray<{ storeId: string }>;
  category: { visible: boolean; addOnsOnly: boolean };
};

/** `include` that loads a product as {@link StoreProduct} for `storeId`. */
export function storeProductInclude(storeId: string, now: Date = new Date()) {
  return {
    ...availableOptionsIncludeAt(storeId, now),
    stores: { where: { storeId }, select: { storeId: true } },
    category: { select: { visible: true, addOnsOnly: true } },
  } satisfies Prisma.ProductInclude;
}

/** A cart's lines as the cart screen shows them: the product's name, and its brand for catalog picks. */
const CART_ITEMS_INCLUDE = {
  items: { include: { product: { select: { name: true, brandId: true } } } },
} satisfies Prisma.CartInclude;

/**
 * On the menu as a thing to order: the product is shown and its category is
 * too, and the category is not one of add-ons (an extra ingredient imported
 * from the POS is added to a drink, never bought alone).
 */
function onTheMenu(product: StoreProduct): boolean {
  return product.visible && soldOnItsOwn(product.category);
}

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
  /**
   * Picks from the options catalog, as the cart row keeps them (sorted by
   * option id); empty for a product without catalog groups.
   */
  options: OptionSelection[];
  /** The same picks with names and prices, in page order — the order snapshot's `optionLines`. */
  optionLines: OptionLine[];
}

/** A cart line that passed the checkout price check, ready to become an order line. */
export interface CheckoutLine extends PricedLine {
  productId: string;
  productSlug: string;
  productName: string;
  quantity: number;
  notes: string | null;
}

/** Mirrors the DTO's limit — merging two lines never builds one past it. */
const MAX_LINE_QUANTITY = 99;

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kitchen: KitchenLoadService,
    private readonly availability: StoreAvailabilityService,
    private readonly optionGroups: ProductOptionGroupsService,
    /** Always provided by KitchenModule; unit tests written before the queue policy leave it out (= off). */
    @Optional() private readonly queue?: QueuePolicyService,
  ) {}

  async getForUserAndStore(userId: string, storeId: string): Promise<CartDto> {
    const cart = await this.prisma.cart.findUnique({
      where: { userId_storeId: { userId, storeId } },
      include: CART_ITEMS_INCLUDE,
    });
    if (!cart) {
      return this.emptyCartShape(userId, storeId);
    }
    const optionLines = await this.cartOptionLines(cart.storeId, cart.items);
    // Re-quote on read: the stored value was right when the cart last
    // changed, but the queue moves on without us. A customer who opened the
    // app ten minutes ago should not be shown a wait from ten minutes ago.
    if (this.queue?.enabled) {
      const queued = await this.quoteQueued(cart.storeId, cart.items);
      return this.toDto({ ...cart, etaSeconds: queued.etaSeconds }, optionLines, queued.fields);
    }
    const etaSeconds = await this.quoteEta(cart.storeId, cart.items);
    return this.toDto({ ...cart, etaSeconds }, optionLines);
  }

  async addItem(userId: string, dto: AddCartItemDto): Promise<CartDto> {
    const product = await this.loadProduct(dto.productId, dto.storeId);
    // A hidden product is off the menu — the catalog answers 404 for it, and
    // so does the cart, or checkout would only turn it away later. The same
    // goes for one the menu leaves out with its category.
    if (!product || !onTheMenu(product)) throw new NotFoundException('Product not found');
    // A store that takes no order at all — switched off, or no working hours
    // in the next day — takes nothing into a basket either: the clients show
    // it as inactive, and an old tab, a QR code or a direct link must not
    // fill a cart nobody can send. With the shift closed it still takes
    // pre-orders, so the basket fills as usual.
    if (product.brandId !== (await this.assertStoreTakesOrders(dto.storeId)).brandId) {
      throw new BadRequestException('Product does not belong to this store brand');
    }

    assertSoldHere(product);
    await this.assertNotOnStopList(dto.storeId, [product.id]);

    // A product with catalog groups is ordered through them alone; the
    // older variations and extras of the request are ignored.
    const groups = await this.optionGroups.forProduct(product.id, { brandId: product.brandId, storeId: dto.storeId });
    let priced: PricedLine;
    if (groups.length > 0) {
      priced = priceCatalogChoice(product, groups, dto.options, null);
    } else {
      await this.assertOptionsInStock(product, dto.variationIds ?? [], dto.modifiers ?? {});
      priced = this.priceOrReject(product, dto.variationIds ?? [], dto.modifiers ?? {});
    }

    const cart = await this.prisma.cart.upsert({
      where: { userId_storeId: { userId, storeId: dto.storeId } },
      update: {},
      create: { userId, storeId: dto.storeId },
    });

    // The same latte added twice is one line of two, not two lines of one:
    // otherwise the cart shows "×1" twice and its steppers each count only
    // their own half. A line only matches when the kitchen would make it the
    // same way — same size, same extras, same catalog picks, same note.
    const notes = normalizeNotes(dto.notes);
    const pickKey = optionSelectionKey(priced.options);
    const existing = await this.prisma.cartItem.findMany({ where: { cartId: cart.id, productId: product.id } });
    const same = existing.find(
      (item) =>
        sameIds(item.variationIds, priced.variationIds) &&
        sameCounts(storedModifiers(item.modifiersJson), priced.modifiers) &&
        optionSelectionKey(storedOptions(item.optionsJson)) === pickKey &&
        normalizeNotes(item.notes) === notes,
    );

    if (same) {
      await this.prisma.cartItem.update({
        where: { id: same.id },
        data: {
          quantity: Math.min(same.quantity + dto.quantity, MAX_LINE_QUANTITY),
          unitPriceCents: priced.unitPriceCents,
          unitPrepSeconds: priced.unitPrepSeconds,
        },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId: product.id,
          quantity: dto.quantity,
          variationIds: priced.variationIds,
          modifiersJson: priced.modifiers,
          optionsJson: optionsJsonOf(priced.options),
          unitPriceCents: priced.unitPriceCents,
          unitPrepSeconds: priced.unitPrepSeconds,
          notes,
        },
      });
    }

    return this.recalculate(cart.id);
  }

  async updateItem(userId: string, itemId: string, dto: UpdateCartItemDto): Promise<CartDto> {
    const item = await this.prisma.cartItem.findUnique({
      where: { id: itemId },
      include: { cart: true },
    });
    if (!item || item.cart.userId !== userId) throw new NotFoundException('Item not found');
    const product = await this.loadProduct(item.productId, item.cart.storeId);
    if (!product) throw new NotFoundException('Product not found');

    assertSoldHere(product);
    await this.assertNotOnStopList(item.cart.storeId, [item.productId]);

    // A quantity change sends no choice: the line keeps the picks it has.
    const groups = await this.optionGroups.forProduct(product.id, {
      brandId: product.brandId,
      storeId: item.cart.storeId,
    });
    let priced: PricedLine;
    if (groups.length > 0) {
      priced = priceCatalogChoice(product, groups, dto.options, storedOptions(item.optionsJson));
    } else {
      const variationIds = dto.variationIds ?? item.variationIds;
      const modifiers = dto.modifiers ?? storedModifiers(item.modifiersJson);
      await this.assertOptionsInStock(product, variationIds, modifiers);
      priced = this.priceOrReject(product, variationIds, modifiers);
    }

    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: {
        quantity: dto.quantity ?? item.quantity,
        variationIds: priced.variationIds,
        modifiersJson: priced.modifiers,
        optionsJson: optionsJsonOf(priced.options),
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

  /**
   * Prices every line again, against the menu as it is now.
   *
   * A cart keeps the price a line had when it went in, and the menu moves on
   * without it: a corrected price, a hidden product or a deleted milk must
   * not reach the charge or the kitchen as they were. Lines that still match
   * come back ready to be snapshotted into an order. If anything the
   * customer would notice has changed, the cart is brought up to date — lines
   * that can no longer be made are removed, re-priced ones rewritten — and
   * the checkout is refused, so the customer sees the new total before
   * paying it.
   *
   * @throws CartChangedException (409) when any line changed.
   */
  async repriceForCheckout(cart: {
    id: string;
    storeId: string;
    items: ReadonlyArray<CartItem & { product: StoreProduct }>;
  }): Promise<CheckoutLine[]> {
    const lines: CheckoutLine[] = [];
    const changes: CartChangedItem[] = [];
    const removed: string[] = [];
    const rewritten: Array<{ id: string; line: PricedLine }> = [];

    const brandId = cart.items[0]?.product.brandId;
    const catalog = brandId
      ? await this.optionGroups.forProducts(
          cart.items.map((i) => i.productId),
          { brandId, storeId: cart.storeId },
        )
      : new Map<string, ProductOptionGroup[]>();

    for (const item of cart.items) {
      const change = (reason: CartChangeReason, unitPriceCents: number | null): CartChangedItem => ({
        cartItemId: item.id,
        productId: item.productId,
        productName: item.product.name,
        reason,
        previousUnitPriceCents: item.unitPriceCents,
        unitPriceCents,
      });

      // Hidden (itself or with its category), only an add-on, or no longer
      // sold in this store: either way it cannot be ordered here.
      if (!onTheMenu(item.product) || item.product.stores.length === 0) {
        changes.push(change('PRODUCT_UNAVAILABLE', null));
        removed.push(item.id);
        continue;
      }

      // A product on the options catalog, or a line made with its picks:
      // the picks are checked against the groups as they are now. One gone
      // — switched off, stopped, deleted, its group detached — or a rule
      // the line no longer meets takes the line out, like a deleted milk.
      const groups = catalog.get(item.productId) ?? [];
      const picked = storedOptions(item.optionsJson);
      if (groups.length > 0 || picked.length > 0) {
        const line = repriceCatalogLine(item, groups, picked);
        if (!line) {
          changes.push(change('OPTION_UNAVAILABLE', null));
          removed.push(item.id);
        } else if (line.unitPriceCents !== item.unitPriceCents) {
          changes.push(change('PRICE_CHANGED', line.unitPriceCents));
          rewritten.push({ id: item.id, line });
        } else {
          lines.push({
            ...line,
            productId: item.product.id,
            productSlug: item.product.slug,
            productName: item.product.name,
            quantity: item.quantity,
            notes: item.notes,
          });
        }
        continue;
      }

      const stored = storedModifiers(item.modifiersJson);
      const { line, problems } = this.priceItem(item.product, item.variationIds, stored);
      if (problems.length > 0) {
        // Making it without the option that went away would be a different
        // drink, so the line goes rather than quietly changing.
        changes.push(change('OPTION_UNAVAILABLE', null));
        removed.push(item.id);
        continue;
      }

      const priceChanged = line.unitPriceCents !== item.unitPriceCents;
      if (priceChanged || !sameCounts(stored, line.modifiers)) {
        changes.push(change(priceChanged ? 'PRICE_CHANGED' : 'OPTIONS_CHANGED', line.unitPriceCents));
        rewritten.push({ id: item.id, line });
        continue;
      }

      lines.push({
        ...line,
        productId: item.product.id,
        productSlug: item.product.slug,
        productName: item.product.name,
        quantity: item.quantity,
        notes: item.notes,
      });
    }

    if (changes.length === 0) return lines;

    await this.prisma.$transaction([
      ...(removed.length > 0 ? [this.prisma.cartItem.deleteMany({ where: { id: { in: removed } } })] : []),
      ...rewritten.map(({ id, line }) =>
        this.prisma.cartItem.update({
          where: { id },
          data: {
            variationIds: line.variationIds,
            modifiersJson: line.modifiers,
            optionsJson: optionsJsonOf(line.options),
            unitPriceCents: line.unitPriceCents,
            unitPrepSeconds: line.unitPrepSeconds,
          },
        }),
      ),
    ]);
    await this.recalculate(cart.id);
    throw new CartChangedException(changes);
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
        options: [],
        optionLines: [],
      },
      problems,
    };
  }

  private async recalculate(cartId: string): Promise<CartDto> {
    const cart = await this.prisma.cart.findUnique({
      where: { id: cartId },
      include: CART_ITEMS_INCLUDE,
    });
    if (!cart) throw new NotFoundException('Cart not found');

    const subtotalCents = cart.items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
    const queued = this.queue?.enabled ? await this.quoteQueued(cart.storeId, cart.items) : null;
    const etaSeconds = queued ? queued.etaSeconds : await this.quoteEta(cart.storeId, cart.items);

    await this.prisma.cart.update({
      where: { id: cart.id },
      data: { subtotalCents, etaSeconds },
    });

    const optionLines = await this.cartOptionLines(cart.storeId, cart.items);
    return this.toDto({ ...cart, subtotalCents, etaSeconds }, optionLines, queued?.fields);
  }

  /**
   * The catalog picks of every line with names and prices, as the cart
   * shows them (`CartItem.options`), read from the groups as they are now.
   * No query for a cart without catalog picks.
   */
  private async cartOptionLines(
    storeId: string,
    items: ReadonlyArray<{ id: string; productId: string; optionsJson?: unknown; product: { brandId?: string } }>,
  ): Promise<Map<string, OptionLine[]>> {
    const lines = new Map<string, OptionLine[]>();
    const picked = items
      .map((item) => ({ item, picks: storedOptions(item.optionsJson) }))
      .filter(({ picks }) => picks.length > 0);
    const brandId = picked[0]?.item.product.brandId;
    if (!brandId) return lines;
    const catalog = await this.optionGroups.forProducts(
      picked.map(({ item }) => item.productId),
      { brandId, storeId },
    );
    for (const { item, picks } of picked) {
      lines.set(item.id, optionLinesFor(catalog.get(item.productId) ?? [], fromOptionSelections(picks)));
    }
    return lines;
  }

  /**
   * The queue policy's quote (`QUEUE_POLICY_ENABLED`, docs/queue-policy.md
   * 2.5): the cart placed now at the end of the store's queue, B and
   * «Готовится параллельно» read from the products as they are now — when
   * it would be ready, and whether it can be ordered for now at all (the
   * store's hours, «Перерыв» and shift, the closing, the longest wait). An
   * empty cart answers like the old quote: nothing to wait for, no fields.
   */
  private async quoteQueued(
    storeId: string,
    items: readonly { productId: string; quantity: number }[],
  ): Promise<{ etaSeconds: number; fields?: CartQueueFields }> {
    const queue = this.queue;
    if (!queue || items.length === 0) return { etaSeconds: 0 };
    const now = new Date();
    const basket = await queue.basket(items);
    const [quote, view] = await Promise.all([
      queue.quoteBasket(storeId, basket, now),
      this.availability.forStore(storeId, now),
    ]);
    const verdict = view
      ? asapVerdict(view, quote.readyAt.getTime(), now.getTime(), queue.maxAsapWaitSeconds)
      : { available: false, reason: null };
    return {
      etaSeconds: quote.etaSeconds,
      fields: {
        readyAt: quote.readyAt.toISOString(),
        asapAvailable: verdict.available,
        asapBlockedReason: verdict.reason,
      },
    };
  }

  /**
   * ETA for what is in the cart right now, against the store's live queue
   * and its slots: a basket with no room in the slot it would be ready in
   * is quoted for the next one with room. Zero for an empty cart — there is
   * nothing to wait for, and quoting the queue wait alone would show a
   * countdown for no order.
   */
  private async quoteEta(
    storeId: string,
    items: readonly { quantity: number; unitPrepSeconds: number }[],
  ): Promise<number> {
    if (items.length === 0) return 0;
    const { prepSeconds, workSeconds } = this.kitchen.timings(items);
    const quote = await this.kitchen.quote(storeId, prepSeconds, workSeconds);
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
        ...activeStopWhere(),
      },
      select: { product: { select: { name: true } } },
    });
    if (stopped.length === 0) return;

    const names = stopped.map((e) => e.product.name);
    throw checkoutError('ITEMS_UNAVAILABLE', `Currently unavailable at this store: ${names.join(', ')}`, {
      items: names,
    });
  }

  /**
   * Refuse options the customer picked that exist on the product but are not
   * on sale here — their ingredient ran out, brand-wide or in this store —
   * with the same coded error as a stopped product, naming the option. Ids
   * the product never had are left to the pricing check (a plain 400).
   */
  private async assertOptionsInStock(
    product: PricedProduct,
    variationIds: readonly string[],
    modifiers: Record<string, unknown>,
  ): Promise<void> {
    const shownVariations = new Set(product.variations.map((v) => v.id));
    const shownModifiers = new Set(product.modifiers.map((m) => m.id));
    const missingVariations = [...new Set(variationIds)].filter((id) => !shownVariations.has(id));
    const missingModifiers = Object.entries(modifiers)
      .filter(([id, count]) => toCount(count) > 0 && !shownModifiers.has(id))
      .map(([id]) => id);
    if (missingVariations.length === 0 && missingModifiers.length === 0) return;

    const [variations, extras] = await Promise.all([
      missingVariations.length > 0
        ? this.prisma.variation.findMany({
            where: { productId: product.id, id: { in: missingVariations } },
            select: { name: true },
          })
        : [],
      missingModifiers.length > 0
        ? this.prisma.modifier.findMany({
            where: { productId: product.id, id: { in: missingModifiers } },
            select: { name: true },
          })
        : [],
    ]);
    const names = [...variations, ...extras].map((o) => o.name);
    if (names.length === 0) return;
    throw checkoutError('ITEMS_UNAVAILABLE', `Currently unavailable at this store: ${names.join(', ')}`, {
      items: names,
    });
  }

  private async loadProduct(productId: string, storeId: string): Promise<StoreProduct | null> {
    return this.prisma.product.findUnique({
      where: { id: productId },
      include: storeProductInclude(storeId),
    });
  }

  /**
   * The store exists, its brand passed moderation and it takes some order
   * (`acceptingOrders`: an ASAP one now, or a pre-order in the next 24
   * hours — see catalog/store-availability.ts). Adding to the cart and
   * placing the order both check it; the catalog only hides the rest, and a
   * direct link, a QR code or an old cart could still order from a store
   * that is switched off or from an unapproved brand. Returns the store's
   * brand id and its availability, which the order path reads for ASAP.
   */
  async assertStoreTakesOrders(storeId: string): Promise<{ brandId: string; availability: StoreAvailabilityView }> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { brandId: true, brand: { select: { moderationStatus: true } } },
    });
    if (!store || store.brand.moderationStatus !== 'APPROVED') throw new NotFoundException('Store not found');
    const availability = await this.availability.forStore(storeId);
    if (!availability) throw new NotFoundException('Store not found');
    if (!availability.acceptingOrders) {
      throw checkoutError('STORE_NOT_TAKING_ORDERS', 'This store is not taking orders right now');
    }
    return { brandId: store.brandId, availability };
  }

  private toDto(
    cart: {
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
    },
    optionLines: ReadonlyMap<string, OptionLine[]>,
    queued?: CartQueueFields,
  ): CartDto {
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
        options: optionLines.get(i.id) ?? [],
        unitPriceCents: i.unitPriceCents,
        unitPrepSeconds: i.unitPrepSeconds,
        notes: i.notes,
      })),
      updatedAt: cart.updatedAt.toISOString(),
      ...queued,
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

/**
 * Refuse a product the store does not sell (see `ProductStore`). The menu of
 * that store never shows it; this catches a shared link, a product opened
 * from another store of the brand, or a direct API call.
 */
function assertSoldHere(product: StoreProduct): void {
  if (product.stores.length > 0) return;
  throw checkoutError('ITEMS_UNAVAILABLE', `Not sold at this store: ${product.name}`, { items: [product.name] });
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

/** Whether two variation selections pick the same variations, in any order. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** A blank note is no note, so "" and null land on the same line. */
function normalizeNotes(notes: string | null | undefined): string | null {
  const trimmed = notes?.trim();
  return trimmed ? trimmed : null;
}

/** Whether two extra selections take the same extras in the same numbers. */
function sameCounts(stored: Record<string, unknown>, current: Record<string, number>): boolean {
  const taken = Object.entries(stored).filter(([, count]) => toCount(count) > 0);
  return taken.length === Object.keys(current).length && taken.every(([id, count]) => current[id] === toCount(count));
}

/** The `[{ optionId, qty }]` a cart row keeps, read without trusting the JSON. */
function storedOptions(json: unknown): OptionSelection[] {
  if (!Array.isArray(json)) return [];
  const out: OptionSelection[] = [];
  for (const entry of json) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { optionId, qty } = entry as { optionId?: unknown; qty?: unknown };
    if (typeof optionId === 'string' && typeof qty === 'number' && Number.isFinite(qty)) out.push({ optionId, qty });
  }
  return out;
}

/** Catalog picks as the cart row's JSON column takes them. */
function optionsJsonOf(options: readonly OptionSelection[]): Prisma.InputJsonArray {
  return options.map(({ optionId, qty }) => ({ optionId, qty }));
}

/** One line of a product on the options catalog, priced by the shared rules. */
function catalogLine(
  product: Pick<Product, 'basePriceCents' | 'prepTimeSeconds'>,
  groups: readonly ProductOptionGroup[],
  picks: OptionPicks,
): PricedLine {
  return {
    // A variant priced below the base can outweigh it; a line never pays the customer.
    unitPriceCents: Math.max(0, priceWithOptionPicks(product.basePriceCents, groups, picks)),
    // Options add no kitchen time (docs/option-groups.md): the product's own.
    unitPrepSeconds: product.prepTimeSeconds,
    variationIds: [],
    modifiers: {},
    variations: [],
    modifierLines: [],
    options: toOptionSelections(picks),
    optionLines: optionLinesFor(groups, picks),
  };
}

/**
 * Prices the customer's choice of a product with catalog groups, or answers
 * 400 (`OptionsErrorBody`). No `options` in the request: the line's own
 * picks when it has some (a quantity change), else the defaults — and
 * `OPTIONS_REQUIRED` when they are not a valid choice (a client that
 * predates the catalog cannot pick a size).
 */
function priceCatalogChoice(
  product: Pick<Product, 'basePriceCents' | 'prepTimeSeconds'>,
  groups: readonly ProductOptionGroup[],
  requested: readonly OptionSelection[] | undefined,
  stored: readonly OptionSelection[] | null,
): PricedLine {
  const fromClient = requested !== undefined;
  const kept = !fromClient && stored !== null && stored.length > 0;
  const picks = fromClient
    ? fromOptionSelections(requested)
    : kept
      ? fromOptionSelections(stored)
      : defaultOptionPicks(groups);
  const errors = validateOptionPicks(groups, picks);
  if (errors.length > 0) throw optionsError(fromClient || kept ? 'OPTIONS_INVALID' : 'OPTIONS_REQUIRED', errors);
  return catalogLine(product, groups, picks);
}

/**
 * A cart line of catalog picks against the groups as they are now, or null
 * when it can no longer be made as it went in: the product lost its groups,
 * the line still carries older options, or the picks break a rule (one is
 * gone, stopped or hidden, or a group it lacks became required).
 */
function repriceCatalogLine(
  item: Pick<CartItem, 'variationIds' | 'modifiersJson'> & {
    product: Pick<Product, 'basePriceCents' | 'prepTimeSeconds'>;
  },
  groups: readonly ProductOptionGroup[],
  picked: readonly OptionSelection[],
): PricedLine | null {
  if (groups.length === 0) return null;
  const olderOptions =
    item.variationIds.length > 0 || Object.values(storedModifiers(item.modifiersJson)).some((c) => toCount(c) > 0);
  if (olderOptions) return null;
  const picks = fromOptionSelections(picked);
  if (validateOptionPicks(groups, picks).length > 0) return null;
  return catalogLine(item.product, groups, picks);
}
