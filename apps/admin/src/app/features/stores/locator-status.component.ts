import { Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { AddressLocator } from './address-locator';

/**
 * The line under the store map: what the address lookup found or why the
 * pin has to be put by hand, and «Найти по адресу» to look it up again.
 */
@Component({
  selector: 'app-locator-status',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div class="flex items-center flex-wrap" style="gap: 6px 12px">
      <span
        role="status"
        aria-live="polite"
        data-testid="locator-status"
        [class.warn]="warn()"
        style="flex: 1 1 240px; font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)"
      >
        {{ message().key | translate: message().params }}
      </span>
      @if (canEdit() && locator().canLocate()) {
        <button
          type="button"
          data-testid="locator-find"
          (click)="locator().locateNow()"
          [disabled]="locator().status() === 'searching'"
          style="padding: 0; background: none; border: 0; font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-caramel); text-decoration: underline; cursor: pointer"
        >
          {{ 'admin.stores.locate.find' | translate }}
        </button>
      }
    </div>
    @if (locator().suggested()) {
      <span style="font-family: var(--font-sans); font-size: 12px; color: #8a6720">{{
        'admin.stores.locate.suggested' | translate
      }}</span>
    }
  `,
  styles: [
    `
      .warn {
        color: #8a6720 !important;
      }
    `,
  ],
})
export class LocatorStatusComponent {
  readonly locator = input.required<AddressLocator>();
  /** The form has a pin on the map. */
  readonly hasPin = input(false);
  readonly canEdit = input(true);
  /** Shown while nothing was looked up and there is no pin. */
  readonly emptyHint = input('admin.stores.hints.clickMap');
  /** Show {@link emptyHint} as a warning (an existing store without a location). */
  readonly emptyWarn = input(false);

  readonly warn = computed(() => {
    const status = this.locator().status();
    if (status === 'idle') return this.emptyWarn() && !this.hasPin();
    return status === 'notFound' || status === 'unavailable' || status === 'approximate' || status === 'addressChanged';
  });

  readonly message = computed<{ key: string; params?: Record<string, string> }>(() => {
    const name = this.locator().foundName() ?? '';
    switch (this.locator().status()) {
      case 'searching':
        return { key: 'admin.stores.locate.searching' };
      case 'found':
        return { key: 'admin.stores.locate.found', params: { name } };
      case 'approximate':
        return { key: 'admin.stores.locate.approximate', params: { name } };
      case 'notFound':
        return { key: 'admin.stores.locate.notFound' };
      case 'unavailable':
        return { key: 'admin.stores.locate.unavailable' };
      case 'manual':
        return { key: 'admin.stores.locate.manual' };
      case 'addressChanged':
        return { key: 'admin.stores.locate.addressChanged' };
      default:
        return { key: this.hasPin() ? 'admin.stores.fields.pickOnMap' : this.emptyHint() };
    }
  });
}
