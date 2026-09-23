import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LeafletMapComponent, type LatLng, type MapMarker } from '@takeaway/ui-kit';
import { buildDirectionsUrl, describeOrderItemOptions, readOrderItemSnapshot } from '@takeaway/utils';
import { interval, type Subscription } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';

import {
  OrdersApi,
  type OrderPaymentState,
  type OrderStatusString,
  type OrderView,
} from '../../core/orders/orders.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';

/**
 * TMA Order Status — pencil e48T5.
 *
 * tosContent (centered vertical, padding 24, gap 24):
 *   tosIllus     — 120px caramel-light circle with big emoji
 *   tosStatusTx  — Fraunces 28/700 two-line status label
 *   tosTimerRow  — countdown + code badge
 *   tosTL        — 4-row timeline (Paid / Accepted / Ready / Picked up)
 */
@Component({
  selector: 'app-tma-order-status',
  standalone: true,
  imports: [TranslatePipe, LeafletMapComponent],
  template: `
    @if (order(); as o) {
      <section
        style="padding: 24px; padding-bottom: 32px; display: flex; flex-direction: column; align-items: center; gap: 24px"
      >
        <!-- Illustration -->
        <div
          class="flex items-center justify-center"
          [style.background]="isReady() ? 'var(--color-mint)' : 'var(--color-caramel-light)'"
          style="width: 120px; height: 120px; border-radius: 9999px; font-size: 52px"
        >
          {{ illustrationEmoji(o.status) }}
        </div>

        <h1
          style="font-family: var(--font-display); font-size: 28px; font-weight: 700; line-height: 1.2; color: var(--color-espresso); text-align: center; white-space: pre-line; margin: 0"
        >
          {{ statusLabel(o.status) | translate }}
        </h1>

        <!-- Where the money stands: the first thing a customer looks for
             after paying, before any of the order's own progress. -->
        <div
          class="flex items-center"
          [style.background]="paymentBackground()"
          style="border-radius: 14px; padding: 10px 14px; gap: 8px"
        >
          <span style="font-size: 18px">{{ paymentIcon() }}</span>
          <span style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-espresso)">
            {{ paymentTitle() | translate }}
          </span>
          @if (paymentDetail()) {
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">
              {{ paymentDetail() }}
            </span>
          }
        </div>

        <!-- Timer + code -->
        <div class="flex items-center" style="gap: 12px">
          @if (isReady()) {
            <span style="font-family: var(--font-mono); font-size: 40px; font-weight: 700; color: var(--color-mint)">{{
              o.orderCode
            }}</span>
          } @else if (o.status === 'CANCELLED' || o.status === 'EXPIRED') {
            <span style="font-family: var(--font-sans); font-size: 15px; color: var(--color-text-secondary)">{{
              'tma.orderStatus.orderClosed' | translate
            }}</span>
          } @else {
            <span
              style="font-family: var(--font-mono); font-size: 40px; font-weight: 700; color: var(--color-caramel)"
              >{{ countdown() }}</span
            >
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
              'web.orderStatus.codeLabel' | translate: { code: o.orderCode }
            }}</span>
          }
        </div>

        <!-- Timeline -->
        <div class="flex flex-col w-full" style="gap: 12px">
          @for (step of timelineSteps; track step.key) {
            <div
              class="flex items-center"
              style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 14px; padding: 14px 16px; gap: 12px"
            >
              <span
                class="flex items-center justify-center"
                [style.background]="isStepDone(o.status, step.key) ? 'var(--color-mint)' : 'var(--color-border-light)'"
                [style.color]="isStepDone(o.status, step.key) ? 'white' : 'var(--color-text-tertiary)'"
                style="width: 28px; height: 28px; border-radius: 9999px; font-size: 13px; font-weight: 700"
              >
                {{ isStepDone(o.status, step.key) ? '✓' : step.idx }}
              </span>
              <span
                style="font-family: var(--font-sans); font-size: 14px; font-weight: 500; color: var(--color-text-primary)"
                >{{ step.label | translate }}</span
              >
            </div>
          }
        </div>

        @if (!isTerminal(o.status)) {
          <button
            type="button"
            (click)="imHere()"
            class="w-full flex items-center justify-center"
            style="background: var(--color-caramel); color: var(--color-foam); height: 52px; border-radius: 14px; font-family: var(--font-sans); font-size: 15px; font-weight: 600; margin-top: 4px"
          >
            {{ (imHereClicked() ? 'common.confirm' : 'web.orderStatus.iAmHere') | translate }}
          </button>
        }

        <!-- Order summary -->
        <section class="w-full flex flex-col" style="gap: 12px; margin-top: 12px">
          <h2
            style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 1px; margin: 0"
          >
            {{ o.storeName.toUpperCase() }}
          </h2>
          <div
            class="flex flex-col"
            style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 14px; padding: 16px; gap: 10px"
          >
            @for (line of lines(); track line.id) {
              <div class="flex flex-col" style="gap: 2px">
                <div class="flex items-start justify-between" style="gap: 12px">
                  <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-primary)"
                    >{{ line.quantity }} × {{ line.name }}</span
                  >
                  <span
                    style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); white-space: nowrap"
                    >{{ price(line.totalCents) }}</span
                  >
                </div>
                @if (line.options) {
                  <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)">{{
                    line.options
                  }}</span>
                }
                @if (line.notes) {
                  <span
                    style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary); font-style: italic"
                    >“{{ line.notes }}”</span
                  >
                }
              </div>
            }
            <hr style="border: none; border-top: 1px solid var(--color-border-light); margin: 0" />
            <div class="flex items-center justify-between">
              <span
                style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
                >{{ 'common.total' | translate }}</span
              >
              <span
                style="font-family: var(--font-sans); font-size: 15px; font-weight: 700; color: var(--color-caramel)"
                >{{ price(o.totalCents) }}</span
              >
            </div>
          </div>
        </section>

        <!-- Pickup location -->
        @if (hasStoreLocation()) {
          <section class="w-full flex flex-col" style="gap: 12px">
            <h2
              style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 1px; margin: 0"
            >
              {{ 'common.map.pickupLocation' | translate }}
            </h2>
            <div style="width: 100%; height: 180px; overflow: hidden; border-radius: 14px">
              <lib-leaflet-map [markers]="storeMarkers()" [userPosition]="userPos()" [interactive]="false" />
            </div>
            <button
              type="button"
              (click)="openRoute()"
              class="w-full flex items-center justify-center"
              style="background: var(--color-caramel); color: var(--color-foam); height: 48px; border-radius: 14px; font-family: var(--font-sans); font-size: 15px; font-weight: 600"
            >
              {{ 'common.map.buildRoute' | translate }}
            </button>
          </section>
        }
      </section>
    }
  `,
})
export class TmaOrderStatusPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly orders = inject(OrdersApi);
  private readonly realtime = inject(RealtimeService);
  private readonly tg = inject(TelegramBridgeService);

  readonly order = signal<OrderView | null>(null);
  readonly now = signal(Date.now());

  /** The order's lines with their size, milk and extras spelled out. */
  readonly lines = computed(() =>
    (this.order()?.items ?? []).map((item) => {
      const snap = readOrderItemSnapshot(item.productSnapshot);
      return {
        id: item.id,
        name: snap.name,
        quantity: item.quantity,
        totalCents: item.totalCents,
        options: describeOrderItemOptions(snap),
        notes: snap.notes,
      };
    }),
  );
  readonly imHereClicked = signal(false);
  readonly userPos = signal<LatLng | null>(null);

  readonly hasStoreLocation = computed(() => {
    const o = this.order();
    return !!o && (o.storeLatitude !== 0 || o.storeLongitude !== 0);
  });

  readonly storeMarkers = computed<MapMarker[]>(() => {
    const o = this.order();
    if (!o || !this.hasStoreLocation()) return [];
    return [{ id: o.storeId, lat: o.storeLatitude, lng: o.storeLongitude, label: o.storeName, kind: 'store' }];
  });

  // Labels are translation keys — resolved with | translate in the template.
  readonly timelineSteps = [
    { idx: 1, key: 'PAID' as OrderStatusString, label: 'web.orderStatus.status.PAID' },
    { idx: 2, key: 'ACCEPTED' as OrderStatusString, label: 'web.orderStatus.status.ACCEPTED' },
    { idx: 3, key: 'READY' as OrderStatusString, label: 'web.orderStatus.status.READY' },
    { idx: 4, key: 'PICKED_UP' as OrderStatusString, label: 'web.orderStatus.status.PICKED_UP' },
  ];

  private tickSub: Subscription | null = null;
  private detachSocket: (() => void) | null = null;
  private detachBack: (() => void) | null = null;

  readonly paymentState = computed<OrderPaymentState>(() => this.order()?.payment?.state ?? 'NONE');

  readonly paymentTitle = computed(() => {
    switch (this.paymentState()) {
      case 'PAID':
        return 'web.orderStatus.payment.paid';
      case 'HELD':
        return 'web.orderStatus.payment.held';
      case 'PENDING':
        return 'web.orderStatus.payment.pending';
      case 'FAILED':
        return 'web.orderStatus.payment.failed';
      case 'REFUNDED':
        return 'web.orderStatus.payment.refunded';
      default:
        return 'web.orderStatus.payment.atCounter';
    }
  });

  readonly paymentDetail = computed(() => {
    const payment = this.order()?.payment;
    if (!payment || payment.state === 'NONE') return '';
    const currency = this.order()?.currency ?? 'USD';
    const amount = new Intl.NumberFormat('en', { style: 'currency', currency }).format(payment.amountCents / 100);
    return payment.cardMask ? `${amount} · ${payment.cardMask}` : amount;
  });

  readonly paymentIcon = computed(() => {
    switch (this.paymentState()) {
      case 'PAID':
        return '✅';
      case 'HELD':
        return '🔒';
      case 'FAILED':
        return '⚠️';
      case 'REFUNDED':
        return '↩️';
      default:
        return '💳';
    }
  });

  readonly paymentBackground = computed(() =>
    this.paymentState() === 'PAID' ? 'var(--color-mint-light, var(--color-foam))' : 'var(--color-foam)',
  );

  readonly countdown = computed(() => {
    const o = this.order();
    if (!o) return '0:00';
    const diff = Math.max(0, new Date(o.pickupAt).getTime() - this.now());
    const min = Math.floor(diff / 60_000);
    const sec = Math.floor((diff % 60_000) / 1000);
    return `${min}:${String(sec).padStart(2, '0')}`;
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;

    this.orders.get(id).subscribe({ next: (o) => this.order.set(o) });

    this.detachSocket = this.realtime.subscribeToOrder(id, (event) => {
      this.order.update((current) => (current ? { ...current, status: event.status } : current));
      if (event.status === 'READY') this.tg.haptic('heavy');
      // Accepting the order is also when a hold becomes a real debit, and that
      // only shows on the order itself — so re-read it rather than the status.
      this.orders.get(id).subscribe({ next: (o) => this.order.set(o), error: () => undefined });
    });

    this.tickSub = interval(1000).subscribe(() => this.now.set(Date.now()));
    this.detachBack = this.tg.setBackButton(() => void this.router.navigate(['/']));

    // Best-effort customer position for the pickup map — silent on denial.
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => this.userPos.set({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => undefined,
        { enableHighAccuracy: true, timeout: 8_000, maximumAge: 30_000 },
      );
    }
  }

  openRoute(): void {
    const o = this.order();
    if (!o || !this.hasStoreLocation()) return;
    this.tg.haptic('light');
    window.open(buildDirectionsUrl({ lat: o.storeLatitude, lng: o.storeLongitude }), '_blank');
  }

  ngOnDestroy(): void {
    this.tickSub?.unsubscribe();
    this.detachSocket?.();
    this.detachBack?.();
  }

  /** Returns a translation key — resolved via | translate in the template. */
  statusLabel(status: OrderStatusString): string {
    return `web.orderStatus.status.${status}`;
  }

  isReady(): boolean {
    return this.order()?.status === 'READY';
  }

  illustrationEmoji(status: OrderStatusString): string {
    if (status === 'READY') return '✅';
    if (status === 'CANCELLED' || status === 'EXPIRED') return '✖';
    if (status === 'PICKED_UP') return '🎉';
    if (status === 'IN_PROGRESS') return '☕';
    return '⏱';
  }

  isTerminal(status: OrderStatusString): boolean {
    return status === 'PICKED_UP' || status === 'CANCELLED' || status === 'EXPIRED';
  }

  imHere(): void {
    const o = this.order();
    if (!o) return;
    this.imHereClicked.set(true);
    this.tg.haptic('medium');
    const send = (lat: number, lng: number) =>
      this.orders.reportLocation(o.id, { lat, lng, iAmHere: true }).subscribe({ error: () => undefined });
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => send(pos.coords.latitude, pos.coords.longitude),
        () => send(0, 0),
        { enableHighAccuracy: true, timeout: 8_000, maximumAge: 30_000 },
      );
    } else {
      send(0, 0);
    }
  }

  isStepDone(current: OrderStatusString, step: OrderStatusString): boolean {
    const order: OrderStatusString[] = ['CREATED', 'PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY', 'PICKED_UP'];
    const ci = order.indexOf(current);
    const si = order.indexOf(step);
    if (ci < 0 || si < 0) return false;
    return ci >= si;
  }

  price(cents: number): string {
    const currency = this.order()?.currency ?? 'USD';
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
  }
}
