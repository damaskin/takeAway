import { Component, OnInit, inject, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';

/**
 * Admin Stores — pencil 6z8ZA.
 *
 * top bar (foam, 64px) — title + "Add store" CTA
 * content — grid of store cards with color-coded status chip, open/close toggle.
 */
@Component({
  selector: 'app-stores',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div
      class="flex items-center justify-between"
      style="height: 64px; padding: 0 24px; background: var(--color-foam); border-bottom: 1px solid var(--color-border-light)"
    >
      <h1
        style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        {{ 'admin.stores.title' | translate }}
      </h1>
      <button
        type="button"
        class="flex items-center"
        style="height: 36px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600"
      >
        {{ 'admin.stores.add' | translate }}
      </button>
    </div>

    <section style="padding: 24px; display: flex; flex-direction: column; gap: 16px">
      @if (stores().length === 0 && !error()) {
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
          {{ 'admin.stores.empty' | translate }}
        </p>
      }

      <div class="grid" style="grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px">
        @for (s of stores(); track s.id) {
          <article
            class="flex flex-col"
            style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 20px; gap: 12px"
          >
            <header class="flex items-start justify-between" style="gap: 12px">
              <div class="flex flex-col" style="gap: 4px">
                <span
                  style="font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-espresso)"
                  >{{ s.name }}</span
                >
                <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
                  >{{ s.city }} · {{ s.country }}</span
                >
              </div>
              <span
                [style.background]="statusBg(s.status)"
                [style.color]="statusColor(s.status)"
                style="padding: 4px 10px; border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 700"
                >{{ statusLabel(s.status) | translate }}</span
              >
            </header>

            <div class="flex items-center" style="gap: 12px">
              <span
                class="flex items-center"
                style="height: 24px; padding: 0 8px; background: var(--color-cream); border: 1px solid var(--color-border-light); border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 600; color: var(--color-text-secondary)"
                >{{ s.currency }}</span
              >
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)"
                >{{ 'admin.stores.slugLabel' | translate }}: {{ s.slug }}</span
              >
            </div>

            <div class="flex" style="gap: 8px; margin-top: 4px">
              <button
                type="button"
                class="flex-1"
                style="height: 36px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-text-primary)"
              >
                {{ 'admin.stores.edit' | translate }}
              </button>
              <button
                type="button"
                class="flex-1"
                style="height: 36px; background: var(--color-caramel-light); color: var(--color-caramel); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600"
              >
                {{ 'admin.stores.hours' | translate }}
              </button>
            </div>
          </article>
        }
      </div>

      @if (error()) {
        <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">{{ error() }}</p>
      }
    </section>
  `,
})
export class StoresPage implements OnInit {
  private readonly api = inject(AdminCatalogApi);
  private readonly translate = inject(TranslateService);

  readonly stores = signal<StoreAdminDto[]>([]);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.api.listStores().subscribe({
      next: (list) => this.stores.set(list),
      error: (err) => {
        const maybe = err as { error?: { message?: string }; message?: string };
        this.error.set(maybe.error?.message ?? maybe.message ?? this.translate.instant('admin.stores.loadFailed'));
      },
    });
  }

  /** Translation key; resolved with | translate in the template. */
  statusLabel(status: StoreAdminDto['status']): string {
    if (status === 'OPEN') return 'admin.stores.status.OPEN';
    if (status === 'OVERLOADED') return 'admin.stores.status.OVERLOADED';
    return 'admin.stores.status.CLOSED';
  }

  statusBg(status: StoreAdminDto['status']): string {
    if (status === 'OPEN') return '#7BC4A433';
    if (status === 'OVERLOADED') return '#E9A84B33';
    return '#D94B5E22';
  }

  statusColor(status: StoreAdminDto['status']): string {
    if (status === 'OPEN') return '#3E8868';
    if (status === 'OVERLOADED') return '#8A6720';
    return '#8F2F3C';
  }
}
