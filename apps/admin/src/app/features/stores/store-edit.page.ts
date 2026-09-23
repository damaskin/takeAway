import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { type EditorTab, StoreEditorComponent } from './store-editor.component';

const TABS: EditorTab[] = ['details', 'hours', 'photos', 'kitchen'];

/**
 * Edit one store, on its own route.
 *
 * The editor used to open inside the store's card in the list, which is as
 * wide as the list grid makes it. It owns the page now; which tab it opens
 * on comes from `?tab=`, so the list can link straight at working hours or
 * at a readiness check that needs fixing.
 */
@Component({
  selector: 'app-store-edit',
  standalone: true,
  imports: [RouterLink, TranslatePipe, StoreEditorComponent],
  template: `
    <section style="padding: clamp(16px, 3vw, 28px); max-width: 960px; margin: 0 auto">
      <a
        routerLink="/stores"
        class="flex items-center"
        style="gap: 6px; width: fit-content; font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-secondary); text-decoration: none; margin-bottom: 14px"
      >
        <span aria-hidden="true">←</span>
        <span>{{ 'admin.stores.title' | translate }}</span>
      </a>

      <header style="margin-bottom: 20px">
        <h1
          style="font-family: var(--font-display); font-size: 26px; font-weight: 700; color: var(--color-espresso); margin: 0"
        >
          {{ 'admin.stores.edit' | translate }}
        </h1>
        @if (name(); as storeName) {
          <p
            style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 6px 0 0"
          >
            {{ storeName }}
          </p>
        }
      </header>

      <app-store-editor
        [storeId]="storeId()"
        [initialTab]="initialTab()"
        (closed)="back()"
        (saveCompleted)="seen($event)"
      />
    </section>
  `,
})
export class StoreEditPage {
  readonly storeId = input.required<string>();
  /** `?tab=hours` — the list links straight at the tab the user asked for. */
  readonly tab = input<string | undefined>();

  private readonly api = inject(AdminCatalogApi);
  private readonly router = inject(Router);

  readonly name = signal<string | null>(null);
  readonly initialTab = computed<EditorTab>(() => {
    const wanted = this.tab();
    return TABS.find((t) => t === wanted) ?? 'details';
  });

  constructor() {
    effect(() => {
      this.api.getStore(this.storeId()).subscribe({
        next: (s) => this.name.set(s.name),
        // A name in the header is a nicety; the editor reports its own failures.
        error: () => this.name.set(null),
      });
    });
  }

  seen(updated: StoreAdminDto): void {
    this.name.set(updated.name);
  }

  back(): void {
    this.router.navigate(['/stores']);
  }
}
