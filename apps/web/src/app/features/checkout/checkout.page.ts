import { Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { CartChangedError, PickupSlot, StoreListItem } from '@takeaway/shared-types';
import { computeTax, isCartChangedError } from '@takeaway/utils';
import { checkoutErrorText, LocaleFormatService } from '@takeaway/i18n';

import { AuthStore } from '../../core/auth/auth.store';
import { CartService, type CartView } from '../../core/cart/cart.service';
import { CatalogService } from '../../core/catalog/catalog.service';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { LoyaltyService, PromoService } from '../../core/loyalty/loyalty.service';
import { DeliveryFeeApi } from '../../core/orders/delivery-fee.service';
import { OrdersApi } from '../../core/orders/orders.service';
import { type BoundCard, PaymentCardsApi, PaymentCardsStore } from '../../core/payments/payment-cards.service';

type PickupMode = 'ASAP' | 'SCHEDULED';
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
          <a routerLink="/login" class="underline">{{ 'web.checkout.signInLink' | translate }}</a
          >{{ 'web.checkout.signInToOrder' | translate }}
        </p>
      }

      @if (cart(); as c) {
        @if (c.items.length === 0) {
          <p class="text-center mt-10" style="color: var(--color-text-secondary)">
            {{ 'web.checkout.emptyCart' | translate }}
            <a routerLink="/menu" class="underline">{{ 'web.checkout.browseMenu' | translate }}</a
            >.
          </p>
          @if (error()) {
            <p class="text-sm text-center mt-4" style="color: var(--color-berry)">{{ error() }}</p>
          }
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

              <!-- ASAP / SCHEDULED — works for both PICKUP and DELIVERY -->
              <div class="flex gap-3 w-full">
                <button
                  type="button"
                  (click)="selectMode('ASAP')"
                  [disabled]="!storeOpen()"
                  [style.opacity]="storeOpen() ? 1 : 0.45"
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
              @if (!storeOpen()) {
                <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
                  'web.checkout.closedNow' | translate
                }}</span>
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
                        (customerLat() !== null
                          ? 'web.checkout.deliveryGeolocateRetry'
                          : 'web.checkout.deliveryGeolocate'
                        ) | translate
                      }}
                    </button>
                    @if (deliveryDistanceM() !== null) {
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
                <div class="flex flex-col gap-1">
                  <span
                    style="font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-text-secondary)"
                    >{{ 'web.checkout.pickupAtLabel' | translate }}</span
                  >

                  @if (slotsLoading()) {
                    <span style="font-size: 13px; color: var(--color-text-tertiary)">{{
                      'common.loading' | translate
                    }}</span>
                  } @else if (slots().length === 0) {
                    <span style="font-size: 13px; color: var(--color-berry)">{{
                      (storeOpen() ? 'web.checkout.noSlots' : 'web.checkout.noSlotsClosed') | translate
                    }}</span>
                  } @else {
                    <div class="flex flex-wrap" style="gap: 8px">
                      @for (slot of slots(); track slot.startsAt) {
                        <button
                          type="button"
                          [disabled]="!slot.available"
                          (click)="selectSlot(slot)"
                          [title]="slot.available ? '' : ('web.checkout.slotFull' | translate)"
                          [style.background]="
                            scheduledAt() === slot.startsAt ? 'var(--color-caramel)' : 'var(--color-cream)'
                          "
                          [style.color]="
                            slot.available
                              ? scheduledAt() === slot.startsAt
                                ? 'var(--color-foam)'
                                : 'var(--color-espresso)'
                              : 'var(--color-text-tertiary)'
                          "
                          [style.borderColor]="scheduledAt() === slot.startsAt ? 'transparent' : 'var(--color-border)'"
                          [style.cursor]="slot.available ? 'pointer' : 'not-allowed'"
                          [style.textDecoration]="slot.available ? 'none' : 'line-through'"
                          style="padding: 8px 14px; border: 1px solid; border-radius: 999px; font-family: var(--font-sans); font-size: 14px; font-weight: 500"
                        >
                          {{ slotLabel(slot) }}
                        </button>
                      }
                    </div>
                  }

                  <span style="font-size: 12px; color: var(--color-text-tertiary)">{{
                    'web.checkout.scheduledHint' | translate
                  }}</span>
                </div>
              }

              <div>
                <p
                  style="font-family: var(--font-sans); font-size: 24px; font-weight: 700; color: var(--color-caramel)"
                >
                  {{
                    (fulfillmentType() === 'DELIVERY' ? 'web.checkout.deliveryBy' : 'common.readyBy')
                      | translate: { time: readyTimeLabel() }
                  }}
                </p>
                <p
                  class="mt-1"
                  style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
                >
                  {{ 'web.checkout.prepStartHint' | translate: { time: prepStartLabel() } }}
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
                  <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-mint)">{{
                    'web.checkout.promoLine' | translate: { code: promoCode() }
                  }}</span>
                  <span
                    style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-mint)"
                    >− {{ price(discountCents()) }}</span
                  >
                </div>
              }
              @if (pointsDiscountCents() > 0) {
                <div class="flex items-center justify-between">
                  <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-mint)"
                    >🏆 {{ 'web.checkout.pointsSpent' | translate: { points: pointsSpent() } }}</span
                  >
                  <span
                    style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-mint)"
                    >− {{ price(pointsDiscountCents()) }}</span
                  >
                </div>
              }
              @if (giftCardCents() > 0) {
                <div class="flex items-center justify-between">
                  <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-mint)"
                    >🎁 {{ giftCardCode() }}</span
                  >
                  <span
                    style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-mint)"
                    >− {{ price(giftCardCents()) }}</span
                  >
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

            <!-- Loyalty points -->
            @if (pointsBalance() >= pointsMin()) {
              <section
                data-testid="points-section"
                class="w-full"
                style="max-width: 500px; display: flex; flex-direction: column; gap: 8px"
              >
                <div class="flex items-center justify-between">
                  <span
                    style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-primary)"
                    >{{ 'web.checkout.pointsLabel' | translate }}</span
                  >
                  <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
                    'web.checkout.pointsBalance' | translate: { points: pointsBalance() }
                  }}</span>
                </div>

                <div
                  class="flex items-center"
                  style="gap: 8px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: var(--radius-input); padding: 4px 4px 4px 14px"
                >
                  <span style="color: var(--color-text-tertiary)">🏆</span>
                  <input
                    [value]="pointsInput()"
                    (input)="onPointsInput($event)"
                    type="number"
                    min="0"
                    [max]="pointsBalance()"
                    class="flex-1 outline-none bg-transparent"
                    style="font-family: var(--font-mono); font-size: 14px; color: var(--color-text-primary)"
                  />
                  <button
                    type="button"
                    data-testid="points-apply"
                    (click)="pointsSpent() > 0 ? clearPoints() : applyPoints()"
                    [disabled]="pointsLoading()"
                    class="flex items-center justify-center disabled:opacity-50"
                    style="height: 36px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: 10px; font-family: var(--font-sans); font-size: 13px; font-weight: 600"
                  >
                    @if (pointsLoading()) {
                      …
                    } @else if (pointsSpent() > 0) {
                      {{ 'common.clear' | translate }}
                    } @else {
                      {{ 'common.apply' | translate }}
                    }
                  </button>
                </div>
                @if (pointsStatus()) {
                  <span
                    style="font-family: var(--font-sans); font-size: 12px"
                    [style.color]="pointsSpent() > 0 ? 'var(--color-mint)' : 'var(--color-berry)'"
                    >{{ pointsStatus() }}</span
                  >
                }
              </section>
            }

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

            <!-- Gift card -->
            <section class="w-full" style="max-width: 500px; display: flex; flex-direction: column; gap: 8px">
              <span
                style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-primary)"
                >{{ 'web.checkout.giftCardLabel' | translate }}</span
              >
              <div
                class="flex items-center"
                style="gap: 8px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: var(--radius-input); padding: 4px 4px 4px 14px"
              >
                <span style="color: var(--color-text-tertiary)">🎁</span>
                <input
                  [value]="giftCardInput()"
                  (input)="onGiftCardInput($event)"
                  type="text"
                  placeholder="GIFTABCD1234"
                  class="flex-1 outline-none bg-transparent"
                  style="font-family: var(--font-mono); font-size: 14px; color: var(--color-text-primary); text-transform: uppercase"
                />
                <button
                  type="button"
                  (click)="applyGiftCard()"
                  [disabled]="!giftCardInput() || giftCardLoading()"
                  class="flex items-center justify-center disabled:opacity-50"
                  style="height: 36px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: 10px; font-family: var(--font-sans); font-size: 13px; font-weight: 600"
                >
                  @if (giftCardLoading()) {
                    …
                  } @else if (giftCardCents() > 0) {
                    {{ 'common.clear' | translate }}
                  } @else {
                    {{ 'common.apply' | translate }}
                  }
                </button>
              </div>
              @if (giftCardStatus()) {
                <span
                  style="font-family: var(--font-sans); font-size: 12px"
                  [style.color]="giftCardCents() > 0 ? 'var(--color-mint)' : 'var(--color-berry)'"
                >
                  {{ giftCardStatus() }}
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

            <!-- How the order gets paid for. Card payments only appear once the
                 acquirer is switched on; until then the honest answer is that
                 the customer pays at the counter. -->
            <section class="w-full flex flex-col" style="max-width: 500px; gap: var(--spacing-sm)">
              <span
                style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-secondary)"
                >{{ 'web.checkout.paymentTitle' | translate }}</span
              >

              @if (cardPaymentsEnabled()) {
                @for (card of cards(); track card.id) {
                  <button
                    type="button"
                    (click)="selectCard(card.id)"
                    class="flex items-center"
                    [style.background]="selectedCardId() === card.id ? 'var(--color-espresso)' : 'var(--color-cream)'"
                    [style.color]="selectedCardId() === card.id ? 'var(--color-foam)' : 'var(--color-espresso)'"
                    [style.border]="selectedCardId() === card.id ? 'none' : '1px solid var(--color-border)'"
                    style="height: 50px; padding: 0 16px; gap: 10px; border-radius: 14px; font-family: var(--font-sans); font-size: 14px; font-weight: 600"
                  >
                    <span>💳</span>
                    <span class="flex-1 text-left">{{ card.maskedPan || card.label }}</span>
                  </button>
                }
              }

              <button
                type="button"
                (click)="selectCard(null)"
                class="flex items-center"
                [style.background]="selectedCardId() === null ? 'var(--color-espresso)' : 'var(--color-cream)'"
                [style.color]="selectedCardId() === null ? 'var(--color-foam)' : 'var(--color-espresso)'"
                [style.border]="selectedCardId() === null ? 'none' : '1px solid var(--color-border)'"
                style="height: 50px; padding: 0 16px; gap: 10px; border-radius: 14px; font-family: var(--font-sans); font-size: 14px; font-weight: 600"
              >
                <span>🏪</span>
                <span class="flex-1 text-left">{{ 'web.checkout.payAtCounter' | translate }}</span>
              </button>

              @if (cardPaymentsEnabled()) {
                <a
                  routerLink="/profile/payment-methods"
                  style="font-family: var(--font-sans); font-size: 13px; color: var(--color-caramel); text-decoration: none"
                  >{{ 'web.checkout.addCard' | translate }}</a
                >
                @if (selectedCardId()) {
                  <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">
                    {{ 'web.checkout.holdHint' | translate }}
                  </span>
                }
              }
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
  private readonly loyalty = inject(LoyaltyService);
  private readonly translate = inject(TranslateService);
  private readonly fmt = inject(LocaleFormatService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly deliveryFeeApi = inject(DeliveryFeeApi);
  private readonly flags = inject(FeatureFlagsStore);
  private readonly cardsApi = inject(PaymentCardsApi);
  private readonly cardsStore = inject(PaymentCardsStore);

  readonly cart = signal<CartView | null>(null);
  readonly mode = signal<PickupMode>('ASAP');
  /** Prices are the store's, whatever currency the customer's profile has. */
  readonly currency = signal<string | null>(null);
  /** Pickup times are the store's clock, wherever the customer is browsing from. */
  readonly storeTimezone = signal<string | null>(null);
  /**
   * Whether the store takes an ASAP order right now — its switch and its
   * working hours, as the API computes them. After hours only a scheduled
   * pickup is accepted, and offering ASAP ended in a bare 400 at payment.
   */
  readonly storeOpen = signal(true);
  readonly fulfillmentType = signal<FulfillmentType>('PICKUP');
  readonly cardPaymentsEnabled = this.flags.cardPaymentsEnabled;
  /**
   * `/config/features` answers after init, so a guard that read the flag once
   * saw it off and never offered the customer's cards. Load them as soon as
   * card payments turn out to be on.
   */
  private readonly loadCardsOnceEnabled = effect(() => {
    if (this.cardPaymentsEnabled()) untracked(() => this.loadCards());
  });
  readonly cards = signal<BoundCard[]>([]);
  /** `null` means "pay at the counter" — always an option, cards or not. */
  readonly selectedCardId = signal<string | null>(null);
  /** Set once the order exists, so a declined card retries the charge rather than placing a second order. */
  private placedOrderId: string | null = null;
  /** ISO start of the chosen slot; empty until the customer picks one. */
  readonly scheduledAt = signal<string>('');
  readonly slots = signal<PickupSlot[]>([]);
  readonly slotsLoading = signal(false);
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

  // Loyalty points — the balance comes from the server and so does the
  // quote, because both are server state the client must not invent.
  readonly pointsBalance = signal(0);
  readonly pointsMin = signal(100);
  readonly pointsInput = signal(0);
  readonly pointsSpent = signal(0);
  readonly pointsDiscountCents = signal(0);
  readonly pointsStatus = signal<string | null>(null);
  readonly pointsLoading = signal(false);

  // Gift card state — same toggle pattern as promo.
  readonly giftCardInput = signal('');
  readonly giftCardCode = signal<string | null>(null);
  readonly giftCardCents = signal(0);
  readonly giftCardStatus = signal<string | null>(null);
  readonly giftCardLoading = signal(false);
  /** Brand ID derived from the active store, needed for /promo/validate. */
  readonly brandId = signal<string | null>(null);
  /** Store ID, needed for /delivery/quote. */
  readonly activeStoreId = signal<string | null>(null);
  /** Store tax config — the same numbers the server settles the order with. */
  readonly taxRateBps = signal(0);
  readonly taxIncludedInPrice = signal(true);

  readonly contactForm = new FormGroup({
    customerName: new FormControl('', { nonNullable: true }),
    notes: new FormControl('', { nonNullable: true }),
  });

  readonly deliveryForm = new FormGroup({
    addressLine: new FormControl('', { nonNullable: true }),
    city: new FormControl('', { nonNullable: true }),
    notes: new FormControl('', { nonNullable: true }),
  });

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
    this.flags.load();

    // Balance up front: the points section only renders when there is
    // enough to redeem, and an empty section is worse than none.
    this.loyalty.me().subscribe({
      next: (account) => this.pointsBalance.set(account.pointsBalance),
      error: () => this.pointsBalance.set(0),
    });

    const storeSlug = this.route.snapshot.queryParamMap.get('store');
    if (storeSlug) {
      this.catalog.getStore(storeSlug).subscribe({
        next: (store) => this.applyStore(store),
      });
    } else {
      this.catalog.listStores().subscribe({
        next: (stores) => {
          const first = stores[0];
          if (first) this.applyStore(first);
        },
      });
    }
  }

  /** Everything checkout takes from the store the order goes to. */
  private applyStore(store: StoreListItem): void {
    this.brandId.set(store.brandId);
    this.deliveryAvailable.set((store.fulfillmentTypes ?? []).includes('DELIVERY'));
    this.activeStoreId.set(store.id);
    this.taxRateBps.set(store.taxRateBps);
    this.taxIncludedInPrice.set(store.taxIncludedInPrice);
    this.currency.set(store.currency);
    this.storeTimezone.set(store.timezone ?? null);
    // `!== false`: an API that predates the field keeps ASAP available.
    this.storeOpen.set(store.openNow !== false);
    if (!this.storeOpen()) this.selectMode('SCHEDULED');
    this.cartService.load(store.id).subscribe((c) => this.cart.set(c));
    this.refreshFeeQuote();
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
          this.promoStatus.set(
            checkoutErrorText(
              { code: res.reasonCode, minOrderCents: res.minOrderCents, currency: res.currency },
              this.translate,
              this.fmt,
            ) ?? this.translate.instant('web.checkout.promoInvalid'),
          );
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
        this.promoStatus.set(this.errorText(err));
      },
    });
  }

  clearPromo(): void {
    this.promoCode.set(null);
    this.discountCents.set(0);
    this.promoStatus.set(null);
  }

  // ── Gift card flow ──────────────────────────────────────────────────────

  onGiftCardInput(event: Event): void {
    this.giftCardInput.set((event.target as HTMLInputElement).value.trim().toUpperCase());
    if (this.giftCardCode() && this.giftCardInput() !== this.giftCardCode()) {
      this.clearGiftCard();
    }
  }

  applyGiftCard(): void {
    if (this.giftCardCents() > 0) {
      this.clearGiftCard();
      return;
    }
    const code = this.giftCardInput();
    const cart = this.cart();
    if (!code || !cart) return;
    this.giftCardLoading.set(true);
    this.giftCardStatus.set(null);
    this.orders.validateGiftCard({ code, cartId: cart.id }).subscribe({
      next: (res) => {
        this.giftCardLoading.set(false);
        this.giftCardCode.set(code);
        this.giftCardCents.set(res.applicableCents);
        this.giftCardStatus.set(
          this.translate.instant('web.checkout.giftCardApplied', { amount: this.price(res.applicableCents) }),
        );
      },
      error: (err) => {
        this.giftCardLoading.set(false);
        this.giftCardStatus.set(this.errorText(err));
      },
    });
  }

  onPointsInput(event: Event): void {
    const raw = Number((event.target as HTMLInputElement).value);
    this.pointsInput.set(Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0);
    if (this.pointsSpent() > 0) this.clearPoints();
  }

  applyPoints(): void {
    const cart = this.cart();
    if (!cart) return;
    const payable = Math.max(0, cart.subtotalCents - this.discountCents());

    this.pointsLoading.set(true);
    this.pointsStatus.set(null);
    this.loyalty.quoteRedemption(this.pointsInput(), payable).subscribe({
      next: (quote) => {
        this.pointsLoading.set(false);
        this.pointsBalance.set(quote.balance);
        this.pointsMin.set(quote.minPoints);
        this.pointsSpent.set(quote.points);
        this.pointsDiscountCents.set(quote.discountCents);
        if (quote.points === 0) {
          // The server refused: too few points, too small an order, or an
          // empty balance. Say which rather than silently doing nothing.
          this.pointsStatus.set(this.translate.instant('web.checkout.pointsTooFew', { min: quote.minPoints }));
          return;
        }
        this.pointsInput.set(quote.points);
        this.pointsStatus.set(
          this.translate.instant('web.checkout.pointsApplied', {
            points: quote.points,
            amount: this.price(quote.discountCents),
          }),
        );
      },
      error: (err) => {
        this.pointsLoading.set(false);
        this.pointsStatus.set(this.errorText(err));
      },
    });
  }

  clearPoints(): void {
    this.pointsSpent.set(0);
    this.pointsDiscountCents.set(0);
    this.pointsStatus.set(null);
  }

  clearGiftCard(): void {
    this.giftCardCode.set(null);
    this.giftCardCents.set(0);
    this.giftCardStatus.set(null);
  }

  /**
   * Runs the server's own tax function so the figure on the button is the
   * figure that gets charged. A tax-exclusive store would otherwise quote
   * 20.00 and take 21.75.
   */
  private breakdown(subtotalCents: number): { taxCents: number; totalCents: number } {
    return computeTax({
      subtotalCents,
      // Points behave as a discount, not a payment: the merchant is
      // lowering the price, so the taxable base falls with it. A gift card
      // is the opposite — see computeTax.
      discountCents: this.discountCents() + this.pointsDiscountCents(),
      deliveryFeeCents: this.fulfillmentType() === 'DELIVERY' ? this.deliveryFeeCents() : 0,
      giftCardCents: this.giftCardCents(),
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

  selectMode(mode: PickupMode): void {
    if (mode === 'ASAP' && !this.storeOpen()) return;
    this.mode.set(mode);
    if (mode === 'SCHEDULED') this.loadSlots();
  }

  selectFulfillment(type: FulfillmentType): void {
    this.fulfillmentType.set(type);
  }

  selectCard(cardId: string | null): void {
    this.selectedCardId.set(cardId);
  }

  selectSlot(slot: PickupSlot): void {
    if (!slot.available) return;
    this.scheduledAt.set(slot.startsAt);
  }

  slotLabel(slot: PickupSlot): string {
    return this.formatTime(new Date(slot.startsAt));
  }

  /**
   * Slots are only fetched when the customer actually asks to schedule —
   * they are the store's live occupancy, so there is no point holding a
   * stale copy behind an ASAP order.
   */
  private loadSlots(): void {
    const storeId = this.activeStoreId();
    if (!storeId) return;
    this.slotsLoading.set(true);
    this.catalog.getPickupSlots(storeId).subscribe({
      next: (slots) => {
        this.slots.set(slots);
        this.slotsLoading.set(false);
        // Pre-select the earliest slot the store can still honour.
        const current = this.scheduledAt();
        const stillValid = slots.some((s) => s.startsAt === current && s.available);
        if (!stillValid) {
          this.scheduledAt.set(slots.find((s) => s.available)?.startsAt ?? '');
        }
      },
      error: () => {
        this.slots.set([]);
        this.slotsLoading.set(false);
      },
    });
  }

  /**
   * Cards are only offered once the acquirer is switched on, and the list is
   * whatever the customer bound in their profile. A silent failure here just
   * means checkout falls back to paying at the counter.
   */
  private loadCards(): void {
    if (!this.cardPaymentsEnabled()) return;
    this.cardsStore.load().subscribe({
      next: (cards) => {
        this.cards.set(cards);
        this.selectedCardId.set((cards.find((c) => c.isDefault) ?? cards[0])?.id ?? null);
      },
      error: () => this.cards.set([]),
    });
  }

  placeOrder(): void {
    const c = this.cart();
    if (!c) return;
    this.submitting.set(true);
    this.error.set(null);

    // Retrying after a declined charge: the order already exists, so charge it
    // again rather than placing a duplicate.
    if (this.placedOrderId) {
      this.payFor(this.placedOrderId);
      return;
    }

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
      pickupAt: this.mode() === 'SCHEDULED' ? this.scheduledAt() : undefined,
      fulfillmentType: this.fulfillmentType(),
      customerName: v.customerName || undefined,
      notes: v.notes || undefined,
      couponCode: this.promoCode() ?? undefined,
      giftCardCode: this.giftCardCode() ?? undefined,
      pointsToSpend: this.pointsSpent() || undefined,
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
        this.placedOrderId = order.id;
        this.payFor(order.id);
      },
      error: (err) => {
        this.submitting.set(false);
        const body = (err as { error?: unknown }).error;
        if (isCartChangedError(body)) {
          this.onCartChanged(c.storeId, body);
          return;
        }
        this.error.set(this.errorText(err));
      },
    });
  }

  /**
   * The server priced the cart again against today's menu and refused the
   * order: a price moved, or something in the basket is gone. It has already
   * brought the cart up to date, so reloading shows what the order costs now.
   * Promo, points and gift card were each worked out for the old total, so
   * they come off; the codes stay typed in, one tap re-applies them.
   */
  private onCartChanged(storeId: string, conflict: CartChangedError): void {
    const removed = [...new Set(conflict.items.filter((i) => i.unitPriceCents === null).map((i) => i.productName))];
    const hadDiscounts = this.promoCode() !== null || this.pointsSpent() > 0 || this.giftCardCode() !== null;
    this.clearPromo();
    this.clearPoints();
    this.clearGiftCard();
    this.error.set(
      [
        this.translate.instant('web.checkout.cartChanged'),
        removed.length > 0
          ? this.translate.instant('web.checkout.cartChangedRemoved', { names: removed.join(', ') })
          : '',
        hadDiscounts ? this.translate.instant('web.checkout.cartChangedDiscounts') : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
    this.cartService.load(storeId).subscribe({
      next: (cart) => this.cart.set(cart),
      error: () => undefined,
    });
  }

  /**
   * Charges the chosen card and then opens the order screen. Paying at the
   * counter skips straight there — the order is placed either way, and the
   * order screen is what tells the customer where their money stands.
   *
   * A decline keeps the customer on checkout with the reason, because that is
   * the only screen where they can pick a different card.
   */
  private payFor(orderId: string): void {
    const cardId = this.selectedCardId();
    if (!this.cardPaymentsEnabled() || !cardId) {
      this.submitting.set(false);
      void this.router.navigate(['/orders', orderId]);
      return;
    }

    this.cardsApi.pay({ orderId, cardId }).subscribe({
      next: () => {
        this.submitting.set(false);
        void this.router.navigate(['/orders', orderId]);
      },
      error: (err) => {
        this.submitting.set(false);
        this.error.set(this.errorText(err));
      },
    });
  }

  price(cents: number): string {
    return this.fmt.money(cents, this.currency());
  }

  private formatTime(date: Date): string {
    return this.fmt.time(date, this.storeTimezone());
  }

  formatKm(metres: number): string {
    return this.fmt.distance(metres);
  }

  /**
   * What went wrong, in the customer's words. A coded API error — the store
   * is closed then, the slot filled up — gets its translation; any other
   * message the API sent is still shown, as the real reason beats a vaguer
   * apology.
   */
  private errorText(err: unknown): string {
    const body = (err as { error?: unknown } | null)?.error;
    const coded = checkoutErrorText(body, this.translate, this.fmt);
    if (coded) return coded;
    if ((err as { status?: unknown } | null)?.status === 0) return this.translate.instant('common.networkError');
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message === 'string' && message) return message;
    return this.translate.instant('common.requestFailed');
  }
}
