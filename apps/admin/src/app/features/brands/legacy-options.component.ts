import { Component, computed, inject, input, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { LegacyOptionsSummary } from '@takeaway/shared-types';

import { OptionCatalogApi } from '../../core/catalog/option-catalog.service';
import { describeOptionError } from '../option-catalog/option-errors';

/**
 * «Старые опции бренда» on a brand's card (SUPER_ADMIN): what the brand
 * still has of the per-product options from before the options catalog,
 * and the one action that deletes them all (`docs/option-groups.md`,
 * answer 9 — on prod only with the owner's OK). It cannot be undone, so the
 * button asks for the brand's name to be typed first, right in the card.
 * The counts load when the block is opened, not for every brand on the list.
 */
@Component({
  selector: 'app-legacy-options',
  standalone: true,
  imports: [TranslatePipe],
  styles: [
    `
      :host {
        display: block;
        margin-top: 12px;
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-text-primary);
      }
      .toggle,
      .cancel {
        padding: 0;
        border: 0;
        background: transparent;
        font: inherit;
        font-weight: 600;
        color: var(--color-caramel);
        cursor: pointer;
      }
      .cancel {
        color: var(--color-text-secondary);
      }
      .panel {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 8px;
        padding: 12px;
        border-radius: 10px;
        background: var(--color-cream);
      }
      .warning {
        margin: 0;
        padding: 8px 10px;
        border-left: 3px solid var(--color-berry);
        border-radius: 8px;
        background: var(--color-foam);
      }
      .danger {
        height: 34px;
        padding: 0 14px;
        border: 0;
        border-radius: var(--radius-button);
        background: var(--color-berry);
        color: white;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      .danger:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      input {
        height: 34px;
        padding: 0 10px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-input);
        background: var(--color-foam);
        font: inherit;
      }
    `,
  ],
  template: `
    <button
      type="button"
      class="toggle"
      [attr.aria-expanded]="open()"
      (click)="toggle()"
      data-testid="legacy-options-toggle"
    >
      {{ 'admin.optionsCatalog.legacy.title' | translate }} {{ open() ? '▴' : '▾' }}
    </button>
    @if (open()) {
      <div class="panel" data-testid="legacy-options">
        @if (loading()) {
          <span>{{ 'common.loading' | translate }}</span>
        } @else if (summary(); as s) {
          @if (empty()) {
            <span data-testid="legacy-options-none">{{ 'admin.optionsCatalog.legacy.none' | translate }}</span>
          } @else {
            <span data-testid="legacy-options-counts">{{ 'admin.optionsCatalog.legacy.counts' | translate: s }}</span>
            @if (confirming()) {
              <p class="warning">{{ 'admin.optionsCatalog.legacy.warning' | translate }}</p>
              <label class="flex flex-col" style="gap: 4px">
                <span>{{ 'admin.optionsCatalog.legacy.typeName' | translate: { name: brandName() } }}</span>
                <input
                  type="text"
                  autocomplete="off"
                  [value]="typed()"
                  (input)="typed.set($any($event.target).value)"
                  data-testid="legacy-options-name"
                />
              </label>
              <div class="flex items-center flex-wrap" style="gap: 8px 14px">
                <button
                  type="button"
                  class="danger"
                  [disabled]="!nameMatches() || busy()"
                  (click)="clear()"
                  data-testid="legacy-options-confirm"
                >
                  {{ 'admin.optionsCatalog.legacy.confirm' | translate }}
                </button>
                <button type="button" class="cancel" (click)="cancel()">{{ 'common.cancel' | translate }}</button>
              </div>
            } @else {
              <button
                type="button"
                class="danger"
                style="align-self: flex-start"
                (click)="confirming.set(true)"
                data-testid="legacy-options-clear"
              >
                {{ 'admin.optionsCatalog.legacy.clear' | translate }}
              </button>
            }
          }
        }
        @if (cleared(); as c) {
          <span role="status" data-testid="legacy-options-cleared">{{
            'admin.optionsCatalog.legacy.cleared' | translate: c
          }}</span>
        }
        @if (error(); as message) {
          <span role="alert" style="color: var(--color-berry)">{{ message }}</span>
        }
      </div>
    }
  `,
})
export class LegacyOptionsComponent {
  readonly brandId = input.required<string>();
  readonly brandName = input.required<string>();

  private readonly api = inject(OptionCatalogApi);
  private readonly translate = inject(TranslateService);

  readonly open = signal(false);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly summary = signal<LegacyOptionsSummary | null>(null);
  readonly cleared = signal<LegacyOptionsSummary | null>(null);
  readonly error = signal<string | null>(null);
  readonly confirming = signal(false);
  readonly typed = signal('');

  readonly empty = computed(() => {
    const s = this.summary();
    return !!s && s.products + s.variations + s.modifiers + s.categoryOptions + s.ingredients === 0;
  });
  /** The brand's name typed again, ignoring case and the spaces around it. */
  readonly nameMatches = computed(
    () => this.typed().trim().toLocaleLowerCase() === this.brandName().trim().toLocaleLowerCase(),
  );

  toggle(): void {
    const open = !this.open();
    this.open.set(open);
    if (open && !this.summary()) this.load();
    if (!open) this.cancel();
  }

  cancel(): void {
    this.confirming.set(false);
    this.typed.set('');
  }

  clear(): void {
    if (!this.nameMatches() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.clearLegacy(this.brandId()).subscribe({
      next: (deleted) => {
        this.busy.set(false);
        this.cancel();
        this.cleared.set(deleted);
        this.load();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(describeOptionError(err, this.translate));
      },
    });
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.legacySummary(this.brandId()).subscribe({
      next: (summary) => {
        this.loading.set(false);
        this.summary.set(summary);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(describeOptionError(err, this.translate));
      },
    });
  }
}
