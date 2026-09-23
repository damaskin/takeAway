import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { CartChangedError, PickupSlot } from '@takeaway/shared-types';
import { computeTax, isCartChangedError } from '@takeaway/utils';
import { checkoutErrorText, LocaleFormatService } from '@takeaway/i18n';

import { TmaAuthStore } from '../../core/auth/tma-auth.store';
import { CartService, type CartView } from '../../core/cart/cart.service';
import { ActiveStoreService } from '../../core/catalog/active-store.service';
import { CatalogService } from '../../core/catalog/catalog.service';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { DeliveryFeeApi } from '../../core/orders/delivery-fee.service';
import { OrdersApi } from '../../core/orders/orders.service';
import { type BoundCard, PaymentCardsApi, PaymentCardsStore } from '../../core/payments/payment-cards.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';

type FulfillmentType = 'PICKUP' | 'DELIVERY';

/**
 * TMA Checkout — pencil u5mrZ.
 *
 * tcContent (gap 20):
 *   pickupSec  — ASAP / Scheduled toggle + time
 *   storeSec   — foam card with store name and address
 *   orderSec   — order lines + totals
 *   promo      — foam input for promo codes (stubbed)
 *   paySec     — payment method select (Apple/Google/Card stub)
 * MainButton (Telegram blue) fires placeOrder with current pickup mode.
 */
@Component({
  selector: 'app-tma-checkout',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  template: `
    <section style="padding: 16px; padding-bottom: 100px; display: flex; flex-direction: column; gap: 20px">
      <h1
        style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        {{ 'tma.checkout.title' | translate }}
      </h1>

      <!-- Fulfillment type (PICKUP / DELIVERY) — hidden if store doesn't offer delivery -->
      @if (deliveryAvailable()) {
        <div class="flex flex-col" style="gap: 12px">
          <span
            style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-primary)"
            >{{ 'tma.checkout.fulfillment' | translate }}</span
          >
          <div class="flex" style="gap: 8px">
            <button
              type="button"
              (click)="setFulfillment('PICKUP')"
              class="flex-1"
              [style.background]="fulfillmentType() === 'PICKUP' ? 'var(--color-caramel)' : 'var(--color-foam)'"
              [style.color]="fulfillmentType() === 'PICKUP' ? 'white' : 'var(--color-text-primary)'"
              [style.border]="
                fulfillmentType() === 'PICKUP' ? '1px solid transparent' : '1px solid var(--color-border-light)'
              "
              style="height: 44px; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600"
            >
              {{ 'tma.checkout.fulfillmentPickup' | translate }}
            </button>
            <button
              type="button"
              (click)="setFulfillment('DELIVERY')"
              class="flex-1"
              [style.background]="fulfillmentType() === 'DELIVERY' ? 'var(--color-caramel)' : 'var(--color-foam)'"
              [style.color]="fulfillmentType() === 'DELIVERY' ? 'white' : 'var(--color-text-primary)'"
              [style.border]="
                fulfillmentType() === 'DELIVERY' ? '1px solid transparent' : '1px solid var(--color-border-light)'
              "
              style="height: 44px; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600"
            >
              {{ 'tma.checkout.fulfillmentDelivery' | translate }}
            </button>
          </div>
        </div>
      }

      <!-- Pickup / delivery time — works for both fulfillment types -->
      <div class="flex flex-col" style="gap: 12px">
        <span
          style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-primary)"
          >{{
            (fulfillmentType() === 'DELIVERY' ? 'tma.checkout.deliveryWhen' : 'tma.checkout.pickupWhen') | translate
          }}</span
        >
        <div class="flex" style="gap: 8px">
          <button
            type="button"
            (click)="setPickup('ASAP')"
            [disabled]="!storeOpen()"
            [style.opacity]="storeOpen() ? 1 : 0.45"
            class="flex-1"
            [style.background]="pickupMode() === 'ASAP' ? 'var(--color-caramel)' : 'var(--color-foam)'"
            [style.color]="pickupMode() === 'ASAP' ? 'white' : 'var(--color-text-primary)'"
            [style.border]="pickupMode() === 'ASAP' ? '1px solid transparent' : '1px solid var(--color-border-light)'"
            style="height: 44px; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600"
          >
            {{ 'tma.checkout.asap' | translate: { min: etaMinutes() } }}
          </button>
          <button
            type="button"
            (click)="setPickup('SCHEDULED')"
            class="flex-1"
            [style.background]="pickupMode() === 'SCHEDULED' ? 'var(--color-caramel)' : 'var(--color-foam)'"
            [style.color]="pickupMode() === 'SCHEDULED' ? 'white' : 'var(--color-text-primary)'"
            [style.border]="
              pickupMode() === 'SCHEDULED' ? '1px solid transparent' : '1px solid var(--color-border-light)'
            "
            style="height: 44px; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600"
          >
            {{ 'tma.checkout.schedule' | translate }}
          </button>
        </div>
        @if (!storeOpen()) {
          <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
            'tma.checkout.closedNow' | translate
          }}</span>
        }
        @if (pickupMode() === 'SCHEDULED') {
          @if (slotsLoading()) {
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
              'common.loading' | translate
            }}</span>
          } @else if (slots().length === 0) {
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">{{
              (storeOpen() ? 'tma.checkout.noSlots' : 'tma.checkout.noSlotsClosed') | translate
            }}</span>
          } @else {
            <div class="flex flex-wrap" style="gap: 8px">
              @for (slot of slots(); track slot.startsAt) {
                <button
                  type="button"
                  [disabled]="!slot.available"
                  (click)="selectSlot(slot)"
                  [style.background]="scheduledAt() === slot.startsAt ? 'var(--color-caramel)' : 'var(--color-foam)'"
                  [style.color]="
                    slot.available
                      ? scheduledAt() === slot.startsAt
                        ? 'white'
                        : 'var(--color-text-primary)'
                      : 'var(--color-text-secondary)'
                  "
                  [style.border]="
                    scheduledAt() === slot.startsAt ? '1px solid transparent' : '1px solid var(--color-border-light)'
                  "
                  [style.opacity]="slot.available ? '1' : '0.45'"
                  [style.textDecoration]="slot.available ? 'none' : 'line-through'"
                  style="height: 36px; padding: 0 14px; border-radius: 999px; font-family: var(--font-sans); font-size: 13px; font-weight: 600"
                >
                  {{ slotLabel(slot) }}
                </button>
              }
            </div>
          }
        }
      </div>

      <!-- Delivery address form -->
      @if (fulfillmentType() === 'DELIVERY') {
        <div
          class="flex flex-col"
          style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 14px; padding: 16px; gap: 12px"
        >
          <span
            style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-primary)"
            >{{ 'tma.checkout.deliveryAddressLabel' | translate }}</span
          >
          <input
            type="text"
            autocomplete="street-address"
            [ngModel]="deliveryAddress()"
            (ngModelChange)="deliveryAddress.set($event); refreshMainButton()"
            name="deliveryAddress"
            [placeholder]="'tma.checkout.deliveryAddressPlaceholder' | translate"
            style="height: 44px; padding: 0 14px; background: var(--color-cream); border: 1px solid var(--color-border-light); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary); outline: none"
          />
          <input
            type="text"
            autocomplete="address-level2"
            [ngModel]="deliveryCity()"
            (ngModelChange)="deliveryCity.set($event); refreshMainButton()"
            name="deliveryCity"
            [placeholder]="'tma.checkout.deliveryCityPlaceholder' | translate"
            style="height: 44px; padding: 0 14px; background: var(--color-cream); border: 1px solid var(--color-border-light); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary); outline: none"
          />
          <input
            type="text"
            [ngModel]="deliveryNotes()"
            (ngModelChange)="deliveryNotes.set($event)"
            name="deliveryNotes"
            [placeholder]="'tma.checkout.deliveryNotesPlaceholder' | translate"
            style="height: 44px; padding: 0 14px; background: var(--color-cream); border: 1px solid var(--color-border-light); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary); outline: none"
          />
          <div class="flex items-center flex-wrap" style="gap: 8px">
            <button
              type="button"
              (click)="requestLocation()"
              [disabled]="locating()"
              class="flex items-center disabled:opacity-50"
              style="height: 36px; padding: 0 14px; background: var(--color-cream); border: 1px solid var(--color-border-light); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-text-primary)"
            >
              📍
              {{
                (customerLat() !== null ? 'tma.checkout.deliveryGeolocateRetry' : 'tma.checkout.deliveryGeolocate')
                  | translate
              }}
            </button>
            @if (deliveryDistanceM() !== null) {
              <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
                'tma.checkout.deliveryDistance' | translate: { km: formatKm(deliveryDistanceM()!) }
              }}</span>
            }
          </div>
          <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); margin: 0">
            {{ 'tma.checkout.deliveryFeeHint' | translate: { fee: price(deliveryFeeCents()) } }}
          </span>
          @if (deliveryReason()) {
            <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-berry); margin: 0">{{
              deliveryReason()
            }}</span>
          }
        </div>
      }

      <!-- Store card -->
      @if (cart(); as c) {
        <div
          class="flex flex-col"
          style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 14px; padding: 16px; gap: 8px"
        >
          <span
            style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-primary)"
            >{{ 'tma.checkout.location' | translate }}</span
          >
          <span style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)">
            {{ storeName() }}
          </span>
          <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">
            {{ 'tma.checkout.readyIn' | translate: { min: etaMinutes() } }}
          </span>
        </div>

        <!-- Order lines -->
        <div class="flex flex-col" style="gap: 12px">
          <span
            style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-primary)"
            >{{ 'tma.checkout.yourOrder' | translate }}</span
          >
          @if (c.items.length === 0) {
            <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
              {{ 'tma.checkout.empty' | translate }}
            </p>
          } @else {
            <div
              class="flex flex-col"
              style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 14px; padding: 16px; gap: 12px"
            >
              @for (item of c.items; track item.id) {
                <div class="flex items-start justify-between" style="gap: 12px">
                  <span
                    class="flex-1"
                    style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)"
                    >{{ item.quantity }} × {{ item.productName }}</span
                  >
                  <span
                    style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
                    >{{ price(item.unitPriceCents * item.quantity) }}</span
                  >
                </div>
              }
              <hr style="border: none; border-top: 1px solid var(--color-border-light); margin: 0" />
              @if (fulfillmentType() === 'DELIVERY') {
                <div class="flex items-center justify-between">
                  <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
                    'tma.checkout.deliveryFeeRow' | translate
                  }}</span>
                  <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
                    price(deliveryFeeCents())
                  }}</span>
                </div>
              }
              @if (taxCents(c.subtotalCents) > 0) {
                <div class="flex items-center justify-between">
                  <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
                    (taxIncluded() ? 'common.taxIncluded' : 'common.tax') | translate
                  }}</span>
                  <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
                    price(taxCents(c.subtotalCents))
                  }}</span>
                </div>
              }
              <div class="flex items-center justify-between">
                <span
                  style="font-family: var(--font-sans); font-size: 15px; font-weight: 600; color: var(--color-text-primary)"
                  >{{ 'common.total' | translate }}</span
                >
                <span
                  style="font-family: var(--font-sans); font-size: 18px; font-weight: 700; color: var(--color-caramel)"
                  >{{ price(totalCents(c.subtotalCents)) }}</span
                >
              </div>
            </div>
          }
        </div>
      }

      <!-- Payment method (Agroprombank card) -->
      @if (cardPaymentsEnabled()) {
        <div class="flex flex-col" style="gap: 10px">
          <span
            style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-primary)"
            >{{ 'tma.checkout.paymentMethod' | translate }}</span
          >
          @if (cards().length === 0) {
            <button
              type="button"
              (click)="goToCards()"
              class="flex items-center"
              style="background: var(--color-foam); border: 1px dashed var(--color-border-light); border-radius: var(--radius-input); padding: 0 14px; height: 48px; gap: 8px"
            >
              <span style="font-size: 16px">💳</span>
              <span
                class="flex-1 text-left"
                style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)"
                >{{ 'tma.checkout.addCard' | translate }}</span
              >
              <span style="color: var(--color-text-tertiary); font-size: 16px">›</span>
            </button>
          } @else {
            <div
              class="flex flex-col"
              style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 16px; overflow: hidden"
            >
              @for (card of cards(); track card.id; let last = $last) {
                <button
                  type="button"
                  (click)="selectCard(card)"
                  class="flex items-center"
                  [style.borderBottom]="last ? 'none' : '1px solid var(--color-border-light)'"
                  style="height: 52px; padding: 0 14px; gap: 12px"
                >
                  <span style="font-size: 16px">{{ selectedCardId() === card.id ? '🔘' : '⚪️' }}</span>
                  <span
                    class="flex-1 text-left"
                    style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)"
                    >{{ card.label || card.maskedPan || card.instituteName }}</span
                  >
                </button>
              }
            </div>
            <button
              type="button"
              (click)="goToCards()"
              class="text-left"
              style="font-family: var(--font-sans); font-size: 13px; color: var(--color-caramel)"
            >
              {{ 'tma.checkout.manageCards' | translate }}
            </button>
          }
        </div>
      }

      <!-- Promo code -->
      <div
        class="flex items-center"
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-input); padding: 0 14px; height: 48px; gap: 8px"
      >
        <span style="color: var(--color-text-tertiary); font-size: 16px">🎟</span>
        <input
          type="text"
          [placeholder]="'tma.checkout.promo' | translate"
          class="flex-1 outline-none bg-transparent"
          style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)"
        />
      </div>

      @if (error()) {
        <p
          style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 0; text-align: center"
        >
          {{ error() }}
        </p>
      }

      <p
        class="text-center"
        style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); margin: 0"
      >
        {{ 'tma.checkout.tapPay' | translate }}
      </p>
    </section>
  `,
})
export class TmaCheckoutPage implements OnInit, OnDestroy {
  private readonly cartService = inject(CartService);
  private readonly catalog = inject(CatalogService);
  private readonly activeStore = inject(ActiveStoreService);
  private readonly orders = inject(OrdersApi);
  private readonly tg = inject(TelegramBridgeService);
  private readonly router = inject(Router);
  private readonly authStore = inject(TmaAuthStore);
  private readonly translate = inject(TranslateService);
  private readonly fmt = inject(LocaleFormatService);
  private readonly deliveryFeeApi = inject(DeliveryFeeApi);
  private readonly flags = inject(FeatureFlagsStore);
  private readonly cardsApi = inject(PaymentCardsApi);
  private readonly cardsStore = inject(PaymentCardsStore);

  readonly cart = signal<CartView | null>(null);
  readonly error = signal<string | null>(null);
  readonly pickupMode = signal<'ASAP' | 'SCHEDULED'>('ASAP');
  /** ISO start of the chosen slot; empty until the customer picks one. */
  readonly scheduledAt = signal<string>('');
  readonly slots = signal<PickupSlot[]>([]);
  readonly slotsLoading = signal(false);
  readonly storeName = signal<string>('');
  /** Prices are the store's, whatever currency the customer's profile has. */
  readonly currency = signal<string | null>(null);
  /** Pickup times are the store's clock, wherever the customer is. */
  readonly storeTimezone = signal<string | null>(null);
  /**
   * Whether the store takes an ASAP order right now — its switch and its
   * working hours, as the API computes them. After hours only a scheduled
   * pickup is accepted, and offering ASAP ended in a bare 400 at payment.
   */
  readonly storeOpen = signal(true);
  readonly etaMinutes = computed(() => Math.max(1, Math.round((this.cart()?.etaSeconds ?? 0) / 60)));

  readonly fulfillmentType = signal<FulfillmentType>('PICKUP');
  /** True iff the active store advertises DELIVERY in `fulfillmentTypes`. */
  readonly deliveryAvailable = signal(false);
  /** Fee in cents — populated from /delivery/quote on store load + geolocation. */
  readonly deliveryFeeCents = signal(300);
  readonly deliveryDistanceM = signal<number | null>(null);
  readonly deliveryAddress = signal('');
  readonly deliveryCity = signal('');
  readonly deliveryNotes = signal('');
  readonly customerLat = signal<number | null>(null);
  readonly customerLng = signal<number | null>(null);
  readonly locating = signal(false);
  /** OUTSIDE_RADIUS / permission-denied messages surfaced to the customer. */
  readonly deliveryReason = signal<string | null>(null);
  private activeStoreId: string | null = null;
  /** Store tax config — the same numbers the server settles the order with. */
  readonly taxRateBps = signal(0);
  readonly taxIncludedInPrice = signal(true);

  /** Card payments are only offered where ops enabled the bank integration. */
  readonly cardPaymentsEnabled = this.flags.cardPaymentsEnabled;
  readonly cards = signal<BoundCard[]>([]);
  readonly selectedCardId = signal<string | null>(null);
  readonly paying = signal(false);
  /**
   * Set once the order exists. A failed charge must not create a second order
   * when the customer taps pay again — we retry the payment against this one.
   */
  private placedOrderId: string | null = null;

  private detachBack: (() => void) | null = null;

  ngOnInit(): void {
    // Check out the store the customer actually shopped in. Using the first
    // catalog entry loaded an unrelated (empty) cart once a second brand went
    // live, which hid the pay button and made ordering look broken.
    const activeId = this.activeStore.current();
    this.catalog.listStores().subscribe({
      next: (list) => {
        const store = (activeId ? list.find((s) => s.id === activeId) : null) ?? list[0];
        if (!store) return;
        this.storeName.set(store.name);
        this.deliveryAvailable.set((store.fulfillmentTypes ?? []).includes('DELIVERY'));
        this.activeStoreId = store.id;
        this.taxRateBps.set(store.taxRateBps);
        this.taxIncludedInPrice.set(store.taxIncludedInPrice);
        this.currency.set(store.currency);
        this.storeTimezone.set(store.timezone ?? null);
        // `!== false`: an API that predates the field keeps ASAP available.
        this.storeOpen.set(store.openNow !== false);
        if (!this.storeOpen()) {
          this.pickupMode.set('SCHEDULED');
          this.loadSlots();
        }
        this.cartService.load(store.id).subscribe({
          next: (c) => {
            this.cart.set(c);
            this.refreshMainButton();
          },
        });
        this.refreshFeeQuote();
      },
    });

    this.flags.load();
    this.loadCards();

    this.detachBack = this.tg.setBackButton(() => {
      if (history.length > 1) history.back();
      else void this.router.navigate(['/']);
    });
  }

  ngOnDestroy(): void {
    this.detachBack?.();
    this.tg.hideMainButton();
  }

  selectCard(card: BoundCard): void {
    this.selectedCardId.set(card.id);
    this.tg.haptic('light');
    this.refreshMainButton();
  }

  goToCards(): void {
    void this.router.navigate(['/cards']);
  }

  private loadCards(): void {
    if (!this.cardPaymentsEnabled()) return;
    this.cardsStore.load().subscribe({
      next: (cards) => {
        this.cards.set(cards);
        this.selectedCardId.set((cards.find((c) => c.isDefault) ?? cards[0])?.id ?? null);
        this.refreshMainButton();
      },
      // A card-list outage must not block ordering — checkout falls back to
      // placing the order unpaid, exactly as it behaved before.
      error: () => undefined,
    });
  }

  setPickup(mode: 'ASAP' | 'SCHEDULED'): void {
    if (mode === 'ASAP' && !this.storeOpen()) return;
    this.pickupMode.set(mode);
    this.tg.haptic('light');
    if (mode === 'SCHEDULED') this.loadSlots();
    this.refreshMainButton();
  }

  setFulfillment(type: FulfillmentType): void {
    this.fulfillmentType.set(type);
    this.tg.haptic('light');
    this.refreshMainButton();
  }

  requestLocation(): void {
    if (!('geolocation' in navigator)) {
      this.deliveryReason.set(this.translate.instant('tma.checkout.deliveryGeolocateUnsupported'));
      return;
    }
    this.locating.set(true);
    this.tg.haptic('light');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.customerLat.set(pos.coords.latitude);
        this.customerLng.set(pos.coords.longitude);
        this.refreshFeeQuote();
      },
      () => {
        this.locating.set(false);
        this.deliveryReason.set(this.translate.instant('tma.checkout.deliveryGeolocateDenied'));
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }

  formatKm(metres: number): string {
    return this.fmt.distance(metres);
  }

  private refreshFeeQuote(): void {
    if (!this.activeStoreId) return;
    this.locating.set(true);
    this.deliveryFeeApi
      .quote({
        storeId: this.activeStoreId,
        latitude: this.customerLat() ?? undefined,
        longitude: this.customerLng() ?? undefined,
      })
      .subscribe({
        next: (q) => {
          this.locating.set(false);
          this.deliveryFeeCents.set(q.feeCents);
          this.deliveryDistanceM.set(q.distanceM);
          if (!q.deliverable && q.reason === 'OUTSIDE_RADIUS') {
            this.deliveryReason.set(this.translate.instant('tma.checkout.deliveryOutsideRadius'));
          } else {
            this.deliveryReason.set(null);
          }
          this.refreshMainButton();
        },
        error: () => this.locating.set(false),
      });
  }

  /**
   * Runs the server's own tax function so the figure on the Telegram main
   * button is the figure that gets charged.
   */
  private breakdown(subtotalCents: number): { taxCents: number; totalCents: number } {
    return computeTax({
      subtotalCents,
      discountCents: 0,
      deliveryFeeCents: this.fulfillmentType() === 'DELIVERY' ? this.deliveryFeeCents() : 0,
      giftCardCents: 0,
      taxRateBps: this.taxRateBps(),
      taxIncludedInPrice: this.taxIncludedInPrice(),
    });
  }

  totalCents(subtotalCents: number): number {
    return this.breakdown(subtotalCents).totalCents;
  }

  taxCents(subtotalCents: number): number {
    return this.breakdown(subtotalCents).taxCents;
  }

  taxIncluded(): boolean {
    return this.taxIncludedInPrice();
  }

  selectSlot(slot: PickupSlot): void {
    if (!slot.available) return;
    this.scheduledAt.set(slot.startsAt);
    this.tg.haptic('light');
    this.refreshMainButton();
  }

  slotLabel(slot: PickupSlot): string {
    return this.fmt.time(slot.startsAt, this.storeTimezone());
  }

  /**
   * Fetched only when the customer asks to schedule: these are the store's
   * live occupancy, and a copy held behind an ASAP order goes stale.
   */
  private loadSlots(): void {
    const storeId = this.activeStoreId;
    if (!storeId) return;
    this.slotsLoading.set(true);
    this.catalog.getPickupSlots(storeId).subscribe({
      next: (slots) => {
        this.slots.set(slots);
        this.slotsLoading.set(false);
        const current = this.scheduledAt();
        const stillValid = slots.some((s) => s.startsAt === current && s.available);
        if (!stillValid) {
          this.scheduledAt.set(slots.find((s) => s.available)?.startsAt ?? '');
        }
        this.refreshMainButton();
      },
      error: () => {
        this.slots.set([]);
        this.slotsLoading.set(false);
        this.refreshMainButton();
      },
    });
  }

  price(cents: number): string {
    return this.fmt.money(cents, this.currency());
  }

  refreshMainButton(): void {
    const c = this.cart();
    if (!c || c.items.length === 0 || !this.authStore.isAuthenticated()) {
      this.tg.hideMainButton();
      return;
    }
    // A scheduled order needs a slot the store can actually honour.
    if (this.pickupMode() === 'SCHEDULED' && !this.scheduledAt()) {
      this.tg.hideMainButton();
      return;
    }
    if (this.fulfillmentType() === 'DELIVERY' && (!this.deliveryAddress().trim() || !this.deliveryCity().trim())) {
      this.tg.hideMainButton();
      return;
    }
    if (this.fulfillmentType() === 'DELIVERY' && this.deliveryReason() && this.deliveryDistanceM() != null) {
      // OUTSIDE_RADIUS — server would 400, so block at the button.
      this.tg.hideMainButton();
      return;
    }
    const total = this.price(this.totalCents(c.subtotalCents));
    let key: string;
    if (this.fulfillmentType() === 'DELIVERY') {
      key = this.pickupMode() === 'SCHEDULED' ? 'tma.checkout.payDeliveryScheduled' : 'tma.checkout.payDelivery';
    } else {
      key = this.pickupMode() === 'ASAP' ? 'tma.checkout.payAsap' : 'tma.checkout.payScheduled';
    }
    const label = this.translate.instant(key, { total });
    this.tg.setMainButton(label, () => this.placeOrder());
  }

  private placeOrder(): void {
    const c = this.cart();
    if (!c || this.paying()) return;
    this.tg.haptic('medium');

    // Retrying after a declined charge: the order already exists, so charge it
    // again rather than placing a duplicate.
    if (this.placedOrderId) {
      this.payFor(this.placedOrderId);
      return;
    }
    const isDelivery = this.fulfillmentType() === 'DELIVERY';
    const pickupAt = this.pickupMode() === 'SCHEDULED' ? this.scheduledAt() : undefined;
    const input = {
      cartId: c.id,
      pickupMode: this.pickupMode(),
      pickupAt,
      fulfillmentType: this.fulfillmentType(),
      ...(isDelivery
        ? {
            deliveryAddressLine: this.deliveryAddress().trim(),
            deliveryCity: this.deliveryCity().trim(),
            deliveryNotes: this.deliveryNotes().trim() || undefined,
            deliveryLatitude: this.customerLat() ?? undefined,
            deliveryLongitude: this.customerLng() ?? undefined,
          }
        : {}),
    };
    this.orders.create(input).subscribe({
      next: (order) => {
        this.placedOrderId = order.id;
        this.payFor(order.id);
      },
      error: (err) => {
        const body = (err as { error?: unknown }).error;
        if (isCartChangedError(body)) {
          this.onCartChanged(c.storeId, body);
          return;
        }
        this.showError(err, 'tma.checkout.placeOrderFailed');
      },
    });
  }

  /**
   * The server priced the cart again against today's menu and refused the
   * order: a price moved, or something in the basket is gone. It has already
   * brought the cart up to date, so reload it — the main button shows the new
   * total, or hides when nothing is left to order.
   */
  private onCartChanged(storeId: string, conflict: CartChangedError): void {
    const removed = [...new Set(conflict.items.filter((i) => i.unitPriceCents === null).map((i) => i.productName))];
    this.error.set(
      [
        this.translate.instant('tma.checkout.cartChanged'),
        removed.length > 0
          ? this.translate.instant('tma.checkout.cartChangedRemoved', { names: removed.join(', ') })
          : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
    this.cartService.load(storeId).subscribe({
      next: (cart) => {
        this.cart.set(cart);
        this.refreshMainButton();
      },
      error: () => undefined,
    });
  }

  /**
   * Charges the selected card and opens the order screen. With no card bound
   * (or card payments switched off) the order is simply placed unpaid, which
   * is how checkout behaved before the bank integration.
   */
  private payFor(orderId: string): void {
    const cardId = this.selectedCardId();
    if (!this.cardPaymentsEnabled() || !cardId) {
      void this.router.navigate(['/orders', orderId]);
      return;
    }

    this.paying.set(true);
    this.error.set(null);
    this.cardsApi.pay({ orderId, cardId }).subscribe({
      next: () => {
        this.paying.set(false);
        this.tg.haptic('medium');
        void this.router.navigate(['/orders', orderId]);
      },
      error: (err) => {
        this.paying.set(false);
        this.showError(err, 'tma.checkout.payFailed');
      },
    });
  }

  /**
   * A coded API error — the store is closed then, the slot filled up — in
   * the customer's words; any other message the API sent as it is, since the
   * real reason beats a vaguer apology.
   */
  private showError(err: unknown, fallbackKey: string): void {
    const body = (err as { error?: unknown } | null)?.error;
    const coded = checkoutErrorText(body, this.translate, this.fmt);
    if (coded) {
      this.error.set(coded);
      return;
    }
    if ((err as { status?: unknown } | null)?.status === 0) {
      this.error.set(this.translate.instant('common.networkError'));
      return;
    }
    const raw = (body as { message?: unknown } | null)?.message;
    const message = Array.isArray(raw) ? raw.join(', ') : raw;
    this.error.set(typeof message === 'string' && message ? message : this.translate.instant(fallbackKey));
  }
}
