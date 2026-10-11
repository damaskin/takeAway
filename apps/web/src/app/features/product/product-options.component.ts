import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, model } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { Modifier, Variation, VariationType } from '@takeaway/shared-types';
import { LocaleFormatService } from '@takeaway/i18n';
import {
  chosenModifiers,
  clampModifierCount,
  groupModifiers,
  groupVariations,
  type ModifierGroup,
  type VariationSelection,
} from '@takeaway/utils';

const VARIATION_LABELS: Record<VariationType, string> = {
  SIZE: 'web.product.labels.size',
  TEMPERATURE: 'web.product.labels.temperature',
  MILK: 'web.product.labels.milk',
  CUP: 'web.product.labels.cup',
};

/**
 * A product's options, for the product page.
 *
 *   sizes, temperatures, milks, cups — a row of choice chips each, one
 *     picked, the price difference on the chip («+3 руб.»);
 *   add-ons — a collapsed row per group, «Сиропы · не выбрано ›» or
 *     «Сиропы · Ваниль, Карамель ›», opening in place to a short list with a
 *     tick (one at most) or a stepper (several). A group with an add-on that
 *     has to be taken opens at once and is marked «обязательно».
 *
 * The page owns the choice (`selection`, `counts`) and prices it.
 */
@Component({
  selector: 'app-product-options',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (group of variationGroups(); track group.type) {
      <div class="group" role="radiogroup" [attr.aria-label]="variationLabel(group.type) | translate">
        <span class="title">{{ variationLabel(group.type) | translate }}</span>
        <div class="chips">
          @for (v of group.variations; track v.id) {
            <button
              type="button"
              role="radio"
              class="chip"
              [class.on]="selection()[group.type] === v.id"
              [attr.aria-checked]="selection()[group.type] === v.id"
              (click)="pick(v)"
            >
              {{ v.name }}
              @if (v.priceDeltaCents !== 0) {
                <span class="delta">{{ delta(v.priceDeltaCents) }}</span>
              }
            </button>
          }
        </div>
      </div>
    }

    @for (group of modifierGroups(); track groupKey(group); let i = $index) {
      <div class="addons" [class.open]="isOpen(group)">
        <button
          type="button"
          class="head"
          [attr.aria-expanded]="isOpen(group)"
          [attr.aria-controls]="'addons-' + i"
          (click)="toggle(group)"
        >
          <span class="name">{{ group.name ?? ('common.product.addons' | translate) }}</span>
          @if (group.required) {
            <span class="required">{{ 'common.product.required' | translate }}</span>
          }
          <span class="picked" [class.none]="!groupSummary(group)"
            >· {{ groupSummary(group) || ('common.product.notChosen' | translate) }}</span
          >
          <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        </button>
        @if (isOpen(group)) {
          <ul class="list" [attr.id]="'addons-' + i">
            @for (m of group.modifiers; track m.id) {
              <li class="row">
                @if (m.maxCount <= 1) {
                  <label class="check">
                    <input
                      type="checkbox"
                      [checked]="count(m) > 0"
                      [disabled]="m.minCount > 0"
                      (change)="onCheck(m, $event)"
                    />
                    <span class="label">{{ m.name }}</span>
                    @if (m.priceDeltaCents !== 0) {
                      <span class="price">{{ delta(m.priceDeltaCents) }}</span>
                    }
                  </label>
                } @else {
                  <span class="label">{{ m.name }}</span>
                  @if (m.priceDeltaCents !== 0) {
                    <span class="price">{{ delta(m.priceDeltaCents) }}</span>
                  }
                  <span class="stepper">
                    <button
                      type="button"
                      [disabled]="count(m) <= m.minCount"
                      [attr.aria-label]="'common.product.decrease' | translate: { name: m.name }"
                      (click)="step(m, -1)"
                    >
                      −
                    </button>
                    <span aria-live="polite">{{ count(m) }}</span>
                    <button
                      type="button"
                      [disabled]="count(m) >= m.maxCount"
                      [attr.aria-label]="'common.product.increase' | translate: { name: m.name }"
                      (click)="step(m, 1)"
                    >
                      +
                    </button>
                  </span>
                }
              </li>
            }
          </ul>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 18px;
        font-family: var(--font-sans);
        color: var(--color-text-primary);
      }
      .group {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .title {
        font-size: 14px;
        font-weight: 600;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 36px;
        padding: 0 14px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-pill);
        font-size: 14px;
        font-weight: 500;
      }
      .chip.on {
        border-color: var(--color-caramel);
        background: var(--color-caramel);
        color: #fff;
      }
      .delta,
      .price {
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .chip.on .delta {
        color: inherit;
        opacity: 0.8;
      }
      .addons {
        border: 1px solid var(--color-border-light);
        border-radius: var(--radius-input);
        background: var(--color-foam);
      }
      .head {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        min-height: 48px;
        padding: 0 14px;
        text-align: left;
        font-size: 14px;
      }
      .name {
        font-weight: 600;
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
      .open .chevron {
        transform: rotate(90deg);
      }
      .list {
        margin: 0;
        padding: 0 14px 6px;
        list-style: none;
      }
      .row,
      .check {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
        font-size: 14px;
      }
      .row + .row {
        border-top: 1px solid var(--color-border-light);
      }
      .check {
        flex: 1;
        cursor: pointer;
      }
      .check input {
        width: 18px;
        height: 18px;
        accent-color: var(--color-caramel);
      }
      .label {
        flex: 1;
        min-width: 0;
      }
      .stepper {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-pill);
      }
      .stepper button {
        width: 32px;
        height: 32px;
        font-size: 16px;
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
export class ProductOptionsComponent {
  private readonly fmt = inject(LocaleFormatService);

  readonly variations = input.required<readonly Variation[]>();
  readonly modifiers = input.required<readonly Modifier[]>();
  /** The serving store's currency, for the price differences. */
  readonly currency = input<string | null | undefined>(null);
  readonly selection = model.required<VariationSelection>();
  readonly counts = model.required<Record<string, number>>();

  readonly variationGroups = computed(() => groupVariations(this.variations()));
  readonly modifierGroups = computed(() => groupModifiers(this.modifiers()));

  /** Groups shown open: the required ones to begin with, then whatever the customer opens. */
  private readonly openGroups = linkedSignal(
    () =>
      new Set(
        this.modifierGroups()
          .filter((g) => g.required)
          .map((g) => this.groupKey(g)),
      ),
  );

  variationLabel(type: VariationType): string {
    return VARIATION_LABELS[type];
  }

  groupKey(group: ModifierGroup): string {
    return group.name ?? '';
  }

  isOpen(group: ModifierGroup): boolean {
    return this.openGroups().has(this.groupKey(group));
  }

  toggle(group: ModifierGroup): void {
    const key = this.groupKey(group);
    this.openGroups.update((open) => {
      const next = new Set(open);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  /** What is taken from the group: «Ваниль, Карамель ×2»; empty when nothing is. */
  groupSummary(group: ModifierGroup): string {
    return chosenModifiers(group.modifiers, this.counts())
      .map(({ modifier, count }) => (count > 1 ? `${modifier.name} ×${count}` : modifier.name))
      .join(', ');
  }

  pick(variation: Variation): void {
    this.selection.update((s) => ({ ...s, [variation.type]: variation.id }));
  }

  count(modifier: Modifier): number {
    return this.counts()[modifier.id] ?? 0;
  }

  step(modifier: Modifier, by: number): void {
    this.setCount(modifier, this.count(modifier) + by);
  }

  onCheck(modifier: Modifier, event: Event): void {
    this.setCount(modifier, (event.target as HTMLInputElement).checked ? 1 : 0);
  }

  /** «+3 руб.», or «−2 руб.» for an option that costs less. */
  delta(cents: number): string {
    const money = this.fmt.money(cents, this.currency());
    return cents > 0 ? `+${money}` : money;
  }

  private setCount(modifier: Modifier, count: number): void {
    const next = clampModifierCount(modifier, count);
    if (next === this.count(modifier)) return;
    this.counts.update((counts) => ({ ...counts, [modifier.id]: next }));
  }
}
