import { Component, OnDestroy, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { CategoryKind, StoreDetail, StoreMenu } from '@takeaway/shared-types';
import { LeafletMapComponent, ProductImageComponent, type LatLng, type MapMarker } from '@takeaway/ui-kit';
import {
  buildDirectionsUrl,
  calendarDaysFrom,
  describeOrderItemOptions,
  expiredOutcome,
  formatCountdown,
  orderDueAt,
  orderWaitNote,
  phoneHref,
  productKind,
  readOrderItemSnapshot,
} from '@takeaway/utils';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { interval, take, timer, type Subscription } from 'rxjs';
import { LocaleFormatService, pickupDayLabel } from '@takeaway/i18n';

import { AuthStore } from '../../core/auth/auth.store';
import { CatalogService } from '../../core/catalog/catalog.service';
import { refreshStoresWhileVisible } from '../../core/catalog/live-store-refresh';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import {
  OrdersApi,
  type OrderPaymentState,
  type OrderStatusString,
  type OrderView,
} from '../../core/orders/orders.service';
import { WebPaymentApi } from '../../core/payments/web-payment.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';

interface StatusStep {
  key: OrderStatusString;
  /** Translation key — resolved in the template. */
  label: string;
  icon: string;
}

const STEPS: StatusStep[] = [
  { key: 'PAID', label: 'web.orderStatus.step.paid', icon: '✓' },
  { key: 'IN_PROGRESS', label: 'web.orderStatus.step.preparing', icon: '⏱' },
  { key: 'READY', label: 'web.orderStatus.step.ready', icon: '🛎' },
  { key: 'PICKED_UP', label: 'web.orderStatus.step.pickedUp', icon: '🏁' },
];

const STEP_ORDER: OrderStatusString[] = ['CREATED', 'PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY', 'PICKED_UP'];

/** What the bank said when it sent the customer back (`?payment=…`). */
type PaymentReturn = 'success' | 'pending' | 'fail';

/** Payment states where the order still waits for its money. */
const UNSETTLED: readonly OrderPaymentState[] = ['NONE', 'PENDING', 'FAILED'];

/**
 * From an hour away the page names the clock time («Будет готово к 09:15 ·
 * Завтра», «Заберёте в 09:15 завтра») instead of counting down; under it,
 * the countdown and «через N мин».
 */
const CLOCK_FROM_MS = 60 * 60_000;

/** Whole minutes left, rounded up: «через 1 мин» until the very end. */
function minutesIn(ms: number): number {
  return Math.ceil(ms / 60_000);
}

/** A translation key with its parameters, for the `translate` pipe. */
interface TextLine {
  key: string;
  params: Record<string, string | number>;
}

/** Why the customer can no longer cancel: the kitchen took the order, or the money is taken. */
type CancelBlock = 'ACCEPTED' | 'CHARGED';

/** How often, and how many times, to re-read an order whose payment is still being confirmed. */
const PAYMENT_POLL_MS = 3_000;
const PAYMENT_POLL_TIMES = 10;

function readPaymentReturn(value: string | null): PaymentReturn | null {
  return value === 'success' || value === 'pending' || value === 'fail' ? value : null;
}

@Component({
  selector: 'app-order-status',
  standalone: true,
  imports: [RouterLink, TranslatePipe, LeafletMapComponent, ProductImageComponent, ConfirmDialogComponent],
  host: { '(window:pageshow)': 'onPageShow($event)' },
  template: `
    @if (order(); as o) {
      <section class="max-w-3xl mx-auto px-6 py-10 flex flex-col items-center" style="gap: var(--spacing-lg)">
        <!-- Greeting -->
        <header class="text-center" style="margin-top: var(--spacing-sm)">
          @if (doneLines(); as done) {
            <!-- The product's promise kept: picked up without a queue. -->
            <h1
              class="text-4xl"
              style="font-family: var(--font-display); color: var(--color-espresso); font-weight: 600"
            >
              {{ done.title | translate }}
            </h1>
            <p
              class="mt-2"
              data-testid="order-slogan"
              style="font-family: var(--font-sans); font-size: 20px; color: var(--color-caramel)"
            >
              {{ done.slogan | translate }}
            </p>
          } @else {
            <h1
              class="text-4xl"
              style="font-family: var(--font-display); color: var(--color-espresso); font-weight: 600"
            >
              {{
                firstName()
                  ? ('web.orderStatus.greeting' | translate: { name: firstName() })
                  : ('web.orderStatus.greetingNoName' | translate)
              }}
            </h1>
            <p
              class="mt-2"
              data-testid="order-subtitle"
              style="font-family: var(--font-sans); font-size: 20px; color: var(--color-caramel)"
            >
              {{ heroLine().key | translate: heroLine().params }}
            </p>
          }
        </header>

        <!-- Where the money stands. The first thing a customer wants after
             tapping pay is confirmation that it worked; the order's own
             progress comes after that. -->
        <article
          class="w-full flex items-center"
          [style.background]="paymentBackground()"
          style="border-radius: 16px; padding: 14px 18px; gap: 12px"
        >
          <span style="font-size: 22px">{{ paymentIcon() }}</span>
          <div class="flex flex-col" style="gap: 2px; min-width: 0">
            <span
              style="font-family: var(--font-sans); font-size: 15px; font-weight: 600; color: var(--color-espresso)"
            >
              {{ paymentTitle() | translate }}
            </span>
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">
              {{ paymentDetail() }}
            </span>
            @if (paymentHint()) {
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">
                {{ paymentHint() | translate }}
              </span>
            }
          </div>
        </article>

        @if (canRetryPayment()) {
          <button
            type="button"
            data-testid="retry-payment"
            (click)="retryPayment()"
            [disabled]="retrying()"
            class="w-full flex items-center justify-center disabled:opacity-50"
            style="
              background: var(--color-caramel);
              color: var(--color-foam);
              height: 52px;
              border-radius: 16px;
              font-family: var(--font-sans); font-size: 16px; font-weight: 600;
            "
          >
            {{ (retrying() ? 'common.loading' : 'web.orderStatus.payment.retry') | translate }}
          </button>
        }
        @if (paymentError()) {
          <p class="text-sm text-center" style="margin: 0; color: var(--color-berry)">{{ paymentError() }}</p>
        }

        <!-- Timer Ring (300×300 circle, caramel-light fill) -->
        <div
          class="flex items-center justify-center rounded-full transition-colors"
          [style.background]="ringBackground()"
          [style.color]="ringTextColor()"
          style="width: 300px; height: 300px; margin-top: var(--spacing-base)"
        >
          @if (o.status === 'READY') {
            <span style="font-family: var(--font-display); font-size: 48px; font-weight: 700">{{
              'web.orderStatus.ready' | translate
            }}</span>
          } @else if (o.status === 'CANCELLED' || o.status === 'EXPIRED') {
            <span style="font-family: var(--font-display); font-size: 36px; font-weight: 600">{{
              'web.orderStatus.status.' + o.status | translate
            }}</span>
          } @else if (waitNote() === 'late') {
            <!-- Past its time: a frozen 0:00 reads like a broken page. -->
            <span
              data-testid="order-late"
              style="font-family: var(--font-display); font-size: 32px; font-weight: 600; text-align: center; padding: 0 32px"
              >{{ 'web.orderStatus.wait.late' | translate }}</span
            >
          } @else if (o.status === 'PICKED_UP') {
            <span style="font-family: var(--font-display); font-size: 40px; font-weight: 700">{{
              'web.orderStatus.thanks' | translate
            }}</span>
          } @else if (dueClock(); as clock) {
            <!-- An hour or more away (a pre-order for the morning): the time
                 on the store's clock, not «9:31:58» ticking down. -->
            <div class="flex flex-col items-center" data-testid="order-clock" style="gap: 4px">
              <span style="font-family: var(--font-sans); font-size: 16px; font-weight: 600; opacity: 0.75">{{
                'web.orderStatus.ring.readyBy' | translate
              }}</span>
              <span
                style="font-family: var(--font-sans); font-size: 80px; font-weight: 700; letter-spacing: -0.03em; line-height: 1"
                >{{ clock.time }}</span
              >
              <span style="font-family: var(--font-sans); font-size: 16px; font-weight: 600; opacity: 0.75">{{
                clockDay(clock)
              }}</span>
            </div>
          } @else {
            <div class="flex flex-col items-center" style="gap: 4px">
              <span
                data-testid="order-countdown"
                style="font-family: var(--font-sans); font-size: 96px; font-weight: 700; letter-spacing: -0.03em; line-height: 1"
              >
                {{ countdown() }}
              </span>
              <span style="font-family: var(--font-sans); font-size: 16px; font-weight: 600; opacity: 0.75">{{
                'web.orderStatus.ring.untilPickup' | translate
              }}</span>
            </div>
          }
        </div>

        <!-- The pickup code: what the customer says at the counter. The
             kitchen scans nothing, so there is no QR. -->
        @if (!isTerminal(o.status)) {
          <div
            data-testid="pickup-code"
            class="w-full flex flex-col items-center text-center"
            style="
              max-width: 360px; gap: 4px; padding: 18px 24px;
              background: var(--color-cream);
              border: 2px solid var(--color-caramel);
              border-radius: 20px;
            "
          >
            <span
              style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-secondary)"
              >{{ 'web.orderStatus.yourCode' | translate }}</span
            >
            <span
              style="font-family: var(--font-mono); font-size: 64px; font-weight: 700; line-height: 1.1; color: var(--color-espresso); letter-spacing: 0.06em"
              >{{ o.orderCode }}</span
            >
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
              'web.orderStatus.codeHint' | translate
            }}</span>
          </div>
        } @else {
          <span
            data-testid="pickup-code"
            style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)"
            >{{ 'web.orderStatus.codeLabel' | translate: { code: o.orderCode } }}</span
          >
        }

        <!-- The customer may already be at the counter: a way to reach the store. -->
        @if (storePhoneHref(); as tel) {
          @if (!isTerminal(o.status)) {
            <a
              [href]="tel"
              data-testid="call-store"
              class="w-full flex items-center justify-center"
              style="
                gap: 8px;
                background: var(--color-cream);
                color: var(--color-espresso);
                height: 48px;
                border-radius: 14px;
                border: 1px solid var(--color-border);
                font-family: var(--font-sans); font-size: 15px; font-weight: 600;
                text-decoration: none;
              "
              >📞 {{ 'web.orderStatus.callStore' | translate }}</a
            >
          }
        }

        <!-- Status Step List -->
        <ol class="w-full flex gap-3" style="padding: 0 var(--spacing-xl); margin-top: var(--spacing-sm)">
          @for (step of steps(); track step.key) {
            <li
              class="flex flex-col items-center justify-center text-center flex-1"
              style="height: 60px; border-radius: 12px; padding: 0 var(--spacing-sm);"
              [style.background]="step.background"
              [style.color]="step.color"
            >
              <span style="font-family: var(--font-sans); font-size: 13px; font-weight: 600">
                {{ step.icon }} {{ step.label | translate }}
              </span>
            </li>
          }
        </ol>

        <!-- Store info card -->
        <article
          class="w-full"
          style="
            background: var(--color-foam);
            border: 1px solid var(--color-border-light);
            border-radius: 16px;
            padding: var(--spacing-lg);
            display: flex; flex-direction: column; gap: var(--spacing-base);
          "
        >
          <div style="display: flex; flex-direction: column; gap: 4px">
            <span
              style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-espresso)"
            >
              📍 {{ o.storeName }}
            </span>
            @if (o.storeAddress) {
              <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">
                {{ o.storeAddress }}
              </span>
            }
            @if (pickupLine(); as line) {
              <span
                data-testid="pickup-when"
                style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
              >
                🚶 {{ line.key | translate: line.params }}
              </span>
            }
          </div>
          @if (hasStoreLocation()) {
            <div style="width: 100%; height: 200px; overflow: hidden; border-radius: 12px">
              <lib-leaflet-map [markers]="storeMarkers()" [userPosition]="userPos()" [interactive]="false" />
            </div>
          }
          <a
            [href]="mapsUrl()"
            target="_blank"
            rel="noopener"
            class="flex items-center justify-center"
            style="
              background: var(--color-caramel);
              color: var(--color-foam);
              height: 40px;
              border-radius: 12px;
              font-family: var(--font-sans); font-size: 14px; font-weight: 600;
              text-decoration: none;
            "
          >
            {{ (hasStoreLocation() ? 'common.map.buildRoute' : 'web.orderStatus.openMaps') | translate }}
          </a>
        </article>

        <!-- Primary CTA: I'm here -->
        @if (!isTerminal(o.status)) {
          <button
            type="button"
            (click)="imHere()"
            class="w-full flex items-center justify-center"
            style="
              background: var(--color-caramel);
              color: var(--color-foam);
              height: 56px;
              border-radius: 16px;
              font-family: var(--font-sans); font-size: 16px; font-weight: 600;
              transition: background 0.15s;
            "
          >
            {{ (imHereClicked() ? 'common.confirm' : 'web.orderStatus.iAmHere') | translate }}
          </button>
        }

        <!-- Cancel: only before the kitchen accepts and while no money is
             taken. After that, the store decides — the customer calls. -->
        @if (canCancel()) {
          <button
            type="button"
            data-testid="cancel-order"
            (click)="confirmingCancel.set(true)"
            [disabled]="cancelling()"
            class="w-full flex items-center justify-center disabled:opacity-50"
            style="
              background: var(--color-cream);
              color: var(--color-espresso);
              height: 48px;
              border-radius: 14px;
              border: 1px solid var(--color-border);
              font-family: var(--font-sans); font-size: 14px; font-weight: 500;
            "
          >
            {{ (cancelling() ? 'web.orderStatus.cancel.cancelling' : 'web.orderStatus.cancelOrder') | translate }}
          </button>
        } @else if (cancelNote(); as note) {
          <div
            role="status"
            data-testid="cancel-note"
            class="w-full flex flex-col items-center text-center"
            style="gap: 8px; padding: 12px 16px; border-radius: 14px; background: var(--color-cream); border: 1px solid var(--color-border-light)"
          >
            <span style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)">{{
              note | translate
            }}</span>
            @if (storePhoneHref(); as tel) {
              <a
                [href]="tel"
                data-testid="cancel-call-store"
                style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-caramel); text-decoration: none"
                >📞 {{ 'web.orderStatus.callStore' | translate }}</a
              >
            }
          </div>
        }
        @if (cancelError()) {
          <p
            role="alert"
            data-testid="cancel-error"
            class="text-sm text-center"
            style="margin: 0; color: var(--color-berry)"
          >
            {{ cancelError() }}
          </p>
        }
        @if (confirmingCancel()) {
          <app-confirm-dialog
            [title]="'web.orderStatus.cancel.confirmTitle' | translate: { code: o.orderCode }"
            [body]="'web.orderStatus.cancel.confirmBody' | translate"
            [confirmLabel]="
              (cancelling() ? 'web.orderStatus.cancel.cancelling' : 'web.orderStatus.cancel.confirm') | translate
            "
            [dismissLabel]="'web.orderStatus.cancel.keep' | translate"
            [busy]="cancelling()"
            (confirmed)="cancel()"
            (dismissed)="confirmingCancel.set(false)"
          />
        }

        <!-- What was ordered, as the kitchen will make it -->
        @if (lines().length > 0) {
          <article
            class="w-full"
            style="
              background: var(--color-foam);
              border: 1px solid var(--color-border-light);
              border-radius: 16px;
              padding: var(--spacing-lg);
              display: flex; flex-direction: column; gap: 12px;
            "
          >
            <span
              style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-espresso)"
            >
              {{ 'web.orderStatus.yourOrder' | translate }}
            </span>
            @for (line of lines(); track line.id) {
              <div class="flex items-start" style="gap: 12px">
                <lib-product-image
                  [src]="line.imageUrl"
                  [kind]="line.kind"
                  alt=""
                  style="flex: none; width: 40px; height: 40px; border-radius: 10px"
                />
                <div class="flex flex-col flex-1" style="gap: 2px; min-width: 0">
                  <div class="flex items-start justify-between" style="gap: 12px">
                    <span style="font-family: var(--font-sans); font-size: 14px; color: var(--color-espresso)">
                      {{ line.quantity }} × {{ line.name }}
                    </span>
                    <span
                      style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-espresso); white-space: nowrap"
                    >
                      {{ price(line.totalCents) }}
                    </span>
                  </div>
                  @if (line.options) {
                    <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
                      line.options
                    }}</span>
                  }
                  @if (line.notes) {
                    <span
                      style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); font-style: italic"
                      >“{{ line.notes }}”</span
                    >
                  }
                </div>
              </div>
            }
            <div style="height: 1px; background: var(--color-border-light)"></div>
            <div class="flex items-center justify-between">
              <span
                style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-espresso)"
                >{{ 'common.total' | translate }}</span
              >
              <span
                style="font-family: var(--font-sans); font-size: 15px; font-weight: 700; color: var(--color-caramel)"
                >{{ price(o.totalCents) }}</span
              >
            </div>
          </article>
        }

        <a routerLink="/menu" class="text-sm mt-2 underline" style="color: var(--color-text-secondary)">
          {{ 'web.orderStatus.backToMenu' | translate }}
        </a>
      </section>
    }

    @if (error()) {
      <p class="mt-6 text-center text-sm" style="color: var(--color-berry)">{{ error() }}</p>
    }
  `,
})
export class OrderStatusPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly orders = inject(OrdersApi);
  private readonly realtime = inject(RealtimeService);
  private readonly authStore = inject(AuthStore);
  private readonly fmt = inject(LocaleFormatService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly flags = inject(FeatureFlagsStore);
  private readonly catalog = inject(CatalogService);
  private readonly webPayments = inject(WebPaymentApi);

  readonly order = signal<OrderView | null>(null);
  /** The bank's verdict from the return redirect; read once, then dropped from the URL. */
  readonly paymentReturn = signal<PaymentReturn | null>(null);
  /** Re-reading the order while the bank's confirmation is on its way. */
  readonly polling = signal(false);
  readonly retrying = signal(false);
  readonly paymentError = signal<string | null>(null);
  private pollSub: Subscription | null = null;
  readonly error = signal<string | null>(null);
  readonly now = signal(Date.now());
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

  private detachSocket: (() => void) | null = null;
  private tickSub: Subscription | null = null;

  readonly firstName = computed(() => {
    const name = this.authStore.user()?.name ?? '';
    return name.split(/\s+/)[0] ?? '';
  });

  /**
   * Headline and slogan once the order is ready or picked up — «Ваш заказ
   * готов. Вы простояли в очереди 0 минут» — in place of the greeting.
   * Translation keys.
   */
  readonly doneLines = computed(() => {
    const status = this.order()?.status;
    if (status === 'READY') return { title: 'common.orderDone.readyTitle', slogan: 'common.orderDone.readySlogan' };
    if (status === 'PICKED_UP') {
      return { title: 'common.orderDone.pickedUpTitle', slogan: 'common.orderDone.pickedUpSlogan' };
    }
    return null;
  });

  /**
   * The store as it is now: its phone for «Позвонить в точку», and whether
   * it is open, for a pre-order waiting on the morning.
   */
  readonly store = signal<StoreDetail | null>(null);
  private readonly loadStore = effect(() => {
    const storeId = this.storeId();
    if (storeId) untracked(() => this.fetchStore(storeId));
  });

  /** A `tel:` link to the store, when it gave a phone number. */
  readonly storePhoneHref = computed(() => phoneHref(this.store()?.phone));

  /** «Ждём подтверждения точки», «Немного задерживаемся» … — see `orderWaitNote`. */
  readonly waitNote = computed(() => {
    const o = this.order();
    return o ? orderWaitNote(o, this.store(), new Date(this.now())) : null;
  });

  /**
   * The line under the greeting, as a translation key and its parameters:
   * why an expired order ended, what the wait is about («Немного
   * задерживаемся» only once the due time has passed), the kitchen's new
   * estimate once it took the order late, else the status.
   */
  readonly heroLine = computed((): TextLine => {
    const order = this.order();
    if (!order) return { key: '', params: {} };
    if (order.status === 'EXPIRED') return { key: `web.orderStatus.expired.${expiredOutcome(order)}`, params: {} };
    const wait = this.waitNote();
    if (wait) return { key: `web.orderStatus.wait.${wait}`, params: {} };
    const estimate = this.estimateLine();
    if (estimate) return estimate;
    switch (order.status) {
      case 'CREATED':
      case 'PAID':
      case 'ACCEPTED':
      case 'IN_PROGRESS':
      case 'READY':
      case 'PICKED_UP':
      case 'CANCELLED':
        return { key: `web.orderStatus.status.${order.status}`, params: {} };
      default:
        return { key: '', params: {} };
    }
  });

  /**
   * «Готовим · будет готово через 8 мин» (or «к 12:10»): the kitchen
   * accepted or started the order too late for its promise and gave a new
   * time (`readyEstimateAt`), which has not passed yet.
   */
  private readonly estimateLine = computed((): TextLine | null => {
    const o = this.order();
    if (!o?.readyEstimateAt || (o.status !== 'ACCEPTED' && o.status !== 'IN_PROGRESS')) return null;
    const left = this.dueInMs();
    if (left <= 0) return null;
    if (left < CLOCK_FROM_MS) return { key: 'web.orderStatus.estimate.inMinutes', params: { min: minutesIn(left) } };
    return { key: 'web.orderStatus.estimate.at', params: { time: this.pickupClock(new Date(orderDueAt(o))) } };
  });

  /**
   * The customer-facing payment state, defaulting to "nothing to pay here" for
   * an order placed before the API started reporting it.
   */
  readonly paymentState = computed<OrderPaymentState>(() => this.order()?.payment?.state ?? 'NONE');

  /**
   * The bank said the payment failed, but our record may still read "waiting":
   * believe the bank until the order shows otherwise.
   */
  private readonly bankSaidFail = computed(
    () => this.paymentReturn() === 'fail' && (this.paymentState() === 'NONE' || this.paymentState() === 'PENDING'),
  );

  readonly paymentTitle = computed(() => {
    if (this.bankSaidFail()) return 'web.orderStatus.payment.failed';
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
      default: {
        // Nothing on a new order yet means its card has not gone through; on
        // one that ended without being made, that nothing was taken (a hold
        // is released to nothing). Only orders from before card-only checkout
        // were paid at the counter.
        const status = this.order()?.status;
        if (status === 'CREATED') return 'web.orderStatus.payment.awaiting';
        if (status === 'EXPIRED' || status === 'CANCELLED') return 'web.orderStatus.payment.notCharged';
        return 'web.orderStatus.payment.atCounter';
      }
    }
  });

  /** The concrete numbers under the title: amount and, when known, the card. */
  readonly paymentDetail = computed(() => {
    const payment = this.order()?.payment;
    if (!payment || payment.state === 'NONE') return '';
    const amount = this.price(payment.amountCents);
    return payment.cardMask ? `${amount} · ${payment.cardMask}` : amount;
  });

  /** A line under the numbers saying what happens next, as a translation key. */
  readonly paymentHint = computed(() => {
    if (this.paymentState() === 'HELD') return 'web.orderStatus.payment.heldHint';
    if (this.canRetryPayment() && (this.bankSaidFail() || this.paymentState() === 'FAILED')) {
      return 'web.orderStatus.payment.retryHint';
    }
    return '';
  });

  /**
   * Paying again on the bank's page: only in the Web-платёж flow, only while
   * the order is new and its money has not arrived, and not while we are
   * still waiting for the bank to confirm a payment the customer just made.
   */
  readonly canRetryPayment = computed(() => {
    const o = this.order();
    if (!o || o.status !== 'CREATED' || !this.flags.webPaymentsEnabled()) return false;
    if (!UNSETTLED.includes(this.paymentState())) return false;
    return !this.polling();
  });

  readonly paymentIcon = computed(() => {
    if (this.bankSaidFail()) return '⚠️';
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

  readonly paymentBackground = computed(() => {
    if (this.bankSaidFail()) return 'var(--color-berry-light, var(--color-cream))';
    switch (this.paymentState()) {
      case 'PAID':
        return 'var(--color-mint-light, var(--color-cream))';
      case 'FAILED':
        return 'var(--color-berry-light, var(--color-cream))';
      default:
        return 'var(--color-cream)';
    }
  });

  /** The store's clock: the order's own zone, else the store's as loaded. */
  private readonly timeZone = computed(() => this.order()?.storeTimezone ?? this.store()?.timezone ?? null);

  /**
   * Milliseconds until the order is due — the kitchen's new estimate when it
   * gave one, else the promised time (`orderDueAt`). Negative once passed.
   */
  readonly dueInMs = computed(() => {
    const o = this.order();
    if (!o) return 0;
    const due = Date.parse(orderDueAt(o));
    return Number.isFinite(due) ? due - this.now() : 0;
  });

  /** «4:05» until the order is due, under an hour away. */
  readonly countdown = computed(() => formatCountdown(this.dueInMs()));

  /**
   * An hour or more away: the due time on the store's clock and how many
   * calendar days off it is, for «Будет готово к 09:15 · Завтра» in the
   * circle. Null closer than that, when the circle counts down.
   */
  readonly dueClock = computed<{ time: string; days: number; at: string } | null>(() => {
    const o = this.order();
    if (!o || this.dueInMs() < CLOCK_FROM_MS) return null;
    const at = orderDueAt(o);
    const zone = this.timeZone();
    return { time: this.fmt.time(at, zone), days: calendarDaysFrom(at, new Date(this.now()), zone), at };
  });

  /** «Сегодня», «Завтра» or the date under the clock time. */
  clockDay(clock: { days: number; at: string }): string {
    return pickupDayLabel(clock.days, clock.at, this.translate, this.fmt, this.timeZone());
  }

  /**
   * Beside the store's address: «Заберёте примерно через 8 мин», or from an
   * hour away «Заберёте в 09:15 завтра». Nothing once it is ready or over.
   */
  readonly pickupLine = computed((): TextLine | null => {
    const o = this.order();
    const left = this.dueInMs();
    if (!o || left <= 0 || o.status === 'READY' || this.isTerminal(o.status)) return null;
    if (left < CLOCK_FROM_MS) return { key: 'web.orderStatus.pickupIn', params: { min: minutesIn(left) } };
    return { key: 'web.orderStatus.pickupAt', params: { time: this.pickupClock(new Date(orderDueAt(o))) } };
  });

  /**
   * The store's menu, for each line's photo or placeholder: an order line
   * keeps no picture of its own. A product gone from the menu since gets
   * the neutral placeholder.
   */
  private readonly menu = signal<StoreMenu | null>(null);
  private readonly storeId = computed(() => this.order()?.storeId ?? null);

  constructor() {
    // A store that opens (or closes) while the customer watches changes what
    // a pre-order is waiting for.
    refreshStoresWhileVisible((event) => {
      const storeId = this.storeId();
      if (storeId && (!event || event.storeId === storeId)) this.fetchStore(storeId);
    });
  }

  private fetchStore(storeId: string): void {
    this.catalog.getStore(storeId).subscribe({
      next: (store) => {
        if (store.id === this.storeId()) this.store.set(store);
      },
      error: () => undefined,
    });
  }
  private readonly loadMenu = effect(() => {
    const storeId = this.storeId();
    if (!storeId) return;
    untracked(() =>
      this.catalog.getMenu(storeId).subscribe({ next: (menu) => this.menu.set(menu), error: () => undefined }),
    );
  });

  /** Each product's photo and kind, by product id. */
  private readonly looks = computed(() => {
    const looks = new Map<string, { src: string | null; kind: CategoryKind }>();
    for (const category of this.menu()?.categories ?? []) {
      for (const product of category.products) {
        looks.set(product.id, { src: product.imageUrls[0] ?? null, kind: productKind(product, category) });
      }
    }
    return looks;
  });

  /** The order's lines with their size, milk and extras spelled out. */
  readonly lines = computed(() =>
    (this.order()?.items ?? []).map((item) => {
      const snap = readOrderItemSnapshot(item.productSnapshot);
      const look = this.looks().get(snap.id);
      return {
        id: item.id,
        name: snap.name,
        imageUrl: look?.src ?? null,
        kind: look?.kind ?? null,
        quantity: item.quantity,
        totalCents: item.totalCents,
        options: describeOrderItemOptions(snap),
        notes: snap.notes,
      };
    }),
  );

  /** The confirm dialog is open. */
  readonly confirmingCancel = signal(false);
  readonly cancelling = signal(false);
  readonly cancelError = signal<string | null>(null);
  /** The API refused a cancel (409 `ORDER_NOT_CANCELLABLE`) — believed even before the re-read lands. */
  private readonly cancelRefused = signal<CancelBlock | null>(null);

  /**
   * «Отменить заказ» — only before the kitchen accepts and while no money is
   * taken: `canCancel` from the API, and CREATED or PAID from one that
   * predates it.
   */
  readonly canCancel = computed(() => {
    const o = this.order();
    if (!o || this.cancelRefused()) return false;
    if (o.status !== 'CREATED' && o.status !== 'PAID') return false;
    return o.canCancel ?? true;
  });

  /** Why there is no cancel button on an order still in work, if there is a reason to say. */
  private readonly cancelBlock = computed<CancelBlock | null>(() => {
    const status = this.order()?.status;
    if (status === 'ACCEPTED' || status === 'IN_PROGRESS') return 'ACCEPTED';
    if ((status === 'CREATED' || status === 'PAID') && !this.canCancel()) return this.cancelRefused() ?? 'CHARGED';
    return null;
  });

  /** «Заказ уже готовят — для отмены позвоните в точку», as a translation key. */
  readonly cancelNote = computed(() => {
    const block = this.cancelBlock();
    if (!block) return null;
    const call = this.storePhoneHref() !== null;
    if (block === 'ACCEPTED') {
      return call ? 'web.orderStatus.cancel.acceptedCall' : 'web.orderStatus.cancel.acceptedNoPhone';
    }
    return call ? 'web.orderStatus.cancel.chargedCall' : 'web.orderStatus.cancel.chargedNoPhone';
  });

  readonly steps = computed(() => {
    const status = this.order()?.status ?? 'CREATED';
    const activeIdx = STEP_ORDER.indexOf(status);
    return STEPS.map((step) => {
      const stepIdx = STEP_ORDER.indexOf(step.key);
      const completed = stepIdx < activeIdx;
      const current = stepIdx === activeIdx || (step.key === 'PAID' && status === 'CREATED');
      const { background, color } = this.stepStyle(completed, current);
      return { ...step, background, color };
    });
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set(this.translate.instant('web.orderStatus.notFound'));
      return;
    }

    this.flags.load();
    const returned = readPaymentReturn(this.route.snapshot.queryParamMap.get('payment'));
    if (returned) {
      this.paymentReturn.set(returned);
      // A reload should not replay the bank's verdict over a newer state.
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { payment: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }

    this.orders.get(id).subscribe({
      next: (o) => {
        this.order.set(o);
        if (returned === 'success' || returned === 'pending') this.pollWhileUnconfirmed(id);
      },
      error: () => this.error.set(this.translate.instant('web.orderStatus.notFound')),
    });

    this.detachSocket = this.realtime.subscribeToOrder(id, (event) => {
      this.order.update((current) => (current ? { ...current, status: event.status } : current));
      // The store accepting the order is also when a hold turns into a real
      // debit, and that only lives on the order itself — so re-read it rather
      // than patching the status alone.
      this.orders.get(id).subscribe({ next: (o) => this.order.set(o), error: () => undefined });
    });

    this.tickSub = interval(1000).subscribe(() => this.now.set(Date.now()));

    // Best-effort customer position for the pickup map — silent on denial.
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => this.userPos.set({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => undefined,
        { enableHighAccuracy: true, timeout: 8_000, maximumAge: 30_000 },
      );
    }
  }

  ngOnDestroy(): void {
    this.detachSocket?.();
    this.tickSub?.unsubscribe();
    this.pollSub?.unsubscribe();
  }

  /**
   * Back from the bank while its notification may still be on its way: re-read
   * the order a few times until the money shows as held (or the order moves
   * on), then give up quietly — realtime still brings later changes.
   */
  private pollWhileUnconfirmed(id: string): void {
    if (!this.awaitingConfirmation()) return;
    this.polling.set(true);
    this.pollSub?.unsubscribe();
    this.pollSub = timer(PAYMENT_POLL_MS, PAYMENT_POLL_MS)
      .pipe(take(PAYMENT_POLL_TIMES))
      .subscribe({
        next: () =>
          this.orders.get(id).subscribe({
            next: (o) => {
              this.order.set(o);
              if (!this.awaitingConfirmation()) this.stopPolling();
            },
            error: () => undefined,
          }),
        complete: () => this.polling.set(false),
      });
  }

  private awaitingConfirmation(): boolean {
    const state = this.paymentState();
    return this.order()?.status === 'CREATED' && (state === 'NONE' || state === 'PENDING');
  }

  private stopPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = null;
    this.polling.set(false);
  }

  /**
   * Another go on the bank's page for this same order. No page back means the
   * money arrived in the meantime, so just show the order as it is now.
   */
  retryPayment(): void {
    const o = this.order();
    if (!o || this.retrying()) return;
    this.retrying.set(true);
    this.paymentError.set(null);
    this.webPayments.start(o.id).subscribe({
      next: (res) => {
        if (res.page) {
          // `retrying` stays on: the browser is on its way to the bank.
          this.webPayments.redirectToBank(res.page);
          return;
        }
        this.retrying.set(false);
        this.paymentReturn.set(null);
        this.orders.get(o.id).subscribe({ next: (fresh) => this.order.set(fresh), error: () => undefined });
      },
      error: (err) => {
        this.retrying.set(false);
        this.paymentError.set(this.errorText(err));
      },
    });
  }

  /**
   * Coming back from the bank with the browser's Back button can restore this
   * page from the back-forward cache with the retry button still spinning.
   */
  onPageShow(event: PageTransitionEvent): void {
    if (event.persisted) this.retrying.set(false);
  }

  private errorText(err: unknown): string {
    if ((err as { status?: unknown } | null)?.status === 0) return this.translate.instant('common.networkError');
    const raw = ((err as { error?: unknown } | null)?.error as { message?: unknown } | null)?.message;
    const message = Array.isArray(raw) ? raw.join(', ') : raw;
    return typeof message === 'string' && message ? message : this.translate.instant('common.requestFailed');
  }

  /**
   * The customer confirmed the cancel. Refused because the kitchen accepted
   * it or the money is taken (409 `ORDER_NOT_CANCELLABLE`): the order is
   * read again and the page says to call the store. Any other failure keeps
   * the button for another try.
   */
  cancel(): void {
    const o = this.order();
    if (!o || this.cancelling()) return;
    this.cancelling.set(true);
    this.cancelError.set(null);
    this.orders.cancel(o.id).subscribe({
      next: (updated) => {
        this.cancelling.set(false);
        this.confirmingCancel.set(false);
        this.order.set(updated);
      },
      error: (err) => {
        this.cancelling.set(false);
        this.confirmingCancel.set(false);
        const failure = err as { status?: unknown; error?: { code?: unknown; reason?: unknown } | null } | null;
        if (failure?.error?.code === 'ORDER_NOT_CANCELLABLE' || failure?.status === 409) {
          this.cancelRefused.set(failure.error?.reason === 'CHARGED' ? 'CHARGED' : 'ACCEPTED');
        } else {
          this.cancelError.set(
            this.translate.instant(failure?.status === 0 ? 'common.networkError' : 'web.orderStatus.cancel.failed'),
          );
        }
        this.orders.get(o.id).subscribe({ next: (fresh) => this.order.set(fresh), error: () => undefined });
      },
    });
  }

  /** «09:15», or «09:15 завтра» for a time on the store's next calendar day. */
  private pickupClock(date: Date): string {
    const zone = this.timeZone();
    const time = this.fmt.time(date, zone);
    return calendarDaysFrom(date, new Date(this.now()), zone) === 1
      ? this.translate.instant('common.pickupDay.timeTomorrow', { time })
      : time;
  }

  imHere(): void {
    const o = this.order();
    if (!o) return;
    this.imHereClicked.set(true);

    const send = (lat: number, lng: number) =>
      this.orders.reportLocation(o.id, { lat, lng, iAmHere: true }).subscribe({
        error: () => {
          // Soft fallback: keep the button "confirmed" — the staff already
          // see the order via realtime, so a transport blip shouldn't make
          // the UI feel broken to the customer.
        },
      });

    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => send(pos.coords.latitude, pos.coords.longitude),
        // No coords (permission denied / timeout) — still record the
        // explicit "I'm here" tap by sending zeros + iAmHere flag; the
        // server's iAmHere short-circuit treats it as HERE regardless of
        // distance.
        () => send(0, 0),
        { enableHighAccuracy: true, timeout: 8_000, maximumAge: 30_000 },
      );
    } else {
      send(0, 0);
    }
  }

  price(cents: number): string {
    return this.fmt.money(cents, this.order()?.currency ?? this.authStore.user()?.currency);
  }

  isTerminal(status: OrderStatusString): boolean {
    return status === 'PICKED_UP' || status === 'CANCELLED' || status === 'EXPIRED';
  }

  ringBackground(): string {
    const status = this.order()?.status;
    if (status === 'READY') return 'var(--color-mint)';
    if (status === 'CANCELLED' || status === 'EXPIRED') return 'var(--color-latte)';
    if (status === 'PICKED_UP') return 'var(--color-caramel-light)';
    return 'var(--color-caramel-light)';
  }

  ringTextColor(): string {
    const status = this.order()?.status;
    if (status === 'READY') return 'var(--color-foam)';
    if (status === 'PICKED_UP') return 'var(--color-caramel)';
    return 'var(--color-espresso)';
  }

  mapsUrl(): string {
    const o = this.order();
    if (o && this.hasStoreLocation()) {
      return buildDirectionsUrl({ lat: o.storeLatitude, lng: o.storeLongitude });
    }
    // Fallback when the store has no coordinates yet — search by name.
    return `https://maps.google.com/?q=${encodeURIComponent(o?.storeName ?? '')}`;
  }

  private stepStyle(completed: boolean, current: boolean): { background: string; color: string } {
    if (completed || current) {
      return { background: 'var(--color-caramel)', color: 'var(--color-foam)' };
    }
    // Upcoming steps fade from caramel-light → latte as distance grows.
    return { background: 'var(--color-latte)', color: 'var(--color-text-secondary)' };
  }
}
