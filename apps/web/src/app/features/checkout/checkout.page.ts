import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { AuthStore } from '../../core/auth/auth.store';
import { CartService, type CartView } from '../../core/cart/cart.service';
import { CatalogService } from '../../core/catalog/catalog.service';
import { OrdersApi } from '../../core/orders/orders.service';

type PickupMode = 'ASAP' | 'SCHEDULED';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <section class="max-w-xl mx-auto px-4 py-10">
      <h1 class="text-3xl mb-8" style="font-family: var(--font-display)">Checkout</h1>

      @if (!authStore.isAuthenticated()) {
        <p class="p-4 mb-6" style="background: var(--color-amber); color: white; border-radius: var(--radius-card)">
          Please <a routerLink="/login" class="underline">sign in</a> to place an order.
        </p>
      }

      @if (cart(); as c) {
        @if (c.items.length === 0) {
          <p style="opacity: 0.6">Your cart is empty. <a routerLink="/menu" class="underline">Browse the menu</a>.</p>
        } @else {
          <section
            class="mb-6 p-4"
            style="background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft)"
          >
            <h2 class="text-xl mb-3" style="font-family: var(--font-display)">Pickup time</h2>

            <div class="flex gap-2 mb-4">
              <button
                type="button"
                (click)="selectMode('ASAP')"
                class="flex-1 px-4 py-3 border text-sm"
                [style.background]="mode() === 'ASAP' ? 'var(--color-espresso)' : 'transparent'"
                [style.color]="mode() === 'ASAP' ? 'white' : 'var(--color-espresso)'"
                style="border-color: var(--color-espresso); border-radius: var(--radius-pill)"
              >
                ASAP · ready in ~{{ etaMinutes() }} min
              </button>
              <button
                type="button"
                (click)="selectMode('SCHEDULED')"
                class="flex-1 px-4 py-3 border text-sm"
                [style.background]="mode() === 'SCHEDULED' ? 'var(--color-espresso)' : 'transparent'"
                [style.color]="mode() === 'SCHEDULED' ? 'white' : 'var(--color-espresso)'"
                style="border-color: var(--color-espresso); border-radius: var(--radius-pill)"
              >
                Schedule
              </button>
            </div>

            @if (mode() === 'SCHEDULED') {
              <label class="flex flex-col gap-1">
                <span class="text-sm font-medium">Pick up at</span>
                <input
                  type="datetime-local"
                  [value]="scheduledAt()"
                  (change)="onScheduledChange($event)"
                  [min]="minScheduled"
                  class="px-3 py-2 border outline-none"
                  style="border-color: var(--color-latte); border-radius: var(--radius-input)"
                />
                <span class="text-xs mt-1" style="opacity: 0.5"> Between {{ minLabel }} and 24 h from now </span>
              </label>
            }
          </section>

          <section
            class="mb-6 p-4"
            style="background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft)"
          >
            <h2 class="text-xl mb-3" style="font-family: var(--font-display)">Order summary</h2>
            <ul class="flex flex-col gap-2">
              @for (item of c.items; track item.id) {
                <li class="flex justify-between text-sm">
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
          </section>

          <form [formGroup]="contactForm" class="mb-6 flex flex-col gap-3">
            <input
              formControlName="customerName"
              placeholder="Name on the order"
              class="px-4 py-3 border outline-none"
              style="border-color: var(--color-latte); border-radius: var(--radius-input)"
            />
            <input
              formControlName="notes"
              placeholder="Notes for the barista (optional)"
              class="px-4 py-3 border outline-none"
              style="border-color: var(--color-latte); border-radius: var(--radius-input)"
            />
          </form>

          <button
            type="button"
            (click)="placeOrder()"
            [disabled]="!canSubmit() || submitting()"
            class="w-full py-4 text-lg font-medium disabled:opacity-50"
            style="background: var(--color-caramel); color: white; border-radius: var(--radius-button)"
          >
            {{ submitting() ? 'Placing order…' : 'Pay ' + price(c.subtotalCents) + ' · Ready ' + readyLabel() }}
          </button>

          @if (error()) {
            <p class="mt-4 text-sm" style="color: var(--color-berry)">{{ error() }}</p>
          }
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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly cart = signal<CartView | null>(null);
  readonly mode = signal<PickupMode>('ASAP');
  readonly scheduledAt = signal<string>(this.defaultScheduled());
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly etaMinutes = computed(() => Math.max(1, Math.round((this.cart()?.etaSeconds ?? 0) / 60)));
  readonly canSubmit = computed(() => {
    const c = this.cart();
    if (!c || c.items.length === 0) return false;
    if (!this.authStore.isAuthenticated()) return false;
    if (this.mode() === 'SCHEDULED' && !this.scheduledAt()) return false;
    return true;
  });

  readonly contactForm = new FormGroup({
    customerName: new FormControl('', { nonNullable: true }),
    notes: new FormControl('', { nonNullable: true }),
  });

  readonly minScheduled = this.toLocalInput(new Date(Date.now() + 10 * 60_000));
  readonly minLabel = '10 min';

  ngOnInit(): void {
    const storeSlug = this.route.snapshot.queryParamMap.get('store');
    if (storeSlug) {
      this.catalog.getStore(storeSlug).subscribe({
        next: (store) => this.cartService.load(store.id).subscribe((c) => this.cart.set(c)),
      });
    } else {
      // No store hint; fall back to the first store we know about.
      this.catalog.listStores().subscribe({
        next: (stores) => {
          const first = stores[0];
          if (first) this.cartService.load(first.id).subscribe((c) => this.cart.set(c));
        },
      });
    }
  }

  selectMode(mode: PickupMode): void {
    this.mode.set(mode);
  }

  onScheduledChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.scheduledAt.set(value);
  }

  readyLabel(): string {
    if (this.mode() === 'ASAP') {
      const when = new Date(Date.now() + (this.cart()?.etaSeconds ?? 0) * 1000);
      return when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const iso = this.scheduledAt();
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  placeOrder(): void {
    const c = this.cart();
    if (!c) return;
    this.submitting.set(true);
    this.error.set(null);

    const v = this.contactForm.getRawValue();
    const input = {
      cartId: c.id,
      pickupMode: this.mode(),
      pickupAt: this.mode() === 'SCHEDULED' ? new Date(this.scheduledAt()).toISOString() : undefined,
      customerName: v.customerName || undefined,
      notes: v.notes || undefined,
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
