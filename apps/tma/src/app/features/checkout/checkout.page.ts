import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { TmaAuthStore } from '../../core/auth/tma-auth.store';
import { CartService, type CartView } from '../../core/cart/cart.service';
import { CatalogService } from '../../core/catalog/catalog.service';
import { OrdersApi } from '../../core/orders/orders.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';

@Component({
  selector: 'app-tma-checkout',
  standalone: true,
  template: `
    <section class="px-4 pt-6 pb-32">
      <h1 class="text-2xl mb-2" style="font-family: var(--font-display)">Checkout</h1>
      <p class="text-sm mb-6" style="opacity: 0.6">Ready in ~{{ etaMinutes() }} min</p>

      @if (cart(); as c) {
        @if (c.items.length === 0) {
          <p class="text-sm" style="opacity: 0.6">Your cart is empty.</p>
        } @else {
          <ul class="flex flex-col gap-2 text-sm mb-6">
            @for (item of c.items; track item.id) {
              <li class="flex justify-between">
                <span>{{ item.quantity }} × {{ item.productName }}</span>
                <span>{{ price(item.unitPriceCents * item.quantity) }}</span>
              </li>
            }
          </ul>
          <hr class="my-3" style="border-color: var(--color-latte)" />
          <div class="flex justify-between font-medium">
            <span>Total</span>
            <span>{{ price(c.subtotalCents) }}</span>
          </div>
          <p class="mt-6 text-xs text-center" style="opacity: 0.5">Tap the Telegram button below to place the order.</p>
        }
      }

      @if (error()) {
        <p class="mt-4 text-sm" style="color: var(--color-berry)">{{ error() }}</p>
      }
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

  readonly cart = signal<CartView | null>(null);
  readonly error = signal<string | null>(null);
  readonly etaMinutes = computed(() => Math.max(1, Math.round((this.cart()?.etaSeconds ?? 0) / 60)));

  private detachBack: (() => void) | null = null;

  ngOnInit(): void {
    this.catalog.listStores().subscribe({
      next: (list) => {
        const first = list[0];
        if (!first) return;
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

  price(cents: number): string {
    return new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(cents / 100);
  }

  private refreshMainButton(): void {
    const c = this.cart();
    if (!c || c.items.length === 0 || !this.authStore.isAuthenticated()) {
      this.tg.hideMainButton();
      return;
    }
    this.tg.setMainButton(`Pay ${this.price(c.subtotalCents)} · ASAP`, () => this.placeOrder());
  }

  private placeOrder(): void {
    const c = this.cart();
    if (!c) return;
    this.tg.haptic('medium');
    this.orders.create({ cartId: c.id, pickupMode: 'ASAP' }).subscribe({
      next: (order) => void this.router.navigate(['/orders', order.id]),
      error: (err) => {
        const maybe = err as { error?: { message?: string }; message?: string };
        this.error.set(maybe.error?.message ?? maybe.message ?? 'Failed to place order');
      },
    });
  }
}
