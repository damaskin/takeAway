import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import type { OrderItemSnapshot } from '@takeaway/shared-types';
import { readOrderItemSnapshot } from '@takeaway/utils';
import { interval } from 'rxjs';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi } from '../../core/catalog/admin-catalog.service';
import { apiErrorMessage } from '../../core/http/api-error';
import {
  KITCHEN_COLUMNS,
  type KitchenColumn,
  applyKitchenEvent,
  inColumn,
  nextAction,
} from '../../core/kitchen/kitchen-board';
import { KitchenApi, type KitchenAction, type KitchenOrder } from '../../core/kitchen/kitchen.api';
import { KitchenRealtimeService } from '../../core/kitchen/kitchen-realtime.service';
import type { KitchenStore } from '../../core/kitchen/order-alerts.service';

/** One line of a ticket: how many, and exactly what goes in the cup. */
type TicketLine = OrderItemSnapshot & { quantity: number };

const STORE_KEY = 'takeaway.admin.kitchenStoreId';

const COLUMN_META: Record<KitchenColumn, { label: string; tint: string; text: string }> = {
  NEW: { label: 'kds.cols.new', tint: 'var(--color-caramel-light)', text: 'var(--color-caramel)' },
  PREPARING: { label: 'kds.cols.preparing', tint: '#E9A84B26', text: '#8A6720' },
  READY: { label: 'kds.cols.ready', tint: '#7BC4A433', text: '#3E8868' },
};

const ACTION_META: Record<KitchenAction, { label: string; color: string }> = {
  accept: { label: 'kds.card.actions.accept', color: 'var(--color-caramel)' },
  start: { label: 'kds.card.actions.start', color: 'var(--color-caramel)' },
  ready: { label: 'kds.card.actions.ready', color: '#3E8868' },
  pickedUp: { label: 'kds.card.actions.pickedUp', color: 'var(--color-espresso)' },
};

/**
 * The kitchen board inside the cabinet — what the standalone KDS app was:
 * three columns, one button per ticket moving it on, live over the socket
 * with a slow poll as a safety net.
 *
 * "Accept" goes through `POST /kds/orders/:id/accept`, the same call the
 * tablet made, so a card that was only held at checkout is charged there
 * and a refusal leaves the ticket where it was, with the bank's reason on it.
 */
@Component({
  selector: 'app-kitchen',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <section class="kitchen">
      <header class="kitchen-head">
        <div class="flex flex-col" style="gap: 4px">
          <h1 class="kitchen-title">{{ 'admin.kitchen.title' | translate }}</h1>
          <p class="kitchen-subtitle">{{ 'admin.kitchen.subtitle' | translate }}</p>
        </div>
        <div class="flex items-center flex-wrap" style="gap: 12px">
          @if (stores().length > 1) {
            <label class="flex items-center" style="gap: 6px">
              <span class="kitchen-caption">{{ 'admin.kitchen.store' | translate }}</span>
              <select class="kitchen-select" [value]="storeId()" (change)="pickStore($any($event.target).value)">
                @for (s of stores(); track s.id) {
                  <option [value]="s.id">{{ s.name }}</option>
                }
              </select>
            </label>
          } @else if (store(); as s) {
            <span class="kitchen-store">{{ s.name }}</span>
          }
          <span class="kitchen-queue">
            <strong>{{ orders().length }}</strong> {{ 'kds.topbar.inQueue' | translate }}
          </span>
          <span class="kitchen-clock">{{ clock() }}</span>
          <span
            class="kitchen-live"
            [class.kitchen-live-off]="!realtime.connected()"
            [title]="(realtime.connected() ? 'admin.kitchen.live' : 'admin.kitchen.offline') | translate"
          ></span>
        </div>
      </header>

      @if (error()) {
        <p class="kitchen-error" role="alert">{{ error() }}</p>
      }

      @if (loaded() && stores().length === 0) {
        <p class="kitchen-empty-state">{{ 'admin.kitchen.noStores' | translate }}</p>
      } @else {
        <div class="kitchen-grid">
          @for (col of columns; track col) {
            <section class="kitchen-col" [attr.aria-label]="meta(col).label | translate">
              <div class="kitchen-col-head" [style.background]="meta(col).tint" [style.color]="meta(col).text">
                <span>{{ meta(col).label | translate }}</span>
                <span>{{ ordersIn(col).length }}</span>
              </div>
              <div class="kitchen-cards">
                @for (order of ordersIn(col); track order.id) {
                  <article class="kitchen-card" [style.border]="cardBorder(order)">
                    <div class="flex items-center justify-between">
                      <span class="kitchen-code">{{ order.orderCode }}</span>
                      <div class="flex flex-col items-end" style="gap: 2px">
                        <span class="kitchen-due" [style.color]="dueColor(order)">{{ dueLabel(order) }}</span>
                        <span class="kitchen-mode">{{ 'kds.card.pickupMode.' + order.pickupMode | translate }}</span>
                      </div>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="kitchen-customer">{{
                        order.customerName ?? ('kds.card.customer' | translate)
                      }}</span>
                      <span class="kitchen-muted">{{ 'kds.card.due' | translate: { time: pickupTime(order) } }}</span>
                    </div>
                    <ul class="kitchen-lines">
                      @for (line of ticket(order); track $index) {
                        <li class="flex flex-col" style="gap: 4px">
                          <div class="flex items-baseline" style="gap: 8px">
                            <span class="kitchen-qty">{{ line.quantity }}×</span>
                            <span class="kitchen-item">{{ line.name }}</span>
                          </div>
                          @if (line.variations.length > 0) {
                            <div class="flex flex-wrap kitchen-indent" style="gap: 6px">
                              @for (v of line.variations; track v.id) {
                                <span class="kitchen-chip">{{ v.name }}</span>
                              }
                            </div>
                          }
                          @for (m of line.modifierLines; track m.id) {
                            <span class="kitchen-indent kitchen-modifier">
                              + {{ m.name }}
                              @if (m.count > 1) {
                                <strong style="color: var(--color-caramel)">×{{ m.count }}</strong>
                              }
                            </span>
                          }
                          @if (line.notes) {
                            <div class="kitchen-indent kitchen-note">✎ {{ line.notes }}</div>
                          }
                        </li>
                      }
                    </ul>
                    @if (order.notes) {
                      <div class="kitchen-note">⚠ {{ order.notes }}</div>
                    }
                    @if (failures()[order.id]; as reason) {
                      <p class="kitchen-card-error" role="alert">{{ reason }}</p>
                    }
                    @if (actionOf(order); as action) {
                      <button
                        type="button"
                        class="kitchen-action"
                        [style.background]="actionMeta(action).color"
                        [disabled]="busy().has(order.id)"
                        (click)="run(action, order)"
                      >
                        {{ (busy().has(order.id) ? 'admin.kitchen.working' : actionMeta(action).label) | translate }}
                      </button>
                    }
                  </article>
                } @empty {
                  <p class="kitchen-empty">{{ 'kds.card.empty' | translate }}</p>
                }
              </div>
            </section>
          }
        </div>
      }
    </section>
  `,
  styles: [
    `
      .kitchen {
        padding: clamp(16px, 3vw, 28px);
        display: flex;
        flex-direction: column;
        gap: 16px;
        font-family: var(--font-sans);
      }
      .kitchen-head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
      }
      .kitchen-title {
        font-family: var(--font-display);
        font-size: 28px;
        font-weight: 700;
        color: var(--color-espresso);
        margin: 0;
      }
      .kitchen-subtitle,
      .kitchen-muted {
        font-size: 13px;
        color: var(--color-text-secondary);
        margin: 0;
      }
      .kitchen-caption {
        font-size: 11px;
        color: var(--color-text-tertiary);
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }
      .kitchen-select {
        height: 36px;
        padding: 0 10px;
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: 10px;
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
        min-width: 160px;
      }
      .kitchen-store {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-secondary);
      }
      .kitchen-queue {
        height: 32px;
        padding: 0 12px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 9999px;
        background: var(--color-caramel);
        color: white;
        font-size: 12px;
      }
      .kitchen-clock {
        font-family: var(--font-mono);
        font-size: 15px;
        font-weight: 600;
        color: var(--color-text-secondary);
      }
      .kitchen-live {
        width: 10px;
        height: 10px;
        border-radius: 9999px;
        background: var(--color-mint);
      }
      .kitchen-live-off {
        background: var(--color-berry);
      }
      .kitchen-error,
      .kitchen-card-error {
        margin: 0;
        font-size: 13px;
        color: var(--color-berry);
      }
      .kitchen-empty-state {
        padding: 40px 0;
        text-align: center;
        color: var(--color-text-secondary);
      }
      .kitchen-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(260px, 1fr));
        gap: 16px;
        overflow-x: auto;
      }
      .kitchen-col {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-width: 0;
      }
      .kitchen-col-head {
        height: 40px;
        padding: 0 12px;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
      }
      .kitchen-cards {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .kitchen-card {
        background: var(--color-foam);
        border-radius: 16px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .kitchen-code {
        font-family: var(--font-mono);
        font-size: 32px;
        font-weight: 700;
        line-height: 1;
        color: var(--color-espresso);
      }
      .kitchen-due {
        font-family: var(--font-mono);
        font-size: 18px;
        font-weight: 700;
      }
      .kitchen-mode {
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        color: var(--color-text-tertiary);
      }
      .kitchen-customer {
        font-size: 14px;
        color: var(--color-text-primary);
      }
      .kitchen-lines {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .kitchen-qty {
        min-width: 32px;
        font-family: var(--font-mono);
        font-size: 17px;
        font-weight: 700;
        color: var(--color-caramel);
      }
      .kitchen-item {
        font-size: 16px;
        font-weight: 700;
        color: var(--color-text-primary);
        line-height: 1.2;
      }
      .kitchen-indent {
        padding-left: 40px;
      }
      .kitchen-chip {
        padding: 2px 10px;
        border-radius: 9999px;
        background: var(--color-surface-variant);
        font-size: 14px;
        font-weight: 700;
        color: var(--color-text-primary);
      }
      .kitchen-modifier {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-secondary);
      }
      .kitchen-note {
        padding: 6px 10px;
        border-radius: 8px;
        border-left: 3px solid var(--color-amber);
        background: rgba(233, 168, 75, 0.14);
        font-size: 13px;
        font-weight: 600;
        color: #8a6720;
      }
      .kitchen-indent.kitchen-note {
        margin-left: 40px;
        padding-left: 10px;
      }
      .kitchen-action {
        height: 42px;
        border-radius: 10px;
        color: white;
        font-size: 14px;
        font-weight: 700;
      }
      .kitchen-action:disabled {
        opacity: 0.6;
        cursor: progress;
      }
      .kitchen-empty {
        padding: 32px 0;
        text-align: center;
        font-size: 13px;
        color: var(--color-text-tertiary);
        margin: 0;
      }
    `,
  ],
})
export class KitchenPage {
  private readonly api = inject(KitchenApi);
  private readonly catalog = inject(AdminCatalogApi);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly translate = inject(TranslateService);
  private readonly fmt = inject(LocaleFormatService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly realtime = inject(KitchenRealtimeService);

  readonly columns = KITCHEN_COLUMNS;
  readonly stores = signal<KitchenStore[]>([]);
  readonly storeId = signal<string | null>(null);
  readonly orders = signal<KitchenOrder[]>([]);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  readonly busy = signal<ReadonlySet<string>>(new Set());
  /** Why the last action on a ticket failed — a declined card, most often. */
  readonly failures = signal<Readonly<Record<string, string>>>({});
  readonly now = signal(Date.now());

  readonly store = computed(() => this.stores().find((s) => s.id === this.storeId()) ?? null);
  readonly clock = computed(() => this.fmt.time(this.now(), this.store()?.timezone));

  /** Read once per board change rather than on every one-second tick. */
  private readonly tickets = computed(
    () =>
      new Map(
        this.orders().map((o) => [
          o.id,
          o.items.map<TicketLine>((i) => ({ ...readOrderItemSnapshot(i.productSnapshot), quantity: i.quantity })),
        ]),
      ),
  );

  private detach: (() => void) | null = null;

  constructor() {
    interval(1000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.now.set(Date.now()));
    interval(30_000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.refresh());

    // The stores follow the brand picked in the header.
    effect(() => {
      const brandId = this.activeBrand.activeId();
      if (!brandId) return;
      untracked(() => this.loadStores(brandId));
    });
    // Board and socket room follow the store.
    effect(() => {
      const storeId = this.storeId();
      untracked(() => this.follow(storeId));
    });
    this.destroyRef.onDestroy(() => this.detach?.());
  }

  pickStore(id: string): void {
    if (!this.stores().some((s) => s.id === id)) return;
    remember(id);
    this.storeId.set(id);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { store: id }, replaceUrl: true });
  }

  ordersIn(column: KitchenColumn): KitchenOrder[] {
    return this.orders().filter((o) => inColumn(o, column));
  }

  ticket(order: KitchenOrder): TicketLine[] {
    return this.tickets().get(order.id) ?? [];
  }

  meta(column: KitchenColumn) {
    return COLUMN_META[column];
  }

  actionOf(order: KitchenOrder): KitchenAction | null {
    return nextAction(order);
  }

  actionMeta(action: KitchenAction) {
    return ACTION_META[action];
  }

  run(action: KitchenAction, order: KitchenOrder): void {
    const storeId = this.storeId();
    if (!storeId || this.busy().has(order.id)) return;
    this.busy.update((set) => new Set(set).add(order.id));
    this.failures.update((map) => {
      const next = { ...map };
      delete next[order.id];
      return next;
    });
    const done = () =>
      this.busy.update((set) => {
        const next = new Set(set);
        next.delete(order.id);
        return next;
      });
    this.api.run(action, storeId, order.id).subscribe({
      next: () => {
        done();
        this.refresh();
      },
      error: (err) => {
        done();
        this.failures.update((map) => ({
          ...map,
          [order.id]: apiErrorMessage(err, this.translate, {
            network: 'common.networkError',
            statuses: { 403: 'common.forbidden', 404: 'admin.kitchen.errors.gone' },
          }),
        }));
        this.refresh();
      },
    });
  }

  dueLabel(order: KitchenOrder): string {
    const diff = new Date(order.pickupAt).getTime() - this.now();
    const abs = Math.abs(Math.round(diff / 1000));
    const sign = diff < 0 ? '−' : '';
    return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
  }

  pickupTime(order: KitchenOrder): string {
    return this.fmt.time(order.pickupAt, this.store()?.timezone);
  }

  dueColor(order: KitchenOrder): string {
    const diff = (new Date(order.pickupAt).getTime() - this.now()) / 1000;
    if (order.status === 'READY') return '#3E8868';
    if (diff < 0) return 'var(--color-berry)';
    if (diff < 120) return '#8A6720';
    return 'var(--color-text-primary)';
  }

  cardBorder(order: KitchenOrder): string {
    const diff = (new Date(order.pickupAt).getTime() - this.now()) / 1000;
    if (order.status === 'READY') return '1px solid var(--color-mint)';
    if (diff < 0) return '2px solid var(--color-berry)';
    if (diff < 120) return '1px solid var(--color-amber)';
    return '1px solid var(--color-border-light)';
  }

  private loadStores(brandId: string): void {
    this.catalog.listStores(brandId).subscribe({
      next: (rows) => {
        const stores = rows.map((s) => ({ id: s.id, name: s.name, timezone: s.timezone ?? null }));
        this.stores.set(stores);
        this.loaded.set(true);
        this.error.set(null);
        const wanted = [this.route.snapshot.queryParamMap.get('store'), this.storeId(), remembered()];
        const start = wanted.map((id) => stores.find((s) => s.id === id)).find(Boolean) ?? stores[0] ?? null;
        this.storeId.set(start?.id ?? null);
      },
      error: (err) => {
        this.loaded.set(true);
        this.error.set(apiErrorMessage(err, this.translate, { network: 'common.networkError' }));
      },
    });
  }

  private follow(storeId: string | null): void {
    this.detach?.();
    this.detach = null;
    this.orders.set([]);
    this.failures.set({});
    if (!storeId) return;
    this.refresh();
    this.detach = this.realtime.watch(storeId, (event) => {
      const next = applyKitchenEvent(this.orders(), event);
      if (next) this.orders.set(next);
      else this.refresh();
    });
  }

  private refresh(): void {
    const storeId = this.storeId();
    if (!storeId) return;
    this.api.list(storeId).subscribe({
      next: (list) => {
        if (this.storeId() !== storeId) return;
        this.orders.set(list);
        this.error.set(null);
      },
      error: (err) => this.error.set(apiErrorMessage(err, this.translate, { network: 'common.networkError' })),
    });
  }
}

function remembered(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

function remember(id: string): void {
  try {
    localStorage.setItem(STORE_KEY, id);
  } catch {
    // Storage-disabled browsers: the board still works, it just forgets.
  }
}
