import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { interval, type Subscription } from 'rxjs';

import { LanguageSwitcherComponent } from '@takeaway/i18n';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthStore } from '../../core/auth/auth.store';
import { KdsApi, type KdsOrder, type KdsOrderStatus } from '../../core/kds/kds.service';
import { KdsRealtimeService, type KdsOrderChanged } from '../../core/realtime/realtime.service';
import { StoresApi, type StoreSummary } from '../../core/stores/stores.service';

type Column = 'NEW' | 'PREPARING' | 'READY';

const COLUMN_STATUSES: Record<Column, KdsOrderStatus[]> = {
  NEW: ['CREATED', 'PAID', 'ACCEPTED'],
  PREPARING: ['IN_PROGRESS'],
  READY: ['READY'],
};

const COLUMN_META: Record<Column, { label: string; accent: string; accentText: string }> = {
  NEW: { label: 'kds.cols.new', accent: '#C77D3B20', accentText: 'var(--color-caramel)' },
  PREPARING: { label: 'kds.cols.preparing', accent: '#E9A84B20', accentText: '#E9A84B' },
  READY: { label: 'kds.cols.ready', accent: '#7BC4A420', accentText: 'var(--color-mint)' },
};

/**
 * KDS (Kitchen Display) — pencil Hfi24.
 *
 * Full-dark kitchen surface (#0E0B0A) tuned for ambient glare.
 *
 *   kdsTop (56px, #1C1817, bottom border #2A2523):
 *     left   — takeAway logo + store selector
 *     center — queue count pill + wall-clock time
 *     right  — filter chip
 *   kdsColumns (3 columns, gap 16, padding 16):
 *     each column — accent header chip + order cards (#1C1817 w/ #2A2523 stroke)
 *     order card — big mono code + due timer, item list, notes chip, 1-2
 *       action buttons (Accept/Start/Ready/Picked up).
 */
@Component({
  selector: 'app-kds-board',
  standalone: true,
  imports: [LanguageSwitcherComponent, TranslatePipe],
  template: `
    <div
      class="flex flex-col"
      style="min-height: 100vh; background: #0E0B0A; color: #F8F3EB; font-family: var(--font-sans)"
    >
      <!-- Top bar -->
      <header
        class="flex items-center justify-between"
        class="flex-wrap"
        style="min-height: 56px; padding: 8px clamp(12px, 3vw, 24px); background: #1C1817; border-bottom: 1px solid #2A2523; gap: 12px"
      >
        <!-- Left: logo + store selector -->
        <div class="flex items-center" style="gap: 16px">
          <span style="font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-caramel)"
            >takeAway</span
          >
          @if (stores().length > 0) {
            <select
              [value]="selectedStoreId()"
              (change)="onStoreChange($event)"
              style="height: 32px; padding: 0 12px; background: #2A2523; border: 1px solid #3a3430; color: #F8F3EB; border-radius: 8px; font-family: var(--font-sans); font-size: 13px"
            >
              @for (s of stores(); track s.id) {
                <option [value]="s.id">{{ s.name }}</option>
              }
            </select>
          }
        </div>

        <!-- Center: queue count + clock -->
        <div class="flex items-center" style="gap: 24px">
          <div
            class="flex items-center"
            style="height: 30px; padding: 0 12px; background: var(--color-caramel); border-radius: 9999px; gap: 8px"
          >
            <span style="font-family: var(--font-sans); font-size: 13px; font-weight: 700; color: white">{{
              openCount()
            }}</span>
            <span
              style="font-family: var(--font-sans); font-size: 11px; font-weight: 500; color: rgba(255,255,255,0.85); letter-spacing: 0.5px; text-transform: uppercase"
              >{{ 'kds.topbar.inQueue' | translate }}</span
            >
          </div>
          <span
            style="font-family: var(--font-mono); font-size: 14px; font-weight: 600; color: rgba(248,243,235,0.8)"
            >{{ nowLabel() }}</span
          >
        </div>

        <!-- Right: filter chip + user + language -->
        <div class="flex items-center" style="gap: 12px">
          <div
            class="flex items-center"
            style="height: 34px; padding: 0 12px; border: 1px solid #2A2523; border-radius: 8px; gap: 6px"
          >
            <span style="font-family: var(--font-sans); font-size: 13px; color: rgba(248,243,235,0.7)"
              >🕵 {{ 'kds.topbar.pickupsAll' | translate }}</span
            >
          </div>
          <app-language-switcher />
          <span style="font-family: var(--font-sans); font-size: 12px; color: rgba(248,243,235,0.55)">{{
            authStore.user()?.name ?? authStore.user()?.phone
          }}</span>
        </div>
      </header>

      <!-- Columns -->
      <main
        class="grid"
        class="kds-board-grid"
        style="grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 16px; flex: 1; min-height: 0; overflow-x: auto"
      >
        @for (col of columns; track col.key) {
          <section class="flex flex-col min-h-0">
            <!-- Column header chip -->
            <div
              class="flex items-center justify-between"
              [style.background]="columnMeta(col.key).accent"
              style="height: 40px; padding: 0 12px; border-radius: 10px; gap: 8px; margin-bottom: 12px"
            >
              <span
                class="flex items-center"
                style="font-family: var(--font-sans); font-size: 13px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; gap: 8px"
                [style.color]="columnMeta(col.key).accentText"
              >
                {{ columnMeta(col.key).label | translate }}
              </span>
              <span
                style="font-family: var(--font-sans); font-size: 12px; font-weight: 600"
                [style.color]="columnMeta(col.key).accentText"
                >{{ ordersFor(col.key).length }}</span
              >
            </div>

            <!-- Cards -->
            <div class="flex flex-col" style="gap: 12px; overflow-y: auto; padding-right: 4px">
              @for (order of ordersFor(col.key); track order.id) {
                <article
                  class="flex flex-col"
                  [style.border]="cardBorder(order)"
                  style="background: #1C1817; border-radius: 16px; padding: 16px; gap: 12px"
                >
                  <!-- Header row: big code + due timer -->
                  <div class="flex items-center justify-between">
                    <span
                      style="font-family: var(--font-mono); font-size: 36px; font-weight: 700; color: #F8F3EB; line-height: 1"
                      >{{ order.orderCode }}</span
                    >
                    <div class="flex flex-col items-end" style="gap: 4px">
                      <span
                        style="font-family: var(--font-mono); font-size: 18px; font-weight: 700"
                        [style.color]="dueColor(order)"
                        >{{ dueLabel(order) }}</span
                      >
                      <span
                        style="font-family: var(--font-sans); font-size: 10px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: rgba(248,243,235,0.6)"
                        >{{ order.pickupMode }}</span
                      >
                    </div>
                  </div>

                  <!-- Customer row -->
                  <div class="flex items-center justify-between">
                    <span style="font-family: var(--font-sans); font-size: 14px; color: #F8F3EB">
                      {{ order.customerName ?? ('kds.card.customer' | translate) }}
                    </span>
                    <span style="font-family: var(--font-sans); font-size: 12px; color: rgba(248,243,235,0.5)">
                      {{ 'kds.card.due' | translate: { time: pickupTime(order) } }}
                    </span>
                  </div>

                  <!-- Items -->
                  <ul class="flex flex-col" style="gap: 4px; margin: 0; padding: 0; list-style: none">
                    @for (item of order.items; track $index) {
                      <li
                        class="flex items-start justify-between"
                        style="font-family: var(--font-sans); font-size: 14px; color: rgba(248,243,235,0.85); gap: 12px"
                      >
                        <span>
                          <span style="color: var(--color-caramel); font-weight: 700">{{ item.quantity }}×</span>
                          {{ item.productSnapshot.name }}
                        </span>
                      </li>
                    }
                  </ul>

                  <!-- Notes -->
                  @if (order.notes) {
                    <div
                      style="background: #2A2523; border-radius: 10px; padding: 8px 12px; font-family: var(--font-sans); font-size: 12px; color: var(--color-amber)"
                    >
                      ⚠ {{ order.notes }}
                    </div>
                  }

                  <!-- Actions -->
                  <div class="flex" style="gap: 8px">
                    @for (action of actionsFor(order); track action.label) {
                      <button
                        type="button"
                        (click)="action.run()"
                        class="flex-1 flex items-center justify-center"
                        [style.background]="action.color"
                        style="height: 40px; color: white; border-radius: 10px; font-family: var(--font-sans); font-size: 14px; font-weight: 700"
                      >
                        {{ action.label | translate }}
                      </button>
                    }
                  </div>
                </article>
              } @empty {
                <div
                  class="flex items-center justify-center"
                  style="padding: 40px 0; font-family: var(--font-sans); font-size: 13px; color: rgba(248,243,235,0.3)"
                >
                  {{ 'kds.card.empty' | translate }}
                </div>
              }
            </div>
          </section>
        }
      </main>

      @if (error()) {
        <p style="padding: 8px 24px; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">
          {{ error() }}
        </p>
      }
    </div>
  `,
  styles: [
    `
      @media (max-width: 900px) {
        .kds-board-grid {
          grid-template-columns: repeat(3, minmax(260px, 1fr)) !important;
        }
      }
      @media (max-width: 600px) {
        .kds-board-grid {
          grid-template-columns: repeat(3, 280px) !important;
        }
      }
    `,
  ],
})
export class KdsBoardPage implements OnInit, OnDestroy {
  private readonly api = inject(KdsApi);
  private readonly storesApi = inject(StoresApi);
  private readonly realtime = inject(KdsRealtimeService);
  private readonly translate = inject(TranslateService);
  readonly authStore = inject(AuthStore);

  readonly columns: Array<{ key: Column }> = [{ key: 'NEW' }, { key: 'PREPARING' }, { key: 'READY' }];

  readonly stores = signal<StoreSummary[]>([]);
  readonly selectedStoreId = signal<string>('');
  readonly orders = signal<KdsOrder[]>([]);
  readonly now = signal(Date.now());
  readonly error = signal<string | null>(null);

  readonly openCount = computed(() => this.orders().length);
  readonly nowLabel = computed(() =>
    new Date(this.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  );

  private tickSub: Subscription | null = null;
  /** Safety-net slow poll (30 s). Primary refresh path is the WS subscription. */
  private pollSub: Subscription | null = null;
  private detachWs: (() => void) | null = null;

  ngOnInit(): void {
    this.storesApi.list().subscribe({
      next: (list) => {
        this.stores.set(list);
        const first = list[0];
        if (first) {
          this.selectedStoreId.set(first.id);
          this.refresh();
          this.wireRealtime(first.id);
        }
      },
    });
    this.tickSub = interval(1000).subscribe(() => this.now.set(Date.now()));
    this.pollSub = interval(30_000).subscribe(() => this.refresh());
  }

  ngOnDestroy(): void {
    this.tickSub?.unsubscribe();
    this.pollSub?.unsubscribe();
    this.detachWs?.();
  }

  onStoreChange(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    this.selectedStoreId.set(id);
    this.refresh();
    this.wireRealtime(id);
  }

  private wireRealtime(storeId: string): void {
    this.detachWs?.();
    this.detachWs = this.realtime.subscribeToStore(storeId, (event) => this.applyWsEvent(event));
  }

  private applyWsEvent(event: KdsOrderChanged): void {
    const OPEN: KdsOrderStatus[] = ['CREATED', 'PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY'];
    this.orders.update((list) => {
      if (event.kind === 'removed') {
        return list.filter((o) => o.id !== event.orderId);
      }
      if (!event.order) return list;
      const incoming = event.order as unknown as KdsOrder;
      // Drop closed orders, otherwise upsert by id.
      if (!OPEN.includes(incoming.status)) {
        return list.filter((o) => o.id !== incoming.id);
      }
      const exists = list.some((o) => o.id === incoming.id);
      return exists ? list.map((o) => (o.id === incoming.id ? incoming : o)) : [...list, incoming];
    });
  }

  ordersFor(col: Column): KdsOrder[] {
    return this.orders().filter((o) => COLUMN_STATUSES[col].includes(o.status));
  }

  columnMeta(col: Column) {
    return COLUMN_META[col];
  }

  dueLabel(order: KdsOrder): string {
    const diff = new Date(order.pickupAt).getTime() - this.now();
    const abs = Math.abs(Math.round(diff / 1000));
    const min = Math.floor(abs / 60);
    const sec = abs % 60;
    const sign = diff < 0 ? '−' : '';
    return `${sign}${min}:${String(sec).padStart(2, '0')}`;
  }

  pickupTime(order: KdsOrder): string {
    return new Date(order.pickupAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  dueColor(order: KdsOrder): string {
    const diff = (new Date(order.pickupAt).getTime() - this.now()) / 1000;
    if (order.status === 'READY') return 'var(--color-mint)';
    if (diff < 0) return 'var(--color-berry)';
    if (diff < 120) return 'var(--color-amber)';
    return '#F8F3EB';
  }

  cardBorder(order: KdsOrder): string {
    const diff = (new Date(order.pickupAt).getTime() - this.now()) / 1000;
    if (order.status === 'READY') return '1px solid var(--color-mint)';
    if (diff < 0) return '2px solid var(--color-berry)';
    if (diff < 120) return '1px solid var(--color-amber)';
    return '1px solid #2A2523';
  }

  actionsFor(order: KdsOrder): Array<{ label: string; color: string; run: () => void }> {
    const storeId = this.selectedStoreId();
    const handle = (obs: ReturnType<KdsApi['accept']>): void => {
      obs.subscribe({
        next: () => this.refresh(),
        error: (err) => this.error.set(this.extractMessage(err)),
      });
    };

    switch (order.status) {
      case 'CREATED':
      case 'PAID':
        return [
          {
            label: 'kds.card.actions.accept',
            color: 'var(--color-caramel)',
            run: () => handle(this.api.accept(storeId, order.id)),
          },
        ];
      case 'ACCEPTED':
        return [
          {
            label: 'kds.card.actions.start',
            color: 'var(--color-caramel)',
            run: () => handle(this.api.start(storeId, order.id)),
          },
        ];
      case 'IN_PROGRESS':
        return [
          {
            label: 'kds.card.actions.ready',
            color: 'var(--color-mint)',
            run: () => handle(this.api.ready(storeId, order.id)),
          },
        ];
      case 'READY':
        return [
          {
            label: 'kds.card.actions.pickedUp',
            color: '#3a3430',
            run: () => handle(this.api.pickedUp(storeId, order.id)),
          },
        ];
      default:
        return [];
    }
  }

  private refresh(): void {
    const storeId = this.selectedStoreId();
    if (!storeId) return;
    this.api.list(storeId).subscribe({
      next: (list) => this.orders.set(list),
      error: (err) => this.error.set(this.extractMessage(err)),
    });
  }

  private extractMessage(err: unknown): string {
    const maybe = err as { error?: { message?: unknown }; message?: unknown };
    if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
    if (typeof maybe.message === 'string') return maybe.message;
    return this.translate.instant('common.requestFailed');
  }
}
