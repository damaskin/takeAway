import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import { MODIFIER_GROUP_MAX_LENGTH } from '@takeaway/shared-types';
import type { Observable } from 'rxjs';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type IngredientDto } from '../../core/catalog/admin-catalog.service';
import { describeMenuError } from '../menu/menu-errors';
import { MENU_FORM_STYLES } from '../menu/menu-form.styles';
import { formatMoneyInput, moneyValidator, parseMoney } from '../menu/menu-input';

type Filter = 'all' | 'out' | 'unused';

/**
 * The brand's add-ons library («Добавки»): oat milk, syrups, an extra shot.
 * It is the one place an add-on is defined — its name, its usual price and
 * one in-stock switch. A product offers an add-on by picking it in «Меню →
 * Опции»; taking it off a product leaves it here, deleting it here takes it
 * off every product. Switching it off hides those options in the site, the
 * Telegram app and the mobile app while the products stay on the menu.
 *
 * Each add-on can carry the group an extra made of it starts in on a
 * product («Ваниль» → «Сиропы»); the customer apps show add-ons by group.
 *
 * The add and edit forms are bound to form groups: the plain
 * `<form (ngSubmit)>` they used to be never fired without one, so "Add"
 * reloaded the page and nothing was ever added here.
 */
@Component({
  selector: 'app-ingredients',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe],
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
      .price {
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--color-text-secondary);
        white-space: nowrap;
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
      .price-field {
        flex: 0 1 140px;
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
        <a routerLink="/menu" class="link">{{ 'admin.ingredients.menuLink' | translate }}</a>
      </p>

      <form
        [formGroup]="addForm"
        (ngSubmit)="add()"
        class="flex items-end flex-wrap"
        style="gap: 8px 12px; padding: 14px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 14px"
        data-testid="ingredient-add"
      >
        <label class="field" style="flex: 1 1 220px">
          <span class="label">{{ 'admin.ingredients.newLabel' | translate }}</span>
          <input
            class="control"
            formControlName="name"
            maxlength="80"
            enterkeyhint="done"
            [placeholder]="'admin.ingredients.newPlaceholder' | translate"
          />
        </label>
        <label class="field price-field">
          <span class="label">{{ 'admin.ingredients.price' | translate: { currency: currencyLabel() } }}</span>
          <input class="control" formControlName="price" inputmode="decimal" autocomplete="off" placeholder="0" />
        </label>
        <label class="field" style="flex: 0 1 180px" [title]="'admin.ingredients.groupHint' | translate">
          <span class="label">{{ 'admin.ingredients.group' | translate }}</span>
          <input
            class="control"
            formControlName="group"
            list="ingredient-groups"
            [attr.maxlength]="groupMaxLength"
            [placeholder]="'admin.ingredients.groupPlaceholder' | translate"
            data-testid="ingredient-group"
          />
        </label>
        <button type="submit" class="primary disabled:opacity-50" [disabled]="busy() || !brand()">
          {{ 'admin.ingredients.add' | translate }}
        </button>
        @if (addSubmitted() && formError(addForm); as key) {
          <span class="error" style="flex-basis: 100%">{{ key | translate }}</span>
        }
      </form>

      <div class="flex items-center flex-wrap" style="gap: 8px">
        <button type="button" class="tab" [class.active]="filter() === 'all'" (click)="filter.set('all')">
          {{ 'admin.ingredients.filterAll' | translate: { count: items().length } }}
        </button>
        <button type="button" class="tab" [class.active]="filter() === 'out'" (click)="filter.set('out')">
          {{ 'admin.ingredients.filterOut' | translate: { count: outCount() } }}
        </button>
        <button
          type="button"
          class="tab"
          [class.active]="filter() === 'unused'"
          (click)="filter.set('unused')"
          data-testid="ingredient-filter-unused"
        >
          {{ 'admin.ingredients.filterUnused' | translate: { count: unusedCount() } }}
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

      <datalist id="ingredient-groups">
        @for (g of groups(); track g) {
          <option [value]="g"></option>
        }
      </datalist>

      <div class="flex flex-col" style="gap: 8px">
        @for (item of shown(); track item.id) {
          <div class="row" [class.out]="!item.isAvailable" data-testid="ingredient-row">
            @if (editingId() === item.id) {
              <form
                [formGroup]="editForm"
                (ngSubmit)="saveEdit(item)"
                class="flex flex-col"
                style="gap: 6px; flex: 1 1 320px; min-width: 0"
                data-testid="ingredient-edit"
              >
                <div class="flex items-end flex-wrap" style="gap: 8px">
                  <label class="field" style="flex: 1 1 160px">
                    <span class="label">{{ 'admin.ingredients.name' | translate }}</span>
                    <input class="control small" formControlName="name" maxlength="80" enterkeyhint="done" />
                  </label>
                  <label class="field price-field">
                    <span class="label">{{
                      'admin.ingredients.price' | translate: { currency: currencyLabel() }
                    }}</span>
                    <input class="control small" formControlName="price" inputmode="decimal" autocomplete="off" />
                  </label>
                  <label class="field" style="flex: 0 1 160px">
                    <span class="label">{{ 'admin.ingredients.group' | translate }}</span>
                    <input
                      class="control small"
                      formControlName="group"
                      list="ingredient-groups"
                      [attr.maxlength]="groupMaxLength"
                      [placeholder]="'admin.menu.options.defaultGroup' | translate"
                    />
                  </label>
                  <button type="submit" class="primary small" [disabled]="busy()">
                    {{ 'common.save' | translate }}
                  </button>
                  <button type="button" class="link muted" (click)="editingId.set(null)">
                    {{ 'common.cancel' | translate }}
                  </button>
                </div>
                @if (editSubmitted() && formError(editForm); as key) {
                  <span class="error">{{ key | translate }}</span>
                } @else if (item.products.length > 0) {
                  <span class="hint">{{ 'admin.ingredients.editHint' | translate }}</span>
                }
              </form>
            } @else {
              <div class="flex flex-col" style="gap: 2px; flex: 1 1 220px; min-width: 0">
                <span class="flex items-baseline flex-wrap" style="gap: 4px 10px">
                  <span class="name">{{ item.name }}</span>
                  <span class="price" data-testid="ingredient-price">{{ formatPrice(item.priceCents) }}</span>
                  @if (item.group) {
                    <span class="price" data-testid="ingredient-group-label">{{ item.group }}</span>
                  }
                </span>
                <span class="hint" data-testid="ingredient-usage">
                  @if (item.products.length > 0) {
                    {{
                      'admin.ingredients.usedIn'
                        | translate: { count: item.products.length, products: productNames(item) }
                    }}
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
                <button type="button" class="link" [disabled]="busy()" (click)="startEdit(item)">
                  {{ 'admin.ingredients.edit' | translate }}
                </button>
                <button
                  type="button"
                  class="link danger"
                  [disabled]="busy()"
                  (click)="remove(item)"
                  data-testid="ingredient-delete"
                >
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
  private readonly fmt = inject(LocaleFormatService);

  readonly brand = this.activeBrand.active;
  readonly currencyLabel = computed(() => this.brand()?.currency ?? '—');
  readonly items = signal<IngredientDto[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly filter = signal<Filter>('all');
  readonly query = signal('');
  readonly editingId = signal<string | null>(null);
  readonly addSubmitted = signal(false);
  readonly editSubmitted = signal(false);

  readonly groupMaxLength = MODIFIER_GROUP_MAX_LENGTH;
  readonly addForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(80)] }),
    price: new FormControl('', { nonNullable: true, validators: [moneyValidator()] }),
    group: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(MODIFIER_GROUP_MAX_LENGTH)] }),
  });
  readonly editForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(80)] }),
    price: new FormControl('', { nonNullable: true, validators: [moneyValidator()] }),
    group: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(MODIFIER_GROUP_MAX_LENGTH)] }),
  });

  /** The groups the library already uses, for suggestions. */
  readonly groups = computed(() => {
    const seen = new Map<string, string>();
    for (const item of this.items()) {
      if (item.group && !seen.has(item.group.toLocaleLowerCase())) seen.set(item.group.toLocaleLowerCase(), item.group);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  });

  readonly outCount = computed(() => this.items().filter((i) => !i.isAvailable).length);
  readonly unusedCount = computed(() => this.items().filter((i) => i.products.length === 0).length);
  readonly shown = computed(() => {
    const q = this.query().trim().toLocaleLowerCase();
    const filter = this.filter();
    return this.items().filter(
      (i) =>
        (filter === 'all' || (filter === 'out' ? !i.isAvailable : i.products.length === 0)) &&
        (!q || i.name.toLocaleLowerCase().includes(q)),
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

  formatPrice(cents: number): string {
    if (cents === 0) return this.translate.instant('admin.menu.options.noSurcharge');
    return `+${this.fmt.money(cents, this.brand()?.currency ?? null)}`;
  }

  /** The translation key for what is wrong with a name-and-price form, if anything. */
  formError(form: FormGroup): string | null {
    if (form.get('name')?.invalid) return 'admin.menu.errors.name';
    if (form.get('price')?.invalid) return 'admin.menu.errors.surcharge';
    return null;
  }

  add(): void {
    this.addSubmitted.set(true);
    const brand = this.brand();
    const { name, price, group } = this.addForm.getRawValue();
    const priceCents = price.trim() ? parseMoney(price) : 0;
    if (!brand || this.addForm.invalid || !name.trim() || priceCents === null) return;
    const input = {
      brandId: brand.id,
      name: name.trim(),
      priceCents,
      ...(group.trim() ? { group: group.trim() } : {}),
    };
    this.run(this.api.createIngredient(input), (created) => {
      this.addSubmitted.set(false);
      // Keep the group: several syrups are usually added in a row.
      this.addForm.reset({ name: '', price: '', group });
      this.items.update((list) => sortByName([...list, created]));
    });
  }

  /** "Ran out" / "back in": the options hide or return in every client at once. */
  toggle(item: IngredientDto): void {
    this.run(this.api.updateIngredient(item.id, { isAvailable: !item.isAvailable }), (updated) =>
      this.replace(updated),
    );
  }

  startEdit(item: IngredientDto): void {
    this.editSubmitted.set(false);
    this.editingId.set(item.id);
    this.editForm.reset({
      name: item.name,
      price: formatMoneyInput(item.priceCents, this.separator()),
      group: item.group ?? '',
    });
  }

  /** Only what changed is sent: the server carries a new name, price or group to the products. */
  saveEdit(item: IngredientDto): void {
    this.editSubmitted.set(true);
    const { name, price, group } = this.editForm.getRawValue();
    const priceCents = price.trim() ? parseMoney(price) : 0;
    if (this.editForm.invalid || !name.trim() || priceCents === null) return;
    const change: { name?: string; priceCents?: number; group?: string | null } = {};
    if (name.trim() !== item.name) change.name = name.trim();
    if (priceCents !== item.priceCents) change.priceCents = priceCents;
    if ((group.trim() || null) !== (item.group ?? null)) change.group = group.trim() || null;
    if (Object.keys(change).length === 0) {
      this.editingId.set(null);
      return;
    }
    this.run(this.api.updateIngredient(item.id, change), (updated) => {
      this.editingId.set(null);
      this.items.update((list) => sortByName(list.map((i) => (i.id === updated.id ? updated : i))));
    });
  }

  /** Deleting here takes the add-on off every product, so the question names them. */
  remove(item: IngredientDto): void {
    const used = item.products.length > 0;
    const message = this.translate.instant(
      used ? 'admin.ingredients.deleteUsedConfirm' : 'admin.ingredients.deleteConfirm',
      { name: item.name, count: item.products.length, products: this.productNames(item) },
    );
    if (!confirm(message)) return;
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
        this.items.set(sortByName(list.map(withDefaults)));
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(describeMenuError(err, this.translate));
      },
    });
  }

  private separator(): string {
    return this.translate.getCurrentLang() === 'en' ? '.' : ',';
  }
}

/** An older API answer has no price: show it as free rather than "NaN". */
function withDefaults(item: IngredientDto): IngredientDto {
  return { ...item, priceCents: item.priceCents ?? 0, products: item.products ?? [] };
}

function sortByName(list: IngredientDto[]): IngredientDto[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}
