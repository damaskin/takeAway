import { LowerCasePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { Modifier, ProductDetail, Variation, VariationType } from '@takeaway/shared-types';

import { CatalogService } from '../../core/catalog/catalog.service';

const VARIATION_GROUPS: VariationType[] = ['SIZE', 'TEMPERATURE', 'MILK', 'CUP'];

@Component({
  selector: 'app-product',
  standalone: true,
  imports: [LowerCasePipe],
  template: `
    <section class="max-w-3xl mx-auto px-4 py-12">
      <button type="button" (click)="back()" class="text-sm mb-6" style="opacity: 0.6">← Back</button>

      @if (product(); as p) {
        <h1 class="text-4xl mb-2" style="font-family: var(--font-display)">{{ p.name }}</h1>
        @if (p.description) {
          <p class="mb-6" style="opacity: 0.7">{{ p.description }}</p>
        }

        <div class="flex items-center gap-6 mb-8 text-sm" style="opacity: 0.6">
          <span>{{ price(p.basePriceCents) }} base</span>
          <span>⌛ {{ prepMinutes(p.prepTimeSeconds) }} min</span>
          @if (p.caffeineLevel !== null) {
            <span>☕ caffeine {{ p.caffeineLevel }}/4</span>
          }
          @if (p.calories !== null) {
            <span>{{ p.calories }} kcal</span>
          }
        </div>

        @for (group of variationGroups(); track group.type) {
          @if (group.variations.length > 0) {
            <fieldset class="mb-6">
              <legend class="text-sm uppercase tracking-wider mb-2" style="opacity: 0.5">
                {{ group.type | lowercase }}
              </legend>
              <div class="flex flex-wrap gap-2">
                @for (v of group.variations; track v.id) {
                  <button
                    type="button"
                    (click)="selectVariation(group.type, v.id)"
                    class="px-4 py-2 border text-sm"
                    [style.background]="isSelected(group.type, v.id) ? 'var(--color-espresso)' : 'transparent'"
                    [style.color]="isSelected(group.type, v.id) ? 'white' : 'var(--color-espresso)'"
                    style="border-color: var(--color-espresso); border-radius: var(--radius-pill)"
                  >
                    {{ v.name }}
                    @if (v.priceDeltaCents > 0) {
                      <span style="opacity: 0.7"> +{{ priceDelta(v.priceDeltaCents) }} </span>
                    }
                  </button>
                }
              </div>
            </fieldset>
          }
        }

        @if (p.modifiers.length > 0) {
          <fieldset class="mb-6">
            <legend class="text-sm uppercase tracking-wider mb-2" style="opacity: 0.5">Add-ons</legend>
            <ul class="flex flex-col gap-2">
              @for (m of p.modifiers; track m.id) {
                <li
                  class="flex items-center justify-between p-3"
                  style="background: var(--color-cream); border-radius: var(--radius-input)"
                >
                  <div>
                    <span>{{ m.name }}</span>
                    @if (m.priceDeltaCents > 0) {
                      <span class="text-sm ml-2" style="opacity: 0.6"> +{{ priceDelta(m.priceDeltaCents) }} </span>
                    }
                  </div>
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      (click)="decModifier(m)"
                      [disabled]="modifierCount(m.id) <= m.minCount"
                      class="w-8 h-8 flex items-center justify-center disabled:opacity-30"
                      style="background: var(--color-latte); border-radius: var(--radius-pill)"
                    >
                      −
                    </button>
                    <span class="w-6 text-center font-medium">{{ modifierCount(m.id) }}</span>
                    <button
                      type="button"
                      (click)="incModifier(m)"
                      [disabled]="modifierCount(m.id) >= m.maxCount"
                      class="w-8 h-8 flex items-center justify-center disabled:opacity-30"
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

        <div
          class="sticky bottom-4 mt-10 flex items-center justify-between p-4"
          style="background: var(--color-espresso); color: white; border-radius: var(--radius-card)"
        >
          <span class="text-sm" style="opacity: 0.8"> Total · ready in ~{{ estimatedPrepMinutes() }} min </span>
          <span class="text-lg font-medium">{{ price(totalCents()) }}</span>
        </div>
        <p class="mt-3 text-sm text-center" style="opacity: 0.5">Cart, checkout and live ETA arrive with M2.</p>
      }

      @if (error()) {
        <p class="text-sm" style="color: var(--color-berry)">{{ error() }}</p>
      }
    </section>
  `,
})
export class ProductPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly catalog = inject(CatalogService);

  readonly product = signal<ProductDetail | null>(null);
  readonly error = signal<string | null>(null);
  readonly selectedVariations = signal<Partial<Record<VariationType, string>>>({});
  readonly modifierCounts = signal<Record<string, number>>({});

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
    for (const v of p.variations) {
      if (selected[v.type] === v.id) total += v.priceDeltaCents;
    }
    const counts = this.modifierCounts();
    for (const m of p.modifiers) {
      total += (counts[m.id] ?? 0) * m.priceDeltaCents;
    }
    return total;
  });

  readonly estimatedPrepMinutes = computed(() => {
    const p = this.product();
    if (!p) return 0;
    let seconds = p.prepTimeSeconds;
    const selected = this.selectedVariations();
    for (const v of p.variations) {
      if (selected[v.type] === v.id) seconds += v.prepTimeDeltaSeconds;
    }
    const counts = this.modifierCounts();
    for (const m of p.modifiers) {
      seconds += (counts[m.id] ?? 0) * m.prepTimeDeltaSeconds;
    }
    return Math.max(1, Math.round(seconds / 60));
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

  price(cents: number): string {
    return new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(cents / 100);
  }

  priceDelta(cents: number): string {
    return this.price(cents);
  }

  prepMinutes(seconds: number): number {
    return Math.max(1, Math.round(seconds / 60));
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
