import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { Modifier, ProductDetail, Variation, VariationType } from '@takeaway/shared-types';

import { TmaAuthStore } from '../../core/auth/tma-auth.store';
import { CartService } from '../../core/cart/cart.service';
import { CatalogService } from '../../core/catalog/catalog.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';

const VARIATION_GROUPS: VariationType[] = ['SIZE', 'TEMPERATURE', 'MILK', 'CUP'];

const VARIATION_LABELS: Record<VariationType, string> = {
  SIZE: 'Size',
  TEMPERATURE: 'Temperature',
  MILK: 'Milk',
  CUP: 'Cup',
};

/**
 * TMA Product Detail — pencil XJUmz.
 *
 * tcContent (0/16/16/16 padding, gap 20):
 *   hero — 220px image (16px radius)
 *   infoRow — title (Fraunces 20/700) · base price (Inter 18/700 caramel)
 *   description
 *   sizeSection / milkSection / extrasSection — pill-button rows
 * MainButton (Telegram blue, 48px) handles add-to-cart action.
 */
@Component({
  selector: 'app-tma-product',
  standalone: true,
  template: `
    <section style="padding: 0 16px 120px 16px; display: flex; flex-direction: column; gap: 20px">
      @if (product(); as p) {
        <!-- Hero image -->
        <div
          [style.background]="heroBg(p)"
          style="height: 220px; margin: 16px -16px 0 -16px; border-radius: 0 0 24px 24px; background-size: cover; background-position: center"
        ></div>

        <!-- Title row -->
        <div class="flex items-start justify-between" style="gap: 12px">
          <div class="flex flex-col flex-1" style="gap: 4px">
            <span
              style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso)"
              >{{ p.name }}</span
            >
            <div class="flex items-center" style="gap: 12px">
              @if (p.calories !== null) {
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)"
                  >🔥 {{ p.calories }} kcal</span
                >
              }
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)"
                >⌛ {{ minutes(p.prepTimeSeconds) }} min</span
              >
            </div>
          </div>
          <span style="font-family: var(--font-sans); font-size: 20px; font-weight: 700; color: var(--color-caramel)">{{
            price(totalCents())
          }}</span>
        </div>

        @if (p.description) {
          <p
            style="font-family: var(--font-sans); font-size: 14px; line-height: 1.6; color: var(--color-text-secondary); margin: 0"
          >
            {{ p.description }}
          </p>
        }

        <!-- Variation sections -->
        @for (group of variationGroups(); track group.type) {
          <div class="flex flex-col" style="gap: 10px">
            <span
              style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-primary)"
              >{{ variationLabel(group.type) }}</span
            >
            <div class="flex flex-wrap" style="gap: 8px">
              @for (v of group.variations; track v.id) {
                <button
                  type="button"
                  (click)="selectVariation(group.type, v.id)"
                  [style.background]="isSelected(group.type, v.id) ? 'var(--color-caramel)' : 'var(--color-foam)'"
                  [style.color]="isSelected(group.type, v.id) ? 'white' : 'var(--color-text-primary)'"
                  [style.border]="
                    isSelected(group.type, v.id) ? '1px solid transparent' : '1px solid var(--color-border-light)'
                  "
                  style="height: 38px; padding: 0 16px; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 500"
                >
                  {{ v.name }}
                </button>
              }
            </div>
          </div>
        }

        @if (p.modifiers.length > 0) {
          <div class="flex flex-col" style="gap: 10px">
            <span
              style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-primary)"
              >Add-ons</span
            >
            <div class="flex flex-col" style="gap: 8px">
              @for (m of p.modifiers; track m.id) {
                <div
                  class="flex items-center justify-between"
                  style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-input); padding: 12px 14px; gap: 12px"
                >
                  <div class="flex flex-col" style="gap: 2px">
                    <span style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)">{{
                      m.name
                    }}</span>
                    @if (m.priceDeltaCents > 0) {
                      <span style="font-family: var(--font-sans); font-size: 11px; color: var(--color-text-tertiary)"
                        >+{{ price(m.priceDeltaCents) }}</span
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
                      class="disabled:opacity-30"
                      style="width: 32px; height: 32px; font-size: 16px; color: var(--color-text-primary)"
                    >
                      −
                    </button>
                    <span
                      class="flex items-center justify-center"
                      style="width: 28px; height: 32px; font-family: var(--font-sans); font-size: 13px; font-weight: 600"
                      >{{ modifierCount(m.id) }}</span
                    >
                    <button
                      type="button"
                      (click)="incModifier(m)"
                      [disabled]="modifierCount(m.id) >= m.maxCount"
                      class="disabled:opacity-30"
                      style="width: 32px; height: 32px; font-size: 16px; color: var(--color-text-primary)"
                    >
                      +
                    </button>
                  </div>
                </div>
              }
            </div>
          </div>
        }

        @if (!authStore.isAuthenticated()) {
          <p
            class="text-center"
            style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)"
          >
            Sign in within Telegram to add items to the cart.
          </p>
        }
      }
    </section>
  `,
})
export class TmaProductPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly catalog = inject(CatalogService);
  private readonly cartService = inject(CartService);
  private readonly tg = inject(TelegramBridgeService);
  readonly authStore = inject(TmaAuthStore);

  readonly product = signal<ProductDetail | null>(null);
  readonly selectedVariations = signal<Partial<Record<VariationType, string>>>({});
  readonly modifierCounts = signal<Record<string, number>>({});
  private storeId: string | null = null;
  private detachBack: (() => void) | null = null;

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
    let total = p.basePriceCents;
    const selected = this.selectedVariations();
    for (const v of p.variations) if (selected[v.type] === v.id) total += v.priceDeltaCents;
    const counts = this.modifierCounts();
    for (const m of p.modifiers) total += (counts[m.id] ?? 0) * m.priceDeltaCents;
    return total;
  });

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) return;
    this.catalog.listStores().subscribe({
      next: (list) => {
        const first = list[0];
        if (first) this.storeId = first.id;
      },
    });
    this.catalog.getProduct(slug).subscribe({
      next: (p) => {
        this.product.set(p);
        this.initializeDefaults(p);
        this.refreshMainButton();
      },
    });
    this.detachBack = this.tg.setBackButton(() => {
      if (history.length > 1) history.back();
      else void this.router.navigate(['/']);
    });
  }

  ngOnDestroy(): void {
    this.tg.hideMainButton();
    this.detachBack?.();
  }

  variationLabel(type: VariationType): string {
    return VARIATION_LABELS[type];
  }

  selectVariation(type: VariationType, id: string): void {
    this.selectedVariations.update((s) => ({ ...s, [type]: id }));
    this.tg.haptic('light');
    this.refreshMainButton();
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
    this.tg.haptic('light');
    this.refreshMainButton();
  }

  decModifier(m: Modifier): void {
    this.modifierCounts.update((state) => {
      const current = state[m.id] ?? 0;
      if (current <= m.minCount) return state;
      return { ...state, [m.id]: current - 1 };
    });
    this.tg.haptic('light');
    this.refreshMainButton();
  }

  price(cents: number): string {
    return new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(cents / 100);
  }

  minutes(seconds: number): number {
    return Math.max(1, Math.round(seconds / 60));
  }

  heroBg(p: ProductDetail): string {
    const url = p.imageUrls?.[0];
    if (url) return `url('${url}')`;
    return 'linear-gradient(135deg, var(--color-latte) 0%, var(--color-cream) 100%)';
  }

  private initializeDefaults(p: ProductDetail): void {
    const defaults: Partial<Record<VariationType, string>> = {};
    for (const v of p.variations) if (v.isDefault && !defaults[v.type]) defaults[v.type] = v.id;
    for (const type of VARIATION_GROUPS) {
      if (!defaults[type]) {
        const first = p.variations.find((v: Variation) => v.type === type);
        if (first) defaults[type] = first.id;
      }
    }
    this.selectedVariations.set(defaults);

    const counts: Record<string, number> = {};
    for (const m of p.modifiers) counts[m.id] = m.minCount;
    this.modifierCounts.set(counts);
  }

  private refreshMainButton(): void {
    if (!this.authStore.isAuthenticated()) {
      this.tg.hideMainButton();
      return;
    }
    this.tg.setMainButton(`Add · ${this.price(this.totalCents())}`, () => this.onMainButton());
  }

  private onMainButton(): void {
    const p = this.product();
    if (!p || !this.storeId) return;
    this.tg.haptic('medium');
    this.cartService
      .add({
        storeId: this.storeId,
        productId: p.id,
        quantity: 1,
        variationIds: Object.values(this.selectedVariations()).filter((id): id is string => Boolean(id)),
        modifiers: this.modifierCounts(),
      })
      .subscribe({
        next: () => void this.router.navigate(['/checkout']),
      });
  }
}
