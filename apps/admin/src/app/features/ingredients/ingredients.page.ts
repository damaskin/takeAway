import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { Observable } from 'rxjs';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type IngredientDto } from '../../core/catalog/admin-catalog.service';
import { describeMenuError } from '../menu/menu-errors';
import { MENU_FORM_STYLES } from '../menu/menu-form.styles';

type Filter = 'all' | 'out';

/**
 * The brand's add-ins library: oat milk, syrups, an extra shot — each with
 * one in-stock switch. Options of any number of products point at an entry;
 * switching it off hides those options in the site, the Telegram app and
 * the mobile app while the products stay on the menu, and switching it back
 * on returns them as they were. Options join the library by name when they
 * are added to a product; here the list is looked after.
 */
@Component({
  selector: 'app-ingredients',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe],
  styles: [
    MENU_FORM_STYLES,
    `
      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 14px;
        padding: 12px 14px;
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: 12px;
      }
      .row.out {
        border-left: 4px solid var(--color-berry);
      }
      .name {
        font-family: var(--font-sans);
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
        overflow-wrap: anywhere;
      }
      .switch {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        height: 32px;
        padding: 0 12px;
        border-radius: 9999px;
        font-family: var(--font-sans);
        font-size: 12px;
        font-weight: 600;
        border: 1px solid transparent;
      }
      .switch.on {
        background: #7bc4a42e;
        color: #2f7d5b;
      }
      .switch.off {
        background: #d94b5e1a;
        color: var(--color-berry);
      }
      .switch:disabled {
        opacity: 0.5;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 9999px;
        background: currentColor;
      }
      .tab {
        height: 32px;
        padding: 0 12px;
        border-radius: 9999px;
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 500;
        color: var(--color-text-secondary);
        background: transparent;
        border: 1px solid var(--color-border-light);
      }
      .tab.active {
        background: var(--color-caramel-light);
        color: var(--color-caramel);
        border-color: transparent;
      }
    `,
  ],
  template: `
    <div
      class="flex items-center flex-wrap"
      style="min-height: 64px; padding: 12px clamp(12px, 3vw, 24px); background: var(--color-foam); border-bottom: 1px solid var(--color-border-light); gap: 12px 16px"
    >
      <h1
        style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        {{ 'admin.ingredients.title' | translate }}
      </h1>
      @if (brand()) {
        <span
          class="flex items-center"
          style="height: 26px; padding: 0 10px; background: var(--color-caramel-light); color: var(--color-caramel); border-radius: 9999px; font-family: var(--font-sans); font-size: 12px; font-weight: 600"
          >{{ brand()?.name }}</span
        >
      }
    </div>

    <section
      class="flex flex-col"
      style="padding: clamp(16px, 3vw, 24px); gap: 16px; max-width: 880px"
      data-testid="ingredients"
    >
      <p class="hint" style="margin: 0; font-size: 13px; color: var(--color-text-secondary)">
        {{ 'admin.ingredients.hint' | translate }}
      </p>

      <form
        (ngSubmit)="add()"
        class="flex items-end flex-wrap"
        style="gap: 8px 12px; padding: 14px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 14px"
      >
        <label class="field" style="flex: 1 1 220px">
          <span class="label">{{ 'admin.ingredients.newLabel' | translate }}</span>
          <input
            class="control"
            [formControl]="newName"
            maxlength="80"
            enterkeyhint="done"
            [placeholder]="'admin.ingredients.newPlaceholder' | translate"
          />
        </label>
        <button type="submit" class="primary disabled:opacity-50" [disabled]="busy() || !brand()">
          {{ 'admin.ingredients.add' | translate }}
        </button>
      </form>

      <div class="flex items-center flex-wrap" style="gap: 8px">
        <button type="button" class="tab" [class.active]="filter() === 'all'" (click)="filter.set('all')">
          {{ 'admin.ingredients.filterAll' | translate: { count: items().length } }}
        </button>
        <button type="button" class="tab" [class.active]="filter() === 'out'" (click)="filter.set('out')">
          {{ 'admin.ingredients.filterOut' | translate: { count: outCount() } }}
        </button>
        <input
          class="control small"
          style="flex: 1 1 180px; max-width: 280px; margin-left: auto"
          type="search"
          enterkeyhint="search"
          [value]="query()"
          (input)="query.set($any($event.target).value)"
          [placeholder]="'admin.ingredients.search' | translate"
          [attr.aria-label]="'admin.ingredients.search' | translate"
        />
      </div>

      @if (error()) {
        <p role="alert" class="error" style="margin: 0; font-size: 13px">{{ error() }}</p>
      }
      @if (loading() && items().length === 0) {
        <p class="hint" style="margin: 0">{{ 'common.loading' | translate }}</p>
      }

      <div class="flex flex-col" style="gap: 8px">
        @for (item of shown(); track item.id) {
          <div class="row" [class.out]="!item.isAvailable" data-testid="ingredient-row">
            @if (editingId() === item.id) {
              <form (ngSubmit)="saveName(item)" class="flex items-center flex-wrap" style="gap: 8px; flex: 1 1 260px">
                <input
                  class="control small"
                  style="flex: 1 1 160px"
                  [formControl]="editName"
                  maxlength="80"
                  enterkeyhint="done"
                  [attr.aria-label]="'admin.ingredients.rename' | translate"
                />
                <button type="submit" class="primary small" [disabled]="busy()">{{ 'common.save' | translate }}</button>
                <button type="button" class="link muted" (click)="editingId.set(null)">
                  {{ 'common.cancel' | translate }}
                </button>
              </form>
            } @else {
              <div class="flex flex-col" style="gap: 2px; flex: 1 1 220px; min-width: 0">
                <span class="name">{{ item.name }}</span>
                <span class="hint">
                  @if (item.products.length > 0) {
                    {{ 'admin.ingredients.usedIn' | translate: { products: productNames(item) } }}
                  } @else {
                    {{ 'admin.ingredients.unused' | translate }}
                  }
                </span>
              </div>
            }
            <button
              type="button"
              class="switch"
              [class.on]="item.isAvailable"
              [class.off]="!item.isAvailable"
              role="switch"
              [attr.aria-checked]="item.isAvailable"
              [attr.aria-label]="item.name"
              [disabled]="busy()"
              (click)="toggle(item)"
              data-testid="ingredient-toggle"
            >
              <span class="dot"></span>
              {{ (item.isAvailable ? 'admin.ingredients.available' : 'admin.ingredients.unavailable') | translate }}
            </button>
            @if (editingId() !== item.id) {
              <span class="flex items-center" style="gap: 12px">
                <button type="button" class="link" [disabled]="busy()" (click)="startRename(item)">
                  {{ 'admin.ingredients.rename' | translate }}
                </button>
                <button type="button" class="link danger" [disabled]="busy()" (click)="remove(item)">
                  {{ 'admin.menu.options.delete' | translate }}
                </button>
              </span>
            }
          </div>
        } @empty {
          @if (!loading()) {
            <p class="hint" style="margin: 0">
              {{ (items().length === 0 ? 'admin.ingredients.empty' : 'admin.ingredients.nothingFound') | translate }}
            </p>
          }
        }
      </div>
    </section>
  `,
})
export class IngredientsPage {
  private readonly api = inject(AdminCatalogApi);
  private readonly translate = inject(TranslateService);
  private readonly activeBrand = inject(ActiveBrandService);

  readonly brand = this.activeBrand.active;
  readonly items = signal<IngredientDto[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly filter = signal<Filter>('all');
  readonly query = signal('');
  readonly editingId = signal<string | null>(null);

  readonly newName = new FormControl('', { nonNullable: true, validators: [Validators.required] });
  readonly editName = new FormControl('', { nonNullable: true, validators: [Validators.required] });

  readonly outCount = computed(() => this.items().filter((i) => !i.isAvailable).length);
  readonly shown = computed(() => {
    const q = this.query().trim().toLocaleLowerCase();
    return this.items().filter(
      (i) => (this.filter() === 'all' || !i.isAvailable) && (!q || i.name.toLocaleLowerCase().includes(q)),
    );
  });

  constructor() {
    effect(() => {
      const brand = this.brand();
      untracked(() => {
        this.items.set([]);
        this.editingId.set(null);
        if (brand) this.load(brand.id);
      });
    });
  }

  productNames(item: IngredientDto): string {
    const names = item.products.map((p) => p.name);
    return names.length > 3
      ? `${names.slice(0, 3).join(', ')} ${this.translate.instant('admin.ingredients.andMore', { count: names.length - 3 })}`
      : names.join(', ');
  }

  add(): void {
    const brand = this.brand();
    const name = this.newName.value.trim();
    if (!brand || !name) return;
    this.run(this.api.createIngredient({ brandId: brand.id, name }), (created) => {
      this.newName.reset('');
      this.items.update((list) => sortByName([...list, created]));
    });
  }

  /** "Ran out" / "back in": the options hide or return in every client at once. */
  toggle(item: IngredientDto): void {
    this.run(this.api.updateIngredient(item.id, { isAvailable: !item.isAvailable }), (updated) =>
      this.replace(updated),
    );
  }

  startRename(item: IngredientDto): void {
    this.editingId.set(item.id);
    this.editName.reset(item.name);
  }

  saveName(item: IngredientDto): void {
    const name = this.editName.value.trim();
    if (!name || name === item.name) {
      this.editingId.set(null);
      return;
    }
    this.run(this.api.updateIngredient(item.id, { name }), (updated) => {
      this.editingId.set(null);
      this.items.update((list) => sortByName(list.map((i) => (i.id === updated.id ? updated : i))));
    });
  }

  remove(item: IngredientDto): void {
    const key = item.products.length > 0 ? 'admin.ingredients.deleteUsedConfirm' : 'admin.ingredients.deleteConfirm';
    if (!confirm(this.translate.instant(key, { name: item.name, count: item.products.length }))) return;
    this.run(this.api.deleteIngredient(item.id), () =>
      this.items.update((list) => list.filter((i) => i.id !== item.id)),
    );
  }

  private replace(updated: IngredientDto): void {
    this.items.update((list) => list.map((i) => (i.id === updated.id ? updated : i)));
  }

  private run<T>(request: Observable<T>, onSuccess: (value: T) => void): void {
    this.busy.set(true);
    this.error.set(null);
    request.subscribe({
      next: (value) => {
        this.busy.set(false);
        onSuccess(value);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(describeMenuError(err, this.translate));
      },
    });
  }

  private load(brandId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.listIngredients(brandId).subscribe({
      next: (list) => {
        this.loading.set(false);
        this.items.set(sortByName(list));
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(describeMenuError(err, this.translate));
      },
    });
  }
}

function sortByName(list: IngredientDto[]): IngredientDto[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}
