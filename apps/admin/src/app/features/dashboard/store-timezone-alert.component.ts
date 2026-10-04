import { Component, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi } from '../../core/catalog/admin-catalog.service';
import { storeNeedsTimeZone } from '../stores/store-options';

interface StoreRef {
  id: string;
  name: string;
}

/**
 * A red banner on the dashboard for every open store of the active brand
 * still on the UTC placeholder zone. Its working hours are read two or
 * three hours off, so customers see it closed while staff are at work —
 * worth shouting about on the first page the owner opens. Hides itself
 * when there is nothing to fix (or the list could not be read).
 */
@Component({
  selector: 'app-store-timezone-alert',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    @if (stores().length > 0) {
      <div
        role="alert"
        data-testid="dashboard-timezone-alert"
        class="flex flex-col"
        style="gap: 8px; padding: 14px 16px; background: #D94B5E1A; border: 1px solid var(--color-berry); border-left: 4px solid var(--color-berry); border-radius: 12px; font-family: var(--font-sans)"
      >
        <strong style="font-size: 14px; color: #8F2F3C">{{ 'admin.dashboard.timezoneAlert.title' | translate }}</strong>
        <span style="font-size: 13px; color: var(--color-text-secondary)">{{
          'admin.dashboard.timezoneAlert.body' | translate
        }}</span>
        <div class="flex flex-wrap" style="gap: 6px 16px">
          @for (s of stores(); track s.id) {
            <a
              [routerLink]="['/stores', s.id]"
              [queryParams]="{ tab: 'details' }"
              style="font-size: 13px; font-weight: 600; color: var(--color-berry)"
              >{{ 'admin.dashboard.timezoneAlert.fix' | translate: { name: s.name } }}</a
            >
          }
        </div>
      </div>
    }
  `,
})
export class StoreTimezoneAlertComponent {
  private readonly api = inject(AdminCatalogApi);
  private readonly activeBrand = inject(ActiveBrandService);

  readonly stores = signal<StoreRef[]>([]);
  private request = 0;

  constructor() {
    effect(() => {
      const brandId = this.activeBrand.activeId();
      untracked(() => this.load(brandId));
    });
  }

  private load(brandId: string | null): void {
    const request = ++this.request;
    this.stores.set([]);
    if (!brandId) return;
    this.api.listStores(brandId).subscribe({
      next: (list) => {
        if (request !== this.request) return;
        this.stores.set(list.filter(storeNeedsTimeZone).map((s) => ({ id: s.id, name: s.name })));
      },
      // The banner is a nudge; the rest of the dashboard does not depend on it.
      error: () => undefined,
    });
  }
}
