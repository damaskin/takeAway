import { Component, Input, OnChanges, SimpleChanges, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import {
  AdminCatalogApi,
  type ModifierAdminDto,
  type ProductDetailDto,
  type VariationAdminDto,
} from '../../core/catalog/admin-catalog.service';

const VARIATION_TYPES = ['SIZE', 'TEMPERATURE', 'MILK', 'CUP'] as const;

/**
 * Inline options editor for a single product. Loads variations and
 * modifiers via `GET /admin/products/:id`, lets the brand admin add /
 * delete each. Editing existing rows uses inline name/price changes
 * with debounce-on-blur to keep the surface small.
 */
@Component({
  selector: 'app-product-options-panel',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe],
  template: `
    <div
      style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px; background: var(--color-cream); border-radius: 14px; margin-top: 8px"
    >
      <!-- Variations -->
      <section style="display: flex; flex-direction: column; gap: 10px">
        <h3
          style="font-family: var(--font-sans); font-size: 13px; font-weight: 700; color: var(--color-espresso); margin: 0"
        >
          {{ 'admin.menu.options.variations' | translate }}
        </h3>
        @if (loading()) {
          <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">
            {{ 'common.loading' | translate }}
          </p>
        }
        @for (v of variations(); track v.id) {
          <div
            class="flex items-center"
            style="gap: 8px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 10px; padding: 8px 10px"
          >
            <span
              style="display: inline-block; padding: 2px 8px; border-radius: 999px; background: var(--color-caramel-light); color: var(--color-caramel); font-family: var(--font-sans); font-size: 10px; font-weight: 700"
              >{{ v.type }}</span
            >
            <span style="flex: 1; font-family: var(--font-sans); font-size: 13px; font-weight: 500">{{ v.name }}</span>
            <span style="font-family: var(--font-mono); font-size: 12px; color: var(--color-text-secondary)">
              {{ v.priceDeltaCents >= 0 ? '+' : '' }}{{ formatDelta(v.priceDeltaCents) }}
            </span>
            @if (v.isDefault) {
              <span
                style="font-family: var(--font-sans); font-size: 10px; color: var(--color-mint); font-weight: 600; text-transform: uppercase"
                >{{ 'admin.menu.options.default' | translate }}</span
              >
            }
            <button
              type="button"
              (click)="deleteVariation(v)"
              [title]="'common.cancel' | translate"
              style="color: var(--color-berry); padding: 0 6px"
            >
              ×
            </button>
          </div>
        } @empty {
          @if (!loading()) {
            <p style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); margin: 0">
              {{ 'admin.menu.options.noVariations' | translate }}
            </p>
          }
        }
        <form
          [formGroup]="variationForm"
          (ngSubmit)="addVariation()"
          style="display: grid; grid-template-columns: 100px 1fr 80px auto; gap: 6px; align-items: end"
        >
          <select
            formControlName="type"
            style="height: 32px; padding: 0 8px; border: 1px solid var(--color-border); border-radius: 6px; font-size: 12px"
          >
            @for (t of variationTypes; track t) {
              <option [value]="t">{{ t }}</option>
            }
          </select>
          <input
            formControlName="name"
            [placeholder]="'admin.menu.options.namePlaceholder' | translate"
            style="height: 32px; padding: 0 8px; border: 1px solid var(--color-border); border-radius: 6px; font-size: 12px"
          />
          <input
            formControlName="priceDeltaCents"
            type="number"
            placeholder="±¢"
            style="height: 32px; padding: 0 8px; border: 1px solid var(--color-border); border-radius: 6px; font-size: 12px"
          />
          <button
            type="submit"
            [disabled]="variationForm.invalid"
            style="height: 32px; padding: 0 12px; background: var(--color-caramel); color: white; border-radius: 6px; font-size: 12px; font-weight: 600"
          >
            +
          </button>
        </form>
      </section>

      <!-- Modifiers -->
      <section style="display: flex; flex-direction: column; gap: 10px">
        <h3
          style="font-family: var(--font-sans); font-size: 13px; font-weight: 700; color: var(--color-espresso); margin: 0"
        >
          {{ 'admin.menu.options.modifiers' | translate }}
        </h3>
        @for (m of modifiers(); track m.id) {
          <div
            class="flex items-center"
            style="gap: 8px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 10px; padding: 8px 10px"
          >
            <span style="flex: 1; font-family: var(--font-sans); font-size: 13px; font-weight: 500">{{ m.name }}</span>
            <span style="font-family: var(--font-mono); font-size: 11px; color: var(--color-text-secondary)"
              >{{ m.minCount }}-{{ m.maxCount }}</span
            >
            <span style="font-family: var(--font-mono); font-size: 12px; color: var(--color-text-secondary)">
              {{ m.priceDeltaCents >= 0 ? '+' : '' }}{{ formatDelta(m.priceDeltaCents) }}
            </span>
            <button type="button" (click)="deleteModifier(m)" style="color: var(--color-berry); padding: 0 6px">
              ×
            </button>
          </div>
        } @empty {
          @if (!loading()) {
            <p style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); margin: 0">
              {{ 'admin.menu.options.noModifiers' | translate }}
            </p>
          }
        }
        <form
          [formGroup]="modifierForm"
          (ngSubmit)="addModifier()"
          style="display: grid; grid-template-columns: 1fr 80px 60px auto; gap: 6px; align-items: end"
        >
          <input
            formControlName="name"
            [placeholder]="'admin.menu.options.modPlaceholder' | translate"
            style="height: 32px; padding: 0 8px; border: 1px solid var(--color-border); border-radius: 6px; font-size: 12px"
          />
          <input
            formControlName="priceDeltaCents"
            type="number"
            placeholder="±¢"
            style="height: 32px; padding: 0 8px; border: 1px solid var(--color-border); border-radius: 6px; font-size: 12px"
          />
          <input
            formControlName="maxCount"
            type="number"
            min="1"
            placeholder="max"
            style="height: 32px; padding: 0 8px; border: 1px solid var(--color-border); border-radius: 6px; font-size: 12px"
          />
          <button
            type="submit"
            [disabled]="modifierForm.invalid"
            style="height: 32px; padding: 0 12px; background: var(--color-caramel); color: white; border-radius: 6px; font-size: 12px; font-weight: 600"
          >
            +
          </button>
        </form>
      </section>

      @if (error()) {
        <p
          style="grid-column: 1 / -1; font-family: var(--font-sans); font-size: 12px; color: var(--color-berry); margin: 0"
        >
          {{ error() }}
        </p>
      }
    </div>
  `,
})
export class ProductOptionsPanelComponent implements OnChanges {
  @Input({ required: true }) productId!: string;

  private readonly api = inject(AdminCatalogApi);
  private readonly translate = inject(TranslateService);

  readonly variationTypes = VARIATION_TYPES;
  readonly variations = signal<VariationAdminDto[]>([]);
  readonly modifiers = signal<ModifierAdminDto[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly variationForm = new FormGroup({
    type: new FormControl<(typeof VARIATION_TYPES)[number]>('SIZE', { nonNullable: true }),
    name: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(1)],
    }),
    priceDeltaCents: new FormControl<number | null>(0),
  });

  readonly modifierForm = new FormGroup({
    name: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(1)],
    }),
    priceDeltaCents: new FormControl<number | null>(0),
    maxCount: new FormControl<number | null>(1, { validators: [Validators.min(1)] }),
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['productId']) this.refresh();
  }

  refresh(): void {
    if (!this.productId) return;
    this.loading.set(true);
    this.error.set(null);
    this.api.getProduct(this.productId).subscribe({
      next: (p: ProductDetailDto) => {
        this.loading.set(false);
        this.variations.set(p.variations ?? []);
        this.modifiers.set(p.modifiers ?? []);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(extractMessage(err) ?? this.translate.instant('common.genericError'));
      },
    });
  }

  addVariation(): void {
    const v = this.variationForm.getRawValue();
    if (!v.name) return;
    this.api
      .createVariation(this.productId, {
        type: v.type,
        name: v.name,
        priceDeltaCents: Number(v.priceDeltaCents ?? 0),
      })
      .subscribe({
        next: (created) => {
          this.variations.update((list) => [...list, created]);
          this.variationForm.reset({ type: 'SIZE', name: '', priceDeltaCents: 0 });
        },
        error: (err) => this.error.set(extractMessage(err)),
      });
  }

  deleteVariation(v: VariationAdminDto): void {
    this.api.deleteVariation(v.id).subscribe({
      next: () => this.variations.update((list) => list.filter((x) => x.id !== v.id)),
      error: (err) => this.error.set(extractMessage(err)),
    });
  }

  addModifier(): void {
    const v = this.modifierForm.getRawValue();
    if (!v.name) return;
    const slug = slugify(v.name);
    this.api
      .createModifier(this.productId, {
        slug,
        name: v.name,
        priceDeltaCents: Number(v.priceDeltaCents ?? 0),
        maxCount: Number(v.maxCount ?? 1),
      })
      .subscribe({
        next: (created) => {
          this.modifiers.update((list) => [...list, created]);
          this.modifierForm.reset({ name: '', priceDeltaCents: 0, maxCount: 1 });
        },
        error: (err) => this.error.set(extractMessage(err)),
      });
  }

  deleteModifier(m: ModifierAdminDto): void {
    this.api.deleteModifier(m.id).subscribe({
      next: () => this.modifiers.update((list) => list.filter((x) => x.id !== m.id)),
      error: (err) => this.error.set(extractMessage(err)),
    });
  }

  formatDelta(cents: number): string {
    return `${(cents / 100).toFixed(2)}`;
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function extractMessage(err: unknown): string | null {
  const maybe = err as { error?: { message?: unknown }; message?: unknown };
  if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
  if (typeof maybe.message === 'string') return maybe.message;
  return null;
}
