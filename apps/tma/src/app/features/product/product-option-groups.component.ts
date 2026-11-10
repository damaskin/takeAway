import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  model,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import type { ProductOptionGroup, ProductOptionItem } from '@takeaway/shared-types';
import { LocaleFormatService } from '@takeaway/i18n';
import {
  freeQty,
  qtyBounds,
  selectBounds,
  setOptionQty,
  toggleOptionPick,
  validateOptionPicks,
  visibleOptionGroups,
  type OptionPicks,
} from '@takeaway/utils';

import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';

/** What keeps a choice out of the cart, as a translation key and the names it lists. */
export interface OptionChoiceProblem {
  key: string;
  names: string;
}

/**
 * Why the choice cannot go in the cart yet, for the hint next to the add
 * button: the groups still waiting for a pick («Выберите: Размер (кофе)»),
 * else picks the store has run out of. Null when it can go in.
 */
export function optionChoiceProblem(
  groups: readonly ProductOptionGroup[],
  picks: OptionPicks,
): OptionChoiceProblem | null {
  const errors = validateOptionPicks(groups, picks);
  if (errors.length === 0) return null;
  const missing = unique(
    errors.filter((e) => e.code === 'TOO_FEW').map((e) => groups.find((g) => g.id === e.groupId)?.name),
  );
  if (missing.length > 0) return { key: 'common.product.choose', names: missing.join(', ') };
  const options = groups.flatMap((g) => g.options);
  const soldOut = unique(
    errors.filter((e) => e.code === 'OPTION_UNAVAILABLE').map((e) => options.find((o) => o.id === e.optionId)?.name),
  );
  if (soldOut.length > 0) return { key: 'common.product.soldOutPicked', names: soldOut.join(', ') };
  return { key: 'common.product.checkChoice', names: '' };
}

function unique(names: ReadonlyArray<string | undefined>): string[] {
  return [...new Set(names.filter((n): n is string => Boolean(n)))];
}

/**
 * How a group is drawn:
 * - `single` — a switch or a counter of one option (sugar, ice, «Без
 *   кофеина», «Острый»): just that option's row, its name says it all;
 * - `open` — a variant group, or a list of one: its name over its options,
 *   always open — a variant is what the product is;
 * - `folded` — an add-on group of several: one row with what is picked,
 *   opening in place.
 */
type GroupLayout = 'open' | 'single' | 'folded';

function layoutOf(group: ProductOptionGroup): GroupLayout {
  if (group.options.length === 1) return group.type === 'A' ? 'open' : 'single';
  return group.kind === 'VARIANT' ? 'open' : 'folded';
}

/**
 * The options catalog («Добавки и варианты») on the Mini App's product
 * screen, for a product with catalog groups attached — the site's layout,
 * sized for a phone and drawn in theme tokens so the Telegram palette
 * carries through; each tap gives a light haptic. Variants first, then add-ons, each
 * group with its own control:
 *
 *   A, one of (max 1) — a list of radio rows;
 *   A, several (max > 1) — ticks with «до N»; once the group is full the
 *     rest are locked;
 *   B — a switch on every option;
 *   C — a −/+ counter on every option, within its bounds.
 *
 * Every row says what it adds: «+10 MDL», a variant «−5 MDL», a counted
 * add-on «+5 MDL за шт.» and how many the price already includes. An
 * option the store has run out of is greyed out with «Нет в наличии».
 * Groups shown only for some choice (ice for an iced coffee) come and go
 * with it.
 *
 * The screen owns the choice (`picks`); every change goes through the shared
 * rules in `@takeaway/utils`, which also drop the picks of a group a change
 * hides.
 */
@Component({
  selector: 'app-tma-product-option-groups',
  standalone: true,
  imports: [NgTemplateOutlet, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (group of visible(); track group.id) {
      @let layout = layoutOf(group);
      @let oneOf = group.type === 'A' && bounds(group).max === 1;
      <section
        class="og"
        [class.folded]="layout === 'folded'"
        [class.lacking]="lacking().has(group.id)"
        [attr.role]="oneOf ? 'radiogroup' : 'group'"
        [attr.aria-label]="group.name"
        data-testid="option-group"
      >
        @if (layout === 'folded') {
          <button
            type="button"
            class="head"
            [attr.aria-expanded]="isOpen(group)"
            [attr.aria-controls]="'og-' + group.id"
            (click)="toggleOpen(group)"
          >
            <ng-container *ngTemplateOutlet="headText; context: { $implicit: group }" />
            <span class="picked" [class.none]="!summary(group)"
              >· {{ summary(group) || ('common.product.notChosen' | translate) }}</span
            >
            <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        } @else if (layout === 'open') {
          <div class="head">
            <ng-container *ngTemplateOutlet="headText; context: { $implicit: group }" />
          </div>
        }
        @if (layout !== 'folded' || isOpen(group)) {
          <ul class="list" [attr.id]="'og-' + group.id">
            @for (o of group.options; track o.id) {
              <li
                class="row"
                [class.off]="!o.available"
                [class.locked]="o.available && locked(group, o)"
                data-testid="option-row"
              >
                @if (group.type === 'C') {
                  <span class="text">
                    <span class="name">{{ o.name }}</span>
                    <span class="meta">
                      @if (o.note) {
                        <span>{{ o.note }}</span>
                      }
                      @if (!o.available) {
                        <span class="sold-out">{{ 'common.product.soldOut' | translate }}</span>
                      } @else {
                        @let free = included(group, o);
                        @if (free > 0) {
                          <span>{{
                            (free === 1 ? 'common.product.includedOne' : 'common.product.includedMany')
                              | translate: { n: free }
                          }}</span>
                        }
                        @if (o.priceCents > 0) {
                          <span>{{ 'common.product.perUnit' | translate: { price: signed(o.priceCents) } }}</span>
                        }
                      }
                    </span>
                  </span>
                  <span class="stepper">
                    <button
                      type="button"
                      [disabled]="qty(o) <= qtyMin(o)"
                      [attr.aria-label]="'common.product.decrease' | translate: { name: o.name }"
                      (click)="step(o, -1)"
                    >
                      −
                    </button>
                    <span aria-live="polite">{{ qty(o) }}</span>
                    <button
                      type="button"
                      [disabled]="!o.available || qty(o) >= qtyMax(o)"
                      [attr.aria-label]="'common.product.increase' | translate: { name: o.name }"
                      (click)="step(o, 1)"
                    >
                      +
                    </button>
                  </span>
                } @else if (group.type === 'A') {
                  <label class="pick">
                    <input
                      [type]="oneOf ? 'radio' : 'checkbox'"
                      [attr.name]="oneOf ? 'og-' + group.id : null"
                      [checked]="isPicked(o)"
                      [disabled]="locked(group, o)"
                      (click)="onPickClick(group, o, $event)"
                      (change)="onToggle(o, $event)"
                    />
                    <ng-container *ngTemplateOutlet="optionText; context: { $implicit: o }" />
                  </label>
                } @else {
                  <label class="pick">
                    <ng-container *ngTemplateOutlet="optionText; context: { $implicit: o }" />
                    <input
                      type="checkbox"
                      role="switch"
                      class="switch"
                      [checked]="isPicked(o)"
                      [disabled]="locked(group, o)"
                      (change)="onToggle(o, $event)"
                    />
                  </label>
                }
              </li>
            }
          </ul>
        }
      </section>
    }

    <!-- An A or B option: its name and note, and what it adds or that it ran out. -->
    <ng-template #optionText let-o>
      <span class="text">
        <span class="name">{{ o.name }}</span>
        @if (o.note) {
          <span class="meta">{{ o.note }}</span>
        }
      </span>
      @if (!o.available) {
        <span class="price sold-out">{{ 'common.product.soldOut' | translate }}</span>
      } @else if (o.priceCents !== 0) {
        <span class="price">{{ signed(o.priceCents) }}</span>
      }
    </ng-template>

    <ng-template #headText let-group>
      <span class="title">{{ group.name }}</span>
      @if (limit(group); as l) {
        <span class="limit">{{ l.key | translate: l }}</span>
      }
      @if (lacking().has(group.id)) {
        <span class="required">{{ 'common.product.required' | translate }}</span>
      }
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 12px;
        font-family: var(--font-sans);
        color: var(--color-text-primary);
      }
      .og {
        border: 1px solid var(--color-border-light);
        border-radius: var(--radius-input);
        background: var(--color-foam);
      }
      .og.lacking {
        border-color: var(--color-caramel);
      }
      .head {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 4px 8px;
        width: 100%;
        min-height: 44px;
        padding: 10px 12px 0;
        text-align: left;
        font-size: 14px;
        color: var(--color-text-primary);
      }
      button.head {
        flex-wrap: nowrap;
        min-height: 46px;
        padding: 0 12px;
      }
      .title {
        font-weight: 600;
      }
      .limit {
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .required {
        padding: 2px 8px;
        border-radius: var(--radius-pill);
        background: var(--color-caramel-light);
        color: var(--color-caramel);
        font-size: 11px;
        font-weight: 600;
      }
      .picked {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .picked.none {
        color: var(--color-text-tertiary);
      }
      .chevron {
        flex: none;
        width: 18px;
        height: 18px;
        fill: none;
        stroke: var(--color-text-tertiary);
        stroke-width: 2;
        transition: transform 0.15s;
      }
      button[aria-expanded='true'] .chevron {
        transform: rotate(90deg);
      }
      .list {
        margin: 0;
        padding: 0 12px 4px;
        list-style: none;
      }
      .row,
      .pick {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 48px;
        font-size: 14px;
      }
      .row + .row {
        border-top: 1px solid var(--color-border-light);
      }
      .row.off,
      .row.locked {
        color: var(--color-text-tertiary);
      }
      .pick {
        flex: 1;
        min-width: 0;
        cursor: pointer;
      }
      .row.off .pick {
        cursor: default;
      }
      .pick input:not(.switch) {
        flex: none;
        width: 18px;
        height: 18px;
        margin: 0;
        accent-color: var(--color-caramel);
      }
      .text {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        padding: 6px 0;
      }
      .meta {
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .meta:empty {
        display: none;
      }
      .meta > span + span::before {
        content: ' · ';
      }
      .sold-out {
        color: var(--color-berry);
      }
      .price {
        flex: none;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .price.sold-out {
        font-size: 12px;
        color: var(--color-berry);
      }
      .switch {
        appearance: none;
        -webkit-appearance: none;
        flex: none;
        position: relative;
        width: 42px;
        height: 26px;
        margin: 0;
        border-radius: 9999px;
        background: var(--color-border);
        cursor: pointer;
        transition: background 0.15s;
      }
      .switch::after {
        content: '';
        position: absolute;
        top: 3px;
        left: 3px;
        width: 20px;
        height: 20px;
        border-radius: 9999px;
        background: var(--tg-button-text-color, #fff);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
        transition: transform 0.15s;
      }
      .switch:checked {
        background: var(--color-caramel);
      }
      .switch:checked::after {
        transform: translateX(16px);
      }
      .switch:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .stepper {
        flex: none;
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-pill);
      }
      .stepper button {
        width: 32px;
        height: 32px;
        font-size: 16px;
        color: var(--color-text-primary);
      }
      .stepper button:disabled {
        opacity: 0.3;
      }
      .stepper span {
        min-width: 20px;
        text-align: center;
        font-weight: 600;
      }
    `,
  ],
})
export class TmaProductOptionGroupsComponent {
  private readonly fmt = inject(LocaleFormatService);
  private readonly tg = inject(TelegramBridgeService);

  /** The product's groups, variants first (`orderOptionGroups`). */
  readonly groups = input.required<readonly ProductOptionGroup[]>();
  /** The serving store's currency, for the prices. */
  readonly currency = input<string | null | undefined>(null);
  readonly picks = model.required<Record<string, number>>();

  readonly visible = computed(() => visibleOptionGroups(this.groups(), this.picks()));

  /** Groups still waiting for a pick: marked «обязательно». */
  readonly lacking = computed(
    () =>
      new Set(
        validateOptionPicks(this.groups(), this.picks())
          .filter((e) => e.code === 'TOO_FEW')
          .map((e) => e.groupId),
      ),
  );

  /** Folded groups shown open: those waiting for a pick when the product opens, then whatever the customer opens. */
  private readonly opened = linkedSignal<readonly ProductOptionGroup[], ReadonlySet<string>>({
    source: this.groups,
    computation: () => new Set(untracked(() => [...this.lacking()].filter((id): id is string => id !== null))),
  });

  readonly layoutOf = layoutOf;

  bounds(group: ProductOptionGroup): { min: number; max: number } {
    return selectBounds(group);
  }

  isOpen(group: ProductOptionGroup): boolean {
    return this.opened().has(group.id);
  }

  toggleOpen(group: ProductOptionGroup): void {
    this.opened.update((open) => {
      const next = new Set(open);
      if (!next.delete(group.id)) next.add(group.id);
      return next;
    });
    this.tg.haptic('light');
  }

  /** «до 2», «от 1 до 3» over a list of several. */
  limit(group: ProductOptionGroup): { key: string; min: number; max: number } | null {
    if (group.type !== 'A') return null;
    const { min, max } = selectBounds(group);
    if (max <= 1) return null;
    return { key: min > 0 ? 'common.product.fromTo' : 'common.product.upTo', min, max };
  }

  /** What is picked in a folded group: «Ваниль, Карамель», «Сыр ×2». */
  summary(group: ProductOptionGroup): string {
    return group.options
      .filter((o) => this.qty(o) > 0)
      .map((o) => (this.qty(o) > 1 ? `${o.name} ×${this.qty(o)}` : o.name))
      .join(', ');
  }

  isPicked(option: ProductOptionItem): boolean {
    return this.qty(option) > 0;
  }

  qty(option: ProductOptionItem): number {
    return this.picks()[option.id] ?? 0;
  }

  qtyMin(option: ProductOptionItem): number {
    return qtyBounds(option).min;
  }

  qtyMax(option: ProductOptionItem): number {
    return qtyBounds(option).max;
  }

  /**
   * A tick or switch that cannot be turned on: the store ran out of it, or
   * the list already has as many as it allows. A picked one can always be
   * turned off.
   */
  locked(group: ProductOptionGroup, option: ProductOptionItem): boolean {
    if (this.isPicked(option)) return false;
    if (!option.available) return true;
    if (group.type !== 'A') return false;
    const { max } = selectBounds(group);
    return max > 1 && group.options.filter((o) => this.isPicked(o)).length >= max;
  }

  /** How many of a counted add-on the price already includes (the meat in a shawarma). */
  included(group: ProductOptionGroup, option: ProductOptionItem): number {
    return freeQty(group, option);
  }

  /** «+10 MDL»; a cheaper variant «−5 MDL». */
  signed(cents: number): string {
    const money = this.fmt.money(cents, this.currency());
    return cents > 0 ? `+${money}` : money;
  }

  /**
   * A tap on a radio that is already picked: it comes off when the group can
   * do without it (a topping, 0–1). A tap on another one, and any tick, is
   * the `change` that follows. (Returns nothing: a `false` from a template
   * listener would cancel the tap.)
   */
  onPickClick(group: ProductOptionGroup, option: ProductOptionItem, event: Event): void {
    if (selectBounds(group).max !== 1 || !this.isPicked(option)) return;
    this.toggle(option);
    (event.target as HTMLInputElement).checked = this.isPicked(option);
  }

  onToggle(option: ProductOptionItem, event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.checked !== this.isPicked(option)) this.toggle(option);
    // A refused tap (a third syrup) leaves the box as the choice has it.
    input.checked = this.isPicked(option);
  }

  step(option: ProductOptionItem, by: number): void {
    this.picks.set(setOptionQty(this.groups(), this.picks(), option.id, this.qty(option) + by));
    this.tg.haptic('light');
  }

  private toggle(option: ProductOptionItem): void {
    this.picks.set(toggleOptionPick(this.groups(), this.picks(), option.id));
    this.tg.haptic('light');
  }
}
