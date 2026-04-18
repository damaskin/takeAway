import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { TmaAuthStore } from '../../core/auth/tma-auth.store';
import { CartService, type CartView } from '../../core/cart/cart.service';
import { CatalogService } from '../../core/catalog/catalog.service';
import { OrdersApi } from '../../core/orders/orders.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';

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
  imports: [TranslatePipe],
  template: `
    <section style="padding: 16px; padding-bottom: 100px; display: flex; flex-direction: column; gap: 20px">
      <h1
        style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        {{ 'tma.checkout.title' | translate }}
      </h1>

      <!-- Pickup time -->
      <div class="flex flex-col" style="gap: 12px">
        <span
          style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-primary)"
          >{{ 'tma.checkout.pickupWhen' | translate }}</span
        >
        <div class="flex" style="gap: 8px">
          <button
            type="button"
            (click)="setPickup('ASAP')"
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
        @if (pickupMode() === 'SCHEDULED') {
          <input
            type="datetime-local"
            [value]="scheduledAt()"
            (change)="onScheduledChange($event)"
            style="height: 44px; padding: 0 14px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)"
          />
        }
      </div>

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
              <div class="flex items-center justify-between">
                <span
                  style="font-family: var(--font-sans); font-size: 15px; font-weight: 600; color: var(--color-text-primary)"
                  >{{ 'common.total' | translate }}</span
                >
                <span
                  style="font-family: var(--font-sans); font-size: 18px; font-weight: 700; color: var(--color-caramel)"
                  >{{ price(c.subtotalCents) }}</span
                >
              </div>
            </div>
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
  private readonly orders = inject(OrdersApi);
  private readonly tg = inject(TelegramBridgeService);
  private readonly router = inject(Router);
  private readonly authStore = inject(TmaAuthStore);
  private readonly translate = inject(TranslateService);

  readonly cart = signal<CartView | null>(null);
  readonly error = signal<string | null>(null);
  readonly pickupMode = signal<'ASAP' | 'SCHEDULED'>('ASAP');
  readonly scheduledAt = signal<string>(this.defaultScheduledAt());
  readonly storeName = signal<string>('');
  readonly etaMinutes = computed(() => Math.max(1, Math.round((this.cart()?.etaSeconds ?? 0) / 60)));

  private detachBack: (() => void) | null = null;

  ngOnInit(): void {
    this.catalog.listStores().subscribe({
      next: (list) => {
        const first = list[0];
        if (!first) return;
        this.storeName.set(first.name);
        this.cartService.load(first.id).subscribe({
          next: (c) => {
            this.cart.set(c);
            this.refreshMainButton();
          },
        });
      },
    });

    this.detachBack = this.tg.setBackButton(() => {
      if (history.length > 1) history.back();
      else void this.router.navigate(['/']);
    });
  }

  ngOnDestroy(): void {
    this.detachBack?.();
    this.tg.hideMainButton();
  }

  setPickup(mode: 'ASAP' | 'SCHEDULED'): void {
    this.pickupMode.set(mode);
    this.tg.haptic('light');
    this.refreshMainButton();
  }

  onScheduledChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.scheduledAt.set(input.value);
    this.refreshMainButton();
  }

  price(cents: number): string {
    return new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(cents / 100);
  }

  private defaultScheduledAt(): string {
    const d = new Date(Date.now() + 30 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
      d.getMinutes(),
    )}`;
  }

  private refreshMainButton(): void {
    const c = this.cart();
    if (!c || c.items.length === 0 || !this.authStore.isAuthenticated()) {
      this.tg.hideMainButton();
      return;
    }
    const total = this.price(c.subtotalCents);
    const key = this.pickupMode() === 'ASAP' ? 'tma.checkout.payAsap' : 'tma.checkout.payScheduled';
    const label = this.translate.instant(key, { total });
    this.tg.setMainButton(label, () => this.placeOrder());
  }

  private placeOrder(): void {
    const c = this.cart();
    if (!c) return;
    this.tg.haptic('medium');
    const pickupAt = this.pickupMode() === 'SCHEDULED' ? new Date(this.scheduledAt()).toISOString() : undefined;
    this.orders.create({ cartId: c.id, pickupMode: this.pickupMode(), pickupAt }).subscribe({
      next: (order) => void this.router.navigate(['/orders', order.id]),
      error: (err) => {
        const maybe = err as { error?: { message?: string }; message?: string };
        this.error.set(
          maybe.error?.message ?? maybe.message ?? this.translate.instant('tma.checkout.placeOrderFailed'),
        );
      },
    });
  }
}
