import { LowerCasePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { ProductDetail, VariationType } from '@takeaway/shared-types';

import { CatalogService } from '../../core/catalog/catalog.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';

const VARIATION_GROUPS: VariationType[] = ['SIZE', 'TEMPERATURE', 'MILK', 'CUP'];

@Component({
  selector: 'app-tma-product',
  standalone: true,
  imports: [LowerCasePipe],
  template: `
    <section class="px-4 pt-6 pb-32">
      @if (product(); as p) {
        <h1 class="text-2xl mb-2" style="font-family: var(--font-display)">{{ p.name }}</h1>
        @if (p.description) {
          <p class="text-sm mb-4" style="opacity: 0.7">{{ p.description }}</p>
        }

        <div class="flex items-center gap-4 mb-6 text-xs" style="opacity: 0.6">
          <span>⌛ {{ minutes(p.prepTimeSeconds) }} min</span>
          @if (p.calories !== null) {
            <span>{{ p.calories }} kcal</span>
          }
        </div>

        @for (group of variationGroups(); track group.type) {
          @if (group.variations.length > 0) {
            <fieldset class="mb-5">
              <legend class="text-xs uppercase tracking-wider mb-2" style="opacity: 0.5">
                {{ group.type | lowercase }}
              </legend>
              <div class="flex flex-wrap gap-2">
                @for (v of group.variations; track v.id) {
                  <button
                    type="button"
                    (click)="selectVariation(group.type, v.id)"
                    class="px-3 py-1.5 border text-sm"
                    [style.background]="isSelected(group.type, v.id) ? 'var(--color-espresso)' : 'transparent'"
                    [style.color]="isSelected(group.type, v.id) ? 'white' : 'var(--color-espresso)'"
                    style="border-color: var(--color-espresso); border-radius: var(--radius-pill)"
                  >
                    {{ v.name }}
                  </button>
                }
              </div>
            </fieldset>
          }
        }

        @if (p.modifiers.length > 0) {
          <fieldset class="mb-6">
            <legend class="text-xs uppercase tracking-wider mb-2" style="opacity: 0.5">Add-ons</legend>
            <ul class="flex flex-col gap-2">
              @for (m of p.modifiers; track m.id) {
                <li
                  class="flex items-center justify-between p-3"
                  style="background: var(--color-cream); border-radius: var(--radius-input)"
                >
                  <span>{{ m.name }}</span>
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      (click)="decModifier(m.id, m.minCount)"
                      [disabled]="modifierCount(m.id) <= m.minCount"
                      class="w-7 h-7 disabled:opacity-30"
                      style="background: var(--color-latte); border-radius: var(--radius-pill)"
                    >
                      −
                    </button>
                    <span class="w-5 text-center text-sm">{{ modifierCount(m.id) }}</span>
                    <button
                      type="button"
                      (click)="incModifier(m.id, m.maxCount)"
                      [disabled]="modifierCount(m.id) >= m.maxCount"
                      class="w-7 h-7 disabled:opacity-30"
                      style="background: var(--color-latte); border-radius: var(--radius-pill)"
                    >
                      +
                    </button>
                  </div>
                </li>
              }
            </ul>
          </fieldset>
        }

        <p class="text-xs text-center" style="opacity: 0.5">Checkout and payment via Telegram Pay arrive with M2.</p>
      }
    </section>
  `,
})
export class TmaProductPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly catalog = inject(CatalogService);
  private readonly tg = inject(TelegramBridgeService);

  readonly product = signal<ProductDetail | null>(null);
  readonly selectedVariations = signal<Partial<Record<VariationType, string>>>({});
  readonly modifierCounts = signal<Record<string, number>>({});
  private detachBack: (() => void) | null = null;

  readonly variationGroups = computed(() => {
    const p = this.product();
    if (!p) return [];
    return VARIATION_GROUPS.map((type) => ({
      type,
      variations: p.variations.filter((v) => v.type === type),
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
    this.catalog.getProduct(slug).subscribe({
      next: (p) => {
        this.product.set(p);
        this.initializeDefaults(p);
        this.tg.setMainButton(`Add · ${this.price(this.totalCents())}`, () => {
          this.tg.haptic('medium');
          alert('Cart and checkout land with M2.');
        });
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

  incModifier(id: string, max: number): void {
    this.modifierCounts.update((state) => {
      const current = state[id] ?? 0;
      if (current >= max) return state;
      return { ...state, [id]: current + 1 };
    });
    this.tg.haptic('light');
    this.refreshMainButton();
  }

  decModifier(id: string, min: number): void {
    this.modifierCounts.update((state) => {
      const current = state[id] ?? 0;
      if (current <= min) return state;
      return { ...state, [id]: current - 1 };
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

  private initializeDefaults(p: ProductDetail): void {
    const defaults: Partial<Record<VariationType, string>> = {};
    for (const v of p.variations) if (v.isDefault && !defaults[v.type]) defaults[v.type] = v.id;
    for (const type of VARIATION_GROUPS) {
      if (!defaults[type]) {
        const first = p.variations.find((v) => v.type === type);
        if (first) defaults[type] = first.id;
      }
    }
    this.selectedVariations.set(defaults);

    const counts: Record<string, number> = {};
    for (const m of p.modifiers) counts[m.id] = m.minCount;
    this.modifierCounts.set(counts);
  }

  private refreshMainButton(): void {
    this.tg.setMainButton(`Add · ${this.price(this.totalCents())}`, () => {
      this.tg.haptic('medium');
      alert('Cart and checkout land with M2.');
    });
  }
}
