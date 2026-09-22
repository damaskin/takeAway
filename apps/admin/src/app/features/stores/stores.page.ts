import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { extractMessage } from '../../core/http/extract-message';

/**
 * The list of a brand's stores. Creating and editing happen on their own
 * routes — see `store-form.page.ts` — so this page only ever shows the list,
 * and never has to make room for a form inside one of its cards.
 */
@Component({
  selector: 'app-stores',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <div
      class="flex items-center justify-between flex-wrap"
      style="min-height: 64px; padding: 12px clamp(12px, 3vw, 24px); background: var(--color-foam); border-bottom: 1px solid var(--color-border-light); gap: 12px"
    >
      <h1
        style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        {{ 'admin.stores.title' | translate }}
      </h1>
      @if (hasBrand()) {
        <a
          routerLink="/stores/new"
          style="height: 36px; padding: 0 14px; display: inline-flex; align-items: center; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; text-decoration: none"
        >
          {{ 'admin.stores.add' | translate }}
        </a>
      }
    </div>

    <section style="padding: 24px; display: flex; flex-direction: column; gap: 16px">
      @if (brandBlocker(); as blocker) {
        <div
          style="padding: 16px 18px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-left: 4px solid var(--color-amber); border-radius: 12px; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)"
        >
          <p style="margin: 0 0 6px; font-weight: 600">{{ 'admin.brandContext.blockedTitle' | translate }}</p>
          @if (blocker === 'error') {
            <p style="margin: 0 0 10px; color: var(--color-text-secondary)">
              {{ 'admin.brandContext.loadFailed' | translate }} {{ activeBrand.loadError() }}
            </p>
            <button
              type="button"
              (click)="activeBrand.refresh()"
              [disabled]="activeBrand.loading()"
              style="height: 32px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: 8px; font-family: var(--font-sans); font-size: 13px; font-weight: 600"
            >
              {{ 'common.retry' | translate }}
            </button>
          } @else {
            <p style="margin: 0; color: var(--color-text-secondary)">
              {{ 'admin.brandContext.noBrandsHint' | translate }}
            </p>
          }
        </div>
      }

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

            <div class="flex flex-wrap" style="gap: 8px; margin-top: 4px">
              <a
                [routerLink]="['/stores', s.id]"
                class="flex-1"
                style="height: 36px; display: inline-flex; align-items: center; justify-content: center; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-text-primary); text-decoration: none"
              >
                {{ 'admin.stores.edit' | translate }}
              </a>
              <a
                [routerLink]="['/stores', s.id, 'hours']"
                class="flex-1"
                style="height: 36px; display: inline-flex; align-items: center; justify-content: center; background: var(--color-caramel-light); color: var(--color-caramel); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600; text-decoration: none"
              >
                {{ 'admin.stores.hours' | translate }}
              </a>
              <button
                type="button"
                (click)="remove(s)"
                [disabled]="deletingId() === s.id"
                style="height: 36px; padding: 0 12px; background: transparent; color: var(--color-berry); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 500"
              >
                {{ (deletingId() === s.id ? 'common.loading' : 'admin.stores.delete') | translate }}
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
  readonly activeBrand = inject(ActiveBrandService);

  /**
   * Why the page can't create anything: `error` = the brand list failed to
   * load, `empty` = it loaded and the account has no brand yet. `null` =
   * either we're still loading or there's a brand and we're good.
   */
  readonly brandBlocker = computed<'error' | 'empty' | null>(() => {
    if (this.activeBrand.loadError()) return 'error';
    if (this.activeBrand.isEmpty()) return 'empty';
    return null;
  });
  readonly hasBrand = computed(() => this.activeBrand.active() !== null);

  readonly stores = signal<StoreAdminDto[]>([]);
  readonly error = signal<string | null>(null);
  readonly deletingId = signal<string | null>(null);

  constructor() {
    // Refetch the store list whenever the active brand changes (selector in
    // the top bar). Skip while no brand is resolved yet — loading state is
    // owned by ActiveBrandService.
    effect(() => {
      const brandId = this.activeBrand.activeId();
      if (!brandId) {
        this.stores.set([]);
        return;
      }
      this.api.listStores(brandId).subscribe({
        next: (list) => this.stores.set(list),
        error: (err) => this.error.set(extractMessage(err) ?? this.translate.instant('admin.stores.loadFailed')),
      });
    });
  }

  ngOnInit(): void {
    // Brand list is normally loaded once by AdminLayoutPage; trigger here as
    // a safety net for direct navigation / hot-reload.
    if (!this.activeBrand.loaded()) this.activeBrand.refresh();
  }

  remove(store: StoreAdminDto): void {
    const msg = this.translate.instant('admin.stores.deleteConfirm', { name: store.name });
    if (!confirm(msg)) return;
    this.deletingId.set(store.id);
    this.api.deleteStore(store.id).subscribe({
      next: () => {
        this.deletingId.set(null);
        this.stores.update((list) => list.filter((s) => s.id !== store.id));
      },
      error: (err) => {
        this.deletingId.set(null);
        this.error.set(extractMessage(err) ?? this.translate.instant('common.genericError'));
      },
    });
  }

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
