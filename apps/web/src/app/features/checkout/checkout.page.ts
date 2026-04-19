import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthStore } from '../../core/auth/auth.store';
import { CartService, type CartView } from '../../core/cart/cart.service';
import { CatalogService } from '../../core/catalog/catalog.service';
import { PromoService } from '../../core/loyalty/loyalty.service';
import { DeliveryFeeApi } from '../../core/orders/delivery-fee.service';
import { OrdersApi } from '../../core/orders/orders.service';

type PickupMode = 'ASAP' | 'SCHEDULED';
type PaymentMethod = 'APPLE_PAY' | 'GOOGLE_PAY' | 'CARD';
type FulfillmentType = 'PICKUP' | 'DELIVERY';

interface Step {
  n: number;
  label: string;
  state: 'current' | 'done' | 'upcoming';
}

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe],
  template: `
    <section class="min-h-screen">
      <header
        class="flex items-center justify-center gap-6 py-4"
        style="border-bottom: 1px solid var(--color-border-light); background: var(--color-foam)"
      >
        @for (step of steps(); track step.n; let last = $last) {
          <div class="flex items-center gap-2">
            <span
              class="flex items-center justify-center"
              [style.background]="step.state === 'upcoming' ? 'transparent' : 'var(--color-caramel)'"
              [style.border]="step.state === 'upcoming' ? '1.5px solid var(--color-border)' : 'none'"
              [style.color]="step.state === 'upcoming' ? 'var(--color-text-tertiary)' : 'var(--color-foam)'"
              style="width: 28px; height: 28px; border-radius: 999px; font-family: var(--font-sans); font-size: 13px; font-weight: 600"
              >{{ step.n }}</span
            >
            <span
              [style.color]="step.state === 'upcoming' ? 'var(--color-text-tertiary)' : 'var(--color-caramel)'"
              style="font-family: var(--font-sans); font-size: 14px; font-weight: 600"
              >{{ step.label | translate }}</span
            >
          </div>
          @if (!last) {
            <span
              [style.background]="step.state === 'done' ? 'var(--color-caramel)' : 'var(--color-border)'"
              style="width: 32px; height: 2px; border-radius: 1px"
            ></span>
          }
        }
      </header>

      @if (!authStore.isAuthenticated()) {
        <p
          class="max-w-xl mx-auto my-10 p-4 text-center"
          style="background: var(--color-amber); color: var(--color-foam); border-radius: 16px"
        >
          Please <a routerLink="/login" class="underline">sign in</a> to place an order.
        </p>
      }

      @if (cart(); as c) {
        @if (c.items.length === 0) {
          <p class="text-center mt-10" style="color: var(--color-text-secondary)">
            {{ 'web.checkout.emptyCart' | translate }}
            <a routerLink="/menu" class="underline">{{ 'web.checkout.browseMenu' | translate }}</a
            >.
          </p>
        } @else {
          <div
            class="flex flex-col items-center"
            style="gap: var(--spacing-xl); padding: var(--spacing-2xl) var(--spacing-base)"
          >
            <h1
              style="font-family: var(--font-display); font-size: 32px; font-weight: 600; color: var(--color-espresso); text-align: center"
            >
              {{ 'web.checkout.title' | translate }}
            </h1>

            <section
              class="w-full"
              style="max-width: 500px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: var(--spacing-xl); display: flex; flex-direction: column; gap: var(--spacing-lg)"
            >
              <!-- PICKUP / DELIVERY toggle -->
              <div class="flex gap-3 w-full">
                <button
                  type="button"
                  (click)="selectFulfillment('PICKUP')"
                  class="flex items-center justify-center w-full"
                  [style.background]="fulfillmentType() === 'PICKUP' ? 'var(--color-caramel)' : 'var(--color-cream)'"
                  [style.color]="fulfillmentType() === 'PICKUP' ? 'var(--color-foam)' : 'var(--color-espresso)'"
                  [style.border]="fulfillmentType() === 'PICKUP' ? 'none' : '1px solid var(--color-border)'"
                  style="padding: 10px 16px; border-radius: 12px; font-family: var(--font-sans); font-size: 14px; font-weight: 600"
                >
                  {{ 'web.checkout.fulfillmentPickup' | translate }}
                </button>
                <button
                  type="button"
                  (click)="selectFulfillment('DELIVERY')"
                  [disabled]="!deliveryAvailable()"
                  class="flex items-center justify-center w-full disabled:opacity-40"
                  [style.background]="fulfillmentType() === 'DELIVERY' ? 'var(--color-caramel)' : 'var(--color-cream)'"
                  [style.color]="fulfillmentType() === 'DELIVERY' ? 'var(--color-foam)' : 'var(--color-espresso)'"
                  [style.border]="fulfillmentType() === 'DELIVERY' ? 'none' : '1px solid var(--color-border)'"
                  style="padding: 10px 16px; border-radius: 12px; font-family: var(--font-sans); font-size: 14px; font-weight: 600"
                >
                  {{ 'web.checkout.fulfillmentDelivery' | translate }}
                </button>
              </div>

              <!-- ASAP / SCHEDULED — only for pickup (delivery is always ASAP in v1) -->
              @if (fulfillmentType() === 'PICKUP') {
                <div class="flex gap-3 w-full">
                  <button
                    type="button"
                    (click)="selectMode('ASAP')"
                    class="flex items-center justify-center w-full"
                    [style.background]="mode() === 'ASAP' ? 'var(--color-caramel)' : 'var(--color-cream)'"
                    [style.color]="mode() === 'ASAP' ? 'var(--color-foam)' : 'var(--color-espresso)'"
                    [style.border]="mode() === 'ASAP' ? 'none' : '1px solid var(--color-border)'"
                    style="padding: 12px 20px; border-radius: 12px; font-family: var(--font-sans); font-size: 14px; font-weight: 600"
                  >
                    {{ 'web.checkout.pickupAsap' | translate }}
                  </button>
                  <button
                    type="button"
                    (click)="selectMode('SCHEDULED')"
                    class="flex items-center justify-center w-full"
                    [style.background]="mode() === 'SCHEDULED' ? 'var(--color-caramel)' : 'var(--color-cream)'"
                    [style.color]="mode() === 'SCHEDULED' ? 'var(--color-foam)' : 'var(--color-espresso)'"
                    [style.border]="mode() === 'SCHEDULED' ? 'none' : '1px solid var(--color-border)'"
                    style="padding: 12px 20px; border-radius: 12px; font-family: var(--font-sans); font-size: 14px; font-weight: 600"
                  >
                    {{ 'web.checkout.pickupScheduled' | translate }}
                  </button>
                </div>
              }

              <!-- Delivery address form -->
              @if (fulfillmentType() === 'DELIVERY') {
                <div [formGroup]="deliveryForm" class="flex flex-col" style="gap: 12px">
                  <label class="flex flex-col gap-1">
                    <span
                      style="font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-text-secondary)"
                    >
                      {{ 'web.checkout.deliveryAddressLabel' | translate }}
                    </span>
                    <input
                      formControlName="addressLine"
                      type="text"
                      autocomplete="street-address"
                      [placeholder]="'web.checkout.deliveryAddressPlaceholder' | translate"
                      style="padding: 12px 14px; border: 1px solid var(--color-border); background: var(--color-cream); border-radius: 12px; font-family: var(--font-sans); font-size: 14px; color: var(--color-espresso); outline: none"
                    />
                  </label>
                  <label class="flex flex-col gap-1">
                    <span
                      style="font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-text-secondary)"
                    >
                      {{ 'web.checkout.deliveryCityLabel' | translate }}
                    </span>
                    <input
                      formControlName="city"
                      type="text"
                      autocomplete="address-level2"
                      [placeholder]="'web.checkout.deliveryCityPlaceholder' | translate"
                      style="padding: 12px 14px; border: 1px solid var(--color-border); background: var(--color-cream); border-radius: 12px; font-family: var(--font-sans); font-size: 14px; color: var(--color-espresso); outline: none"
                    />
                  </label>
                  <label class="flex flex-col gap-1">
                    <span
                      style="font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-text-secondary)"
                    >
                      {{ 'web.checkout.deliveryNotesLabel' | translate }}
                    </span>
                    <input
                      formControlName="notes"
                      type="text"
                      [placeholder]="'web.checkout.deliveryNotesPlaceholder' | translate"
                      style="padding: 12px 14px; border: 1px solid var(--color-border); background: var(--color-cream); border-radius: 12px; font-family: var(--font-sans); font-size: 14px; color: var(--color-espresso); outline: none"
                    />
                  </label>
                  <div class="flex items-center flex-wrap" style="gap: 10px">
                    <button
                      type="button"
                      (click)="requestLocation()"
                      [disabled]="locating()"
                      class="flex items-center disabled:opacity-50"
                      style="height: 36px; padding: 0 14px; background: var(--color-cream); border: 1px solid var(--color-border); border-radius: 10px; font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-espresso)"
                    >
                      📍
                      {{
                        (customerLat() != null
                          ? 'web.checkout.deliveryGeolocateRetry'
                          : 'web.checkout.deliveryGeolocate'
                        ) | translate
                      }}
                    </button>
                    @if (deliveryDistanceM() != null) {
                      <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
                        'web.checkout.deliveryDistance' | translate: { km: formatKm(deliveryDistanceM()!) }
                      }}</span>
                    }
                  </div>
                  <p
                    style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); margin: 0"
                  >
                    {{ 'web.checkout.deliveryFeeHint' | translate: { fee: price(deliveryFeeCents()) } }}
                  </p>
                  @if (deliveryReason()) {
                    <p style="font-family: var(--font-sans); font-size: 12px; color: var(--color-berry); margin: 0">
                      {{ deliveryReason() }}
                    </p>
                  }
                </div>
              }

              @if (mode() === 'SCHEDULED') {
                <label class="flex flex-col gap-1">
                  <span
                    style="font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-text-secondary)"
                    >{{ 'web.checkout.pickupAtLabel' | translate }}</span
                  >
                  <input
                    type="datetime-local"
                    [value]="scheduledAt()"
                    (change)="onScheduledChange($event)"
                    [min]="minScheduled"
                    style="padding: 12px 14px; border: 1px solid var(--color-border); background: var(--color-cream); border-radius: 12px; font-family: var(--font-sans); font-size: 14px; color: var(--color-espresso); outline: none"
                  />
                  <span style="font-size: 12px; color: var(--color-text-tertiary)">{{
                    'web.checkout.scheduledHint' | translate
                  }}</span>
                </label>
              }

              <div>
                <p
                  style="font-family: var(--font-sans); font-size: 24px; font-weight: 700; color: var(--color-caramel)"
                >
                  {{ 'common.readyBy' | translate: { time: readyTimeLabel() } }}
                </p>
                <p
                  class="mt-1"
                  style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
                >
                  We'll start preparing at {{ prepStartLabel() }} so it's fresh when you arrive.
                </p>
              </div>
            </section>

            <section
              class="w-full"
              style="max-width: 500px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 16px; padding: var(--spacing-base) var(--spacing-lg); display: flex; flex-direction: column; gap: 12px"
            >
              @for (item of c.items; track item.id) {
                <div class="flex items-center justify-between">
                  <span style="font-family: var(--font-sans); font-size: 14px; color: var(--color-espresso)">
                    {{ item.productName }} × {{ item.quantity }}
                  </span>
                  <span
                    style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-espresso)"
                  >
                    {{ price(item.unitPriceCents * item.quantity) }}
                  </span>
                </div>
              }
              <div style="height: 1px; background: var(--color-border-light)"></div>
              <div class="flex items-center justify-between">
                <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
                  'common.subtotal' | translate
                }}</span>
                <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
                  price(c.subtotalCents)
                }}</span>
              </div>
              @if (discountCents() > 0) {
                <div class="flex items-center justify-between">
                  <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-mint)"
                    >Promo · {{ promoCode() }}</span
                  >
                  <span
                    style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-mint)"
                    >− {{ price(discountCents()) }}</span
                  >
                </div>
              }
              <div class="flex items-center justify-between">
                <span
                  style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-espresso)"
                  >{{ 'common.total' | translate }}</span
                >
                <span
                  style="font-family: var(--font-sans); font-size: 16px; font-weight: 700; color: var(--color-caramel)"
                >
                  {{ price(totalCents(c.subtotalCents)) }}
                </span>
              </div>
            </section>

            <!-- Promo code -->
            <section class="w-full" style="max-width: 500px; display: flex; flex-direction: column; gap: 8px">
              <span
                style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-primary)"
                >{{ 'web.checkout.promoLabel' | translate }}</span
              >
              <div
                class="flex items-center"
                style="gap: 8px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: var(--radius-input); padding: 4px 4px 4px 14px"
              >
                <span style="color: var(--color-text-tertiary)">🎟</span>
                <input
                  [value]="promoInput()"
                  (input)="onPromoInput($event)"
                  type="text"
                  placeholder="WELCOME10"
                  class="flex-1 outline-none bg-transparent"
                  style="font-family: var(--font-mono); font-size: 14px; color: var(--color-text-primary); text-transform: uppercase"
                />
                <button
                  type="button"
                  (click)="applyPromo()"
                  [disabled]="!promoInput() || promoLoading()"
                  class="flex items-center justify-center disabled:opacity-50"
                  style="height: 36px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: 10px; font-family: var(--font-sans); font-size: 13px; font-weight: 600"
                >
                  @if (promoLoading()) {
                    …
                  } @else if (discountCents() > 0) {
                    {{ 'common.clear' | translate }}
                  } @else {
                    {{ 'common.apply' | translate }}
                  }
                </button>
              </div>
              @if (promoStatus()) {
                <span
                  style="font-family: var(--font-sans); font-size: 12px"
                  [style.color]="discountCents() > 0 ? 'var(--color-mint)' : 'var(--color-berry)'"
                >
                  {{ promoStatus() }}
                </span>
              }
            </section>

            <form
              [formGroup]="contactForm"
              class="w-full flex flex-col"
              style="max-width: 500px; gap: var(--spacing-md)"
            >
              <input
                formControlName="customerName"
                [placeholder]="'web.checkout.name' | translate"
                style="padding: 14px 16px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: 12px; font-family: var(--font-sans); font-size: 14px; color: var(--color-espresso); outline: none"
              />
              <input
                formControlName="notes"
                [placeholder]="'web.checkout.notes' | translate"
                style="padding: 14px 16px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: 12px; font-family: var(--font-sans); font-size: 14px; color: var(--color-espresso); outline: none"
              />
            </form>

            <section class="w-full flex flex-col" style="max-width: 500px; gap: var(--spacing-md)">
              <button
                type="button"
                (click)="selectPayment('APPLE_PAY')"
                class="flex items-center justify-center"
                [style.background]="payment() === 'APPLE_PAY' ? 'var(--color-espresso)' : 'var(--color-cream)'"
                [style.color]="payment() === 'APPLE_PAY' ? 'var(--color-foam)' : 'var(--color-espresso)'"
                [style.border]="payment() === 'APPLE_PAY' ? 'none' : '1px solid var(--color-border)'"
                style="height: 50px; border-radius: 14px; font-family: var(--font-sans); font-size: 14px; font-weight: 600"
              >
                Pay
              </button>
              <button
                type="button"
                (click)="selectPayment('GOOGLE_PAY')"
                class="flex items-center justify-center"
                [style.background]="payment() === 'GOOGLE_PAY' ? 'var(--color-espresso)' : 'var(--color-cream)'"
                [style.color]="payment() === 'GOOGLE_PAY' ? 'var(--color-foam)' : 'var(--color-espresso)'"
                [style.border]="payment() === 'GOOGLE_PAY' ? 'none' : '1px solid var(--color-border)'"
                style="height: 50px; border-radius: 14px; font-family: var(--font-sans); font-size: 14px; font-weight: 600"
              >
                G Pay
              </button>
              <button
                type="button"
                (click)="selectPayment('CARD')"
                class="flex items-center justify-center"
                [style.background]="payment() === 'CARD' ? 'var(--color-espresso)' : 'var(--color-cream)'"
                [style.color]="payment() === 'CARD' ? 'var(--color-foam)' : 'var(--color-espresso)'"
                [style.border]="payment() === 'CARD' ? 'none' : '1px solid var(--color-border)'"
                style="height: 50px; border-radius: 14px; font-family: var(--font-sans); font-size: 14px; font-weight: 400"
              >
                Card
              </button>
            </section>

            <button
              type="button"
              (click)="placeOrder()"
              [disabled]="!canSubmit() || submitting()"
              class="w-full flex items-center justify-center disabled:opacity-50"
              style="max-width: 500px; height: 56px; background: var(--color-caramel); color: var(--color-foam); border-radius: 16px; font-family: var(--font-sans); font-size: 16px; font-weight: 600"
            >
              {{
                submitting()
                  ? ('common.loading' | translate)
                  : ('web.checkout.payCta'
                    | translate: { total: price(totalCents(c.subtotalCents)), time: readyTimeLabel() })
              }}
            </button>

            @if (error()) {
              <p class="text-sm text-center" style="color: var(--color-berry)">{{ error() }}</p>
            }
          </div>
        }
      }
    </section>
  `,
})
export class CheckoutPage implements OnInit {
  readonly authStore = inject(AuthStore);
  private readonly cartService = inject(CartService);
  private readonly catalog = inject(CatalogService);
  private readonly orders = inject(OrdersApi);
  private readonly promo = inject(PromoService);
  private readonly translate = inject(TranslateService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly deliveryFeeApi = inject(DeliveryFeeApi);

  readonly cart = signal<CartView | null>(null);
  readonly mode = signal<PickupMode>('ASAP');
  readonly fulfillmentType = signal<FulfillmentType>('PICKUP');
  readonly payment = signal<PaymentMethod>('APPLE_PAY');
  readonly scheduledAt = signal<string>(this.defaultScheduled());
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  /** Whether the picked store advertises DELIVERY in `fulfillmentTypes`. */
  readonly deliveryAvailable = signal(false);
  /** Fee in cents — populated from /delivery/quote on store load and on geolocation. */
  readonly deliveryFeeCents = signal(300);
  /** Straight-line distance in metres; null until the customer shares coords. */
  readonly deliveryDistanceM = signal<number | null>(null);
  /** Customer coords, if the browser granted geolocation. */
  readonly customerLat = signal<number | null>(null);
  readonly customerLng = signal<number | null>(null);
  /** True while a geolocation / quote request is in flight. */
  readonly locating = signal(false);
  /** Surfaces OUTSIDE_RADIUS (and other server rejections) to the customer. */
  readonly deliveryReason = signal<string | null>(null);

  // Promo state — promoCode() is the confirmed/applied code, promoInput() is
  // what's currently typed in the input.
  readonly promoInput = signal('');
  readonly promoCode = signal<string | null>(null);
  readonly discountCents = signal(0);
  readonly promoStatus = signal<string | null>(null);
  readonly promoLoading = signal(false);
  /** Brand ID derived from the active store, needed for /promo/validate. */
  readonly brandId = signal<string | null>(null);
  /** Store ID, needed for /delivery/quote. */
  readonly activeStoreId = signal<string | null>(null);

  readonly contactForm = new FormGroup({
    customerName: new FormControl('', { nonNullable: true }),
    notes: new FormControl('', { nonNullable: true }),
  });

  readonly deliveryForm = new FormGroup({
    addressLine: new FormControl('', { nonNullable: true }),
    city: new FormControl('', { nonNullable: true }),
    notes: new FormControl('', { nonNullable: true }),
  });

  readonly minScheduled = this.toLocalInput(new Date(Date.now() + 10 * 60_000));

  readonly readyAt = computed<Date>(() => {
    if (this.mode() === 'ASAP') {
      return new Date(Date.now() + (this.cart()?.etaSeconds ?? 0) * 1000);
    }
    const iso = this.scheduledAt();
    return iso ? new Date(iso) : new Date(Date.now() + 30 * 60_000);
  });

  readonly readyTimeLabel = computed(() => this.formatTime(this.readyAt()));

  readonly prepStartLabel = computed(() => {
    const at = new Date(this.readyAt().getTime() - (this.cart()?.etaSeconds ?? 0) * 1000);
    return this.formatTime(at);
  });

  readonly steps = computed<Step[]>(() => [
    { n: 1, label: 'web.checkout.stepsPickup', state: 'current' },
    {
      n: 2,
      label: 'web.checkout.stepsContact',
      state: this.contactForm.controls.customerName.value ? 'done' : 'current',
    },
    { n: 3, label: 'web.checkout.stepsPayment', state: 'upcoming' },
  ]);

  readonly canSubmit = computed(() => {
    const c = this.cart();
    if (!c || c.items.length === 0) return false;
    if (!this.authStore.isAuthenticated()) return false;
    if (this.mode() === 'SCHEDULED' && !this.scheduledAt()) return false;
    // Outside the serviceable radius — server will 400 anyway, stop the
    // customer at the button instead of letting them tap into an error.
    if (this.fulfillmentType() === 'DELIVERY' && this.deliveryReason() === 'OUTSIDE_RADIUS') return false;
    return true;
  });

  ngOnInit(): void {
    const storeSlug = this.route.snapshot.queryParamMap.get('store');
    if (storeSlug) {
      this.catalog.getStore(storeSlug).subscribe({
        next: (store) => {
          this.brandId.set(store.brandId);
          this.deliveryAvailable.set((store.fulfillmentTypes ?? []).includes('DELIVERY'));
          this.activeStoreId.set(store.id);
          this.cartService.load(store.id).subscribe((c) => this.cart.set(c));
          this.refreshFeeQuote();
        },
      });
    } else {
      this.catalog.listStores().subscribe({
        next: (stores) => {
          const first = stores[0];
          if (first) {
            this.brandId.set(first.brandId);
            this.deliveryAvailable.set((first.fulfillmentTypes ?? []).includes('DELIVERY'));
            this.activeStoreId.set(first.id);
            this.cartService.load(first.id).subscribe((c) => this.cart.set(c));
            this.refreshFeeQuote();
          }
        },
      });
    }
  }

  requestLocation(): void {
    if (!('geolocation' in navigator)) {
      this.deliveryReason.set(this.translate.instant('web.checkout.deliveryGeolocateUnsupported'));
      return;
    }
    this.locating.set(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.customerLat.set(pos.coords.latitude);
        this.customerLng.set(pos.coords.longitude);
        this.refreshFeeQuote();
      },
      () => {
        this.locating.set(false);
        this.deliveryReason.set(this.translate.instant('web.checkout.deliveryGeolocateDenied'));
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }

  private refreshFeeQuote(): void {
    const storeId = this.activeStoreId();
    if (!storeId) return;
    this.locating.set(true);
    this.deliveryFeeApi
      .quote({
        storeId,
        latitude: this.customerLat() ?? undefined,
        longitude: this.customerLng() ?? undefined,
      })
      .subscribe({
        next: (q) => {
          this.locating.set(false);
          this.deliveryFeeCents.set(q.feeCents);
          this.deliveryDistanceM.set(q.distanceM);
          if (!q.deliverable && q.reason === 'OUTSIDE_RADIUS') {
            this.deliveryReason.set(this.translate.instant('web.checkout.deliveryOutsideRadius'));
          } else {
            this.deliveryReason.set(null);
          }
        },
        error: () => this.locating.set(false),
      });
  }

  // ── Promo flow ──────────────────────────────────────────────────────────

  onPromoInput(event: Event): void {
    this.promoInput.set((event.target as HTMLInputElement).value.trim().toUpperCase());
    if (this.promoCode() && this.promoInput() !== this.promoCode()) {
      // User started editing a confirmed code — reset the applied discount.
      this.clearPromo();
    }
  }

  applyPromo(): void {
    // Acting as a toggle: if one is already applied, the button clears it.
    if (this.discountCents() > 0) {
      this.clearPromo();
      return;
    }
    const code = this.promoInput();
    const brandId = this.brandId();
    const cart = this.cart();
    if (!code || !brandId || !cart) return;

    this.promoLoading.set(true);
    this.promoStatus.set(null);
    this.promo.validate(code, brandId, cart.subtotalCents).subscribe({
      next: (res) => {
        this.promoLoading.set(false);
        if (!res.valid) {
          this.promoStatus.set(res.reason ?? this.translate.instant('web.checkout.promoInvalid'));
          return;
        }
        this.promoCode.set(code);
        this.discountCents.set(res.discountCents);
        if (res.discountCents > 0) {
          this.promoStatus.set(
            this.translate.instant('web.checkout.promoApplied', { amount: this.price(res.discountCents) }),
          );
        } else if (res.pointsMultiplier > 1) {
          this.promoStatus.set(
            this.translate.instant('web.checkout.promoPointsApplied', { mult: res.pointsMultiplier }),
          );
        } else {
          this.promoStatus.set(this.translate.instant('common.apply'));
        }
      },
      error: (err) => {
        this.promoLoading.set(false);
        this.promoStatus.set(extractMessage(err));
      },
    });
  }

  clearPromo(): void {
    this.promoCode.set(null);
    this.discountCents.set(0);
    this.promoStatus.set(null);
  }

  totalCents(subtotalCents: number): number {
    const fee = this.fulfillmentType() === 'DELIVERY' ? this.deliveryFeeCents() : 0;
    return Math.max(0, subtotalCents - this.discountCents() + fee);
  }

  selectMode(mode: PickupMode): void {
    this.mode.set(mode);
  }

  selectFulfillment(type: FulfillmentType): void {
    this.fulfillmentType.set(type);
    // Delivery is always ASAP in v1. If the user toggled from SCHEDULED
    // pickup, reset to ASAP so we don't send conflicting state to the API.
    if (type === 'DELIVERY') this.mode.set('ASAP');
  }

  selectPayment(method: PaymentMethod): void {
    this.payment.set(method);
  }

  onScheduledChange(event: Event): void {
    this.scheduledAt.set((event.target as HTMLInputElement).value);
  }

  placeOrder(): void {
    const c = this.cart();
    if (!c) return;
    this.submitting.set(true);
    this.error.set(null);

    const v = this.contactForm.getRawValue();
    const isDelivery = this.fulfillmentType() === 'DELIVERY';
    if (isDelivery) {
      const d = this.deliveryForm.getRawValue();
      if (!d.addressLine.trim() || !d.city.trim()) {
        this.submitting.set(false);
        this.error.set(this.translate.instant('web.checkout.deliveryAddressRequired'));
        return;
      }
    }
    const d = this.deliveryForm.getRawValue();
    const input = {
      cartId: c.id,
      pickupMode: this.mode(),
      pickupAt: this.mode() === 'SCHEDULED' ? new Date(this.scheduledAt()).toISOString() : undefined,
      fulfillmentType: this.fulfillmentType(),
      customerName: v.customerName || undefined,
      notes: v.notes || undefined,
      couponCode: this.promoCode() ?? undefined,
      ...(isDelivery
        ? {
            deliveryAddressLine: d.addressLine.trim(),
            deliveryCity: d.city.trim(),
            deliveryNotes: d.notes?.trim() || undefined,
            deliveryLatitude: this.customerLat() ?? undefined,
            deliveryLongitude: this.customerLng() ?? undefined,
          }
        : {}),
    };

    this.orders.create(input).subscribe({
      next: (order) => {
        this.submitting.set(false);
        void this.router.navigate(['/orders', order.id]);
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(extractMessage(err));
      },
    });
  }

  price(cents: number): string {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: this.authStore.user()?.currency ?? 'USD',
    }).format(cents / 100);
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  formatKm(metres: number): string {
    if (metres < 1000) return `${metres} m`;
    return `${(metres / 1000).toFixed(1)} km`;
  }

  private defaultScheduled(): string {
    return this.toLocalInput(new Date(Date.now() + 30 * 60_000));
  }

  private toLocalInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${mi}`;
  }
}

function extractMessage(err: unknown): string {
  const maybe = err as { error?: { message?: unknown }; message?: unknown };
  if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
  if (typeof maybe.message === 'string') return maybe.message;
  return 'Request failed';
}
