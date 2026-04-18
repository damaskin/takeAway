import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { StoreDetail, StoreMenu } from '@takeaway/shared-types';

import { CatalogService } from '../../core/catalog/catalog.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';

@Component({
  selector: 'app-tma-menu',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="px-4 pt-6 pb-24">
      @if (store(); as s) {
        <header class="mb-6">
          <h1 class="text-2xl" style="font-family: var(--font-display)">{{ s.name }}</h1>
          <p class="text-xs mt-1" style="opacity: 0.6">
            Ready in {{ minutes(s.currentEtaSeconds) }} min · {{ s.addressLine }}
          </p>
        </header>
      }
      @if (menu(); as m) {
        @for (cat of m.categories; track cat.id) {
          <section class="mb-8">
            <h2 class="text-lg mb-3" style="font-family: var(--font-display)">{{ cat.name }}</h2>
            <ul class="flex flex-col gap-3">
              @for (p of cat.products; track p.id) {
                <li>
                  <a
                    [routerLink]="['/products', p.slug]"
                    class="block p-4"
                    [class.opacity-50]="p.onStopList"
                    style="background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft)"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <h3 style="font-family: var(--font-display)">{{ p.name }}</h3>
                        @if (p.description) {
                          <p class="text-xs mt-1 line-clamp-2" style="opacity: 0.6">{{ p.description }}</p>
                        }
                      </div>
                      <span class="text-sm font-medium whitespace-nowrap">{{ price(p.basePriceCents) }}</span>
                    </div>
                  </a>
                </li>
              }
            </ul>
          </section>
        }
      }
    </section>
  `,
})
export class TmaMenuPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly catalog = inject(CatalogService);
  private readonly tg = inject(TelegramBridgeService);

  readonly store = signal<StoreDetail | null>(null);
  readonly menu = signal<StoreMenu | null>(null);
  private detachBack: (() => void) | null = null;

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) {
      this.catalog.listStores().subscribe({
        next: (list) => {
          const first = list[0];
          if (first) void this.router.navigate(['/stores', first.slug], { replaceUrl: true });
        },
      });
      return;
    }

    this.catalog.getStore(slug).subscribe({ next: (s) => this.store.set(s) });
    this.catalog.getMenu(slug).subscribe({ next: (m) => this.menu.set(m) });

    this.detachBack = this.tg.setBackButton(() => void this.router.navigate(['/']));
  }

  ngOnDestroy(): void {
    this.detachBack?.();
  }

  minutes(seconds: number): number {
    return Math.max(1, Math.round(seconds / 60));
  }

  price(cents: number): string {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: this.store()?.currency ?? 'USD',
    }).format(cents / 100);
  }
}
