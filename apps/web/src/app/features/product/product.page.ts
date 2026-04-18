import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Modifier, ProductDetail, Variation, VariationType } from '@takeaway/shared-types';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthStore } from '../../core/auth/auth.store';
import { CartService } from '../../core/cart/cart.service';
import { CatalogService } from '../../core/catalog/catalog.service';

const VARIATION_GROUPS: VariationType[] = ['SIZE', 'TEMPERATURE', 'MILK', 'CUP'];

const VARIATION_LABELS: Record<VariationType, string> = {
  SIZE: 'web.product.labels.size',
  TEMPERATURE: 'web.product.labels.temperature',
  MILK: 'web.product.labels.milk',
  CUP: 'web.product.labels.cup',
};

/**
 * Web Product Detail — pencil A3 (9ISer).
 *
 * Layout:
 *   pdpBody (padding 48/80, gap 64)
 *     pdpImgCol (560px) — hero 480px image, 24px radius
 *     pdpDetailCol (fill) —
 *       breadcrumb
 *       title (Fraunces 36/700) + description (Inter 16, 1.6 line-height)
 *       meta: calories + allergens
 *       variations: Size / Milk / Temperature tab rows (42px pill buttons, caramel fill on active)
 *       modifiers: row with name + price + stepper (36x36 square pills)
 *       caffeine dots (4 coffee cups; filled = caramel, empty = border)
 *       notes textarea (foam, 140px)
 *       add bar: qty stepper + caramel pill button (56px, "Add to cart — $X")
 */
@Component({
  selector: 'app-product',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslatePipe],
  template: `
    @if (product(); as p) {
      <section style="padding: 48px 80px; display: flex; gap: 64px; max-width: 1440px; margin: 0 auto">
        <!-- Image column -->
        <div class="flex flex-col" style="width: 560px; gap: 16px; flex-shrink: 0">
          <div
            [style.background]="heroImageBg(p)"
            style="height: 480px; border-radius: 24px; background-size: cover; background-position: center; overflow: hidden"
          ></div>
        </div>

        <!-- Detail column -->
        <div class="flex flex-col flex-1" style="gap: 20px">
          <!-- Breadcrumb -->
          <nav class="flex items-center" style="gap: 8px">
            <a
              routerLink="/menu"
              style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)"
              >{{ 'web.product.breadcrumbMenu' | translate }}</a
            >
            <span style="color: var(--color-text-tertiary); font-size: 11px">›</span>
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)">{{
              'web.product.breadcrumbCoffee' | translate
            }}</span>
            <span style="color: var(--color-text-tertiary); font-size: 11px">›</span>
            <span
              style="font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-text-primary)"
              >{{ p.name }}</span
            >
          </nav>

          <!-- Title block -->
          <div class="flex flex-col" style="gap: 8px">
            <h1
              style="font-family: var(--font-display); font-size: 36px; font-weight: 700; color: var(--color-espresso); margin: 0"
            >
              {{ p.name }}
            </h1>
            @if (p.description) {
              <p
                style="font-family: var(--font-sans); font-size: 16px; line-height: 1.6; color: var(--color-text-secondary); margin: 0"
              >
                {{ p.description }}
              </p>
            }
            <!-- Meta: calories + allergens -->
            <div class="flex items-center" style="gap: 16px; margin-top: 4px">
              @if (p.calories !== null) {
                <div class="flex items-center" style="gap: 6px">
                  <span style="color: var(--color-text-tertiary); font-size: 14px">🔥</span>
                  <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)">{{
                    'web.product.labels.kcal' | translate: { calories: p.calories }
                  }}</span>
                </div>
              }
              @if (p.allergens.length > 0) {
                <div class="flex items-center" style="gap: 6px">
                  <span style="color: var(--color-text-tertiary); font-size: 14px">⚠</span>
                  <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)">{{
                    p.allergens.join(', ')
                  }}</span>
                </div>
              }
            </div>
          </div>

          <!-- Variations -->
          @for (group of variationGroups(); track group.type) {
            <div class="flex flex-col" style="gap: 8px">
              <span
                style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
                >{{ variationLabel(group.type) | translate }}</span
              >
              <div class="flex flex-wrap" style="gap: 8px">
                @for (v of group.variations; track v.id) {
                  <button
                    type="button"
                    (click)="selectVariation(group.type, v.id)"
                    class="flex items-center justify-center"
                    [style.background]="isSelected(group.type, v.id) ? 'var(--color-caramel)' : 'transparent'"
                    [style.color]="isSelected(group.type, v.id) ? 'white' : 'var(--color-text-primary)'"
                    [style.border]="
                      isSelected(group.type, v.id) ? '1px solid transparent' : '1px solid var(--color-border)'
                    "
                    style="height: 42px; padding: 0 20px; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 500; gap: 6px"
                  >
                    <span>{{ v.name }}</span>
                    @if (v.priceDeltaCents > 0) {
                      <span style="opacity: 0.7; font-size: 12px">+{{ priceDelta(v.priceDeltaCents) }}</span>
                    }
                  </button>
                }
              </div>
            </div>
          }

          <!-- Modifiers -->
          @if (p.modifiers.length > 0) {
            <div class="flex flex-col" style="gap: 24px; margin-top: 4px">
              <span
                style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
                >{{ 'web.product.labels.addons' | translate }}</span
              >
              @for (m of p.modifiers; track m.id) {
                <div class="flex items-center justify-between">
                  <div class="flex flex-col" style="gap: 2px">
                    <span style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)">{{
                      m.name
                    }}</span>
                    @if (m.priceDeltaCents > 0) {
                      <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)"
                        >+{{ priceDelta(m.priceDeltaCents) }}</span
                      >
                    }
                  </div>
                  <div
                    class="flex items-center"
                    style="border: 1px solid var(--color-border); border-radius: var(--radius-button); overflow: hidden"
                  >
                    <button
                      type="button"
                      (click)="decModifier(m)"
                      [disabled]="modifierCount(m.id) <= m.minCount"
                      class="flex items-center justify-center disabled:opacity-30"
                      style="width: 36px; height: 36px; font-size: 18px; color: var(--color-text-primary)"
                    >
                      −
                    </button>
                    <span
                      class="flex items-center justify-center"
                      style="width: 36px; height: 36px; font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
                      >{{ modifierCount(m.id) }}</span
                    >
                    <button
                      type="button"
                      (click)="incModifier(m)"
                      [disabled]="modifierCount(m.id) >= m.maxCount"
                      class="flex items-center justify-center disabled:opacity-30"
                      style="width: 36px; height: 36px; font-size: 18px; color: var(--color-text-primary)"
                    >
                      +
                    </button>
                  </div>
                </div>
              }
            </div>
          }

          <!-- Caffeine dots -->
          @if (p.caffeineLevel !== null) {
            <div class="flex items-center" style="gap: 12px">
              <span
                style="font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-text-secondary)"
                >{{ 'web.product.labels.caffeine' | translate }}</span
              >
              <div class="flex items-center" style="gap: 6px">
                @for (i of [0, 1, 2, 3]; track i) {
                  <span
                    [style.color]="i < p.caffeineLevel ? 'var(--color-caramel)' : 'var(--color-border)'"
                    style="font-size: 16px"
                    >☕</span
                  >
                }
              </div>
            </div>
          }

          <!-- Notes -->
          <div class="flex flex-col" style="gap: 8px">
            <label
              for="pdp-notes"
              style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
              >{{ 'web.product.labels.specialInstructions' | translate }}</label
            >
            <textarea
              id="pdp-notes"
              [(ngModel)]="notes"
              rows="4"
              [placeholder]="'web.product.placeholders.notes' | translate"
              style="background: var(--color-foam); border: 1px solid var(--color-border); border-radius: var(--radius-input); padding: 12px 16px; height: 140px; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary); resize: vertical"
            ></textarea>
          </div>

          <!-- Add bar: qty + primary button -->
          <div class="flex items-center" style="gap: 16px; margin-top: 8px">
            <div
              class="flex items-center"
              style="border: 1px solid var(--color-border); border-radius: var(--radius-button); overflow: hidden"
            >
              <button
                type="button"
                (click)="decQty()"
                [disabled]="quantity() <= 1"
                class="flex items-center justify-center disabled:opacity-30"
                style="width: 44px; height: 48px; font-size: 20px; color: var(--color-text-primary)"
              >
                −
              </button>
              <span
                class="flex items-center justify-center"
                style="width: 44px; height: 48px; font-family: var(--font-sans); font-size: 16px; font-weight: 600"
                >{{ quantity() }}</span
              >
              <button
                type="button"
                (click)="incQty()"
                class="flex items-center justify-center"
                style="width: 44px; height: 48px; font-size: 20px; color: var(--color-text-primary)"
              >
                +
              </button>
            </div>
            <button
              type="button"
              (click)="addToCart()"
              [disabled]="adding() || !authStore.isAuthenticated() || !storeId()"
              class="flex items-center justify-center disabled:opacity-60"
              style="flex: 1; height: 56px; background: var(--color-caramel); color: white; border-radius: var(--radius-pill); gap: 12px; font-family: var(--font-sans); font-size: 16px; font-weight: 600"
            >
              <span style="font-size: 18px">🛍</span>
              <span>{{
                adding()
                  ? ('web.product.cta.adding' | translate)
                  : ('web.product.cta.add' | translate: { total: price(totalCents()) })
              }}</span>
            </button>
          </div>
          @if (!authStore.isAuthenticated()) {
            <p
              class="text-center"
              style="margin-top: 4px; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
            >
              <a routerLink="/login" style="color: var(--color-caramel); text-decoration: underline">{{
                'common.signIn' | translate
              }}</a>
              {{ 'web.product.cta.signInPrompt' | translate }}
            </p>
          } @else if (cartItemCount() > 0) {
            <a
              routerLink="/checkout"
              [queryParams]="{ store: storeSlug() }"
              class="flex items-center justify-center"
              style="margin-top: 4px; height: 48px; background: var(--color-espresso); color: var(--color-foam); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600"
              >{{ 'web.product.cta.goToCheckout' | translate: { count: cartItemCount() } }}</a
            >
          }
          @if (addError()) {
            <p
              class="text-center"
              style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin-top: 4px"
            >
              {{ addError() }}
            </p>
          }
        </div>
      </section>
    }

    @if (error()) {
      <section style="padding: 48px 80px; max-width: 1440px; margin: 0 auto">
        <button
          type="button"
          (click)="back()"
          style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin-bottom: 16px"
        >
          ← {{ 'common.back' | translate }}
        </button>
        <p style="color: var(--color-berry); font-family: var(--font-sans); font-size: 14px">{{ error() }}</p>
      </section>
    }
  `,
})
export class ProductPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly catalog = inject(CatalogService);
  private readonly cart = inject(CartService);
  readonly authStore = inject(AuthStore);

  readonly adding = signal(false);
  readonly addError = signal<string | null>(null);
  readonly storeId = signal<string | null>(null);
  readonly storeSlug = signal<string | null>(null);
  readonly cartItemCount = this.cart.itemCount;

  readonly product = signal<ProductDetail | null>(null);
  readonly error = signal<string | null>(null);
  readonly selectedVariations = signal<Partial<Record<VariationType, string>>>({});
  readonly modifierCounts = signal<Record<string, number>>({});
  readonly quantity = signal(1);
  notes = '';

  readonly variationGroups = computed(() => {
    const p = this.product();
    if (!p) return [];
    return VARIATION_GROUPS.map((type) => ({
      type,
      variations: p.variations.filter((v) => v.type === type).sort((a, b) => a.sortOrder - b.sortOrder),
    })).filter((g) => g.variations.length > 0);
  });

  readonly totalCents = computed(() => {
    const p = this.product();
    if (!p) return 0;
    let unit = p.basePriceCents;
    const selected = this.selectedVariations();
    for (const v of p.variations) {
      if (selected[v.type] === v.id) unit += v.priceDeltaCents;
    }
    const counts = this.modifierCounts();
    for (const m of p.modifiers) {
      unit += (counts[m.id] ?? 0) * m.priceDeltaCents;
    }
    return unit * this.quantity();
  });

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) {
      this.error.set('Missing product');
      return;
    }
    this.catalog.getProduct(slug).subscribe({
      next: (p) => {
        this.product.set(p);
        this.initializeDefaults(p);
      },
      error: () => this.error.set('Product not found'),
    });

    this.catalog.listStores().subscribe({
      next: (list) => {
        const first = list[0];
        if (!first) return;
        this.storeId.set(first.id);
        this.storeSlug.set(first.slug);
        if (this.authStore.isAuthenticated()) {
          this.cart.load(first.id).subscribe();
        }
      },
    });
  }

  addToCart(): void {
    const p = this.product();
    const storeId = this.storeId();
    if (!p || !storeId) return;
    this.adding.set(true);
    this.addError.set(null);
    this.cart
      .add({
        storeId,
        productId: p.id,
        quantity: this.quantity(),
        variationIds: Object.values(this.selectedVariations()).filter((id): id is string => Boolean(id)),
        modifiers: this.modifierCounts(),
      })
      .subscribe({
        next: () => this.adding.set(false),
        error: (err) => {
          this.adding.set(false);
          const maybe = err as { error?: { message?: string }; message?: string };
          this.addError.set(maybe.error?.message ?? maybe.message ?? 'Failed to add to cart');
        },
      });
  }

  back(): void {
    if (history.length > 1) {
      history.back();
    } else {
      void this.router.navigate(['/menu']);
    }
  }

  selectVariation(type: VariationType, id: string): void {
    this.selectedVariations.update((s) => ({ ...s, [type]: id }));
  }

  isSelected(type: VariationType, id: string): boolean {
    return this.selectedVariations()[type] === id;
  }

  modifierCount(id: string): number {
    return this.modifierCounts()[id] ?? 0;
  }

  incModifier(m: Modifier): void {
    this.modifierCounts.update((state) => {
      const current = state[m.id] ?? 0;
      if (current >= m.maxCount) return state;
      return { ...state, [m.id]: current + 1 };
    });
  }

  decModifier(m: Modifier): void {
    this.modifierCounts.update((state) => {
      const current = state[m.id] ?? 0;
      if (current <= m.minCount) return state;
      return { ...state, [m.id]: current - 1 };
    });
  }

  incQty(): void {
    this.quantity.update((q) => Math.min(q + 1, 20));
  }

  decQty(): void {
    this.quantity.update((q) => Math.max(q - 1, 1));
  }

  price(cents: number): string {
    return new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(cents / 100);
  }

  priceDelta(cents: number): string {
    return this.price(cents);
  }

  variationLabel(type: VariationType): string {
    return VARIATION_LABELS[type];
  }

  heroImageBg(p: ProductDetail): string {
    const url = p.imageUrls?.[0];
    if (url) return `url('${url}')`;
    return 'linear-gradient(135deg, var(--color-latte) 0%, var(--color-cream) 100%)';
  }

  private initializeDefaults(p: ProductDetail): void {
    const defaults: Partial<Record<VariationType, string>> = {};
    for (const v of p.variations) {
      if (v.isDefault && !defaults[v.type]) defaults[v.type] = v.id;
    }
    for (const type of VARIATION_GROUPS) {
      if (!defaults[type]) {
        const first = p.variations.find((v: Variation) => v.type === type);
        if (first) defaults[type] = first.id;
      }
    }
    this.selectedVariations.set(defaults);

    const counts: Record<string, number> = {};
    for (const m of p.modifiers) {
      counts[m.id] = m.minCount;
    }
    this.modifierCounts.set(counts);
  }
}
