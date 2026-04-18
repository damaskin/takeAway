import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthStore } from '../../core/auth/auth.store';
import { CartService, type CartView } from '../../core/cart/cart.service';
import { CatalogService } from '../../core/catalog/catalog.service';
import { OrdersApi } from '../../core/orders/orders.service';

type PickupMode = 'ASAP' | 'SCHEDULED';
type PaymentMethod = 'APPLE_PAY' | 'GOOGLE_PAY' | 'CARD';

interface Step {
  n: number;
  label: string;
  state: 'current' | 'done' | 'upcoming';
}

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
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
              >{{ step.label }}</span
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
            Your cart is empty. <a routerLink="/menu" class="underline">Browse the menu</a>.
          </p>
        } @else {
          <div
            class="flex flex-col items-center"
            style="gap: var(--spacing-xl); padding: var(--spacing-2xl) var(--spacing-base)"
          >
            <h1
              style="font-family: var(--font-display); font-size: 32px; font-weight: 600; color: var(--color-espresso); text-align: center"
            >
              When are you coming?
            </h1>

            <section
              class="w-full"
              style="max-width: 500px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: var(--spacing-xl); display: flex; flex-direction: column; gap: var(--spacing-lg)"
            >
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
                  ASAP
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
                  Later
                </button>
              </div>

              @if (mode() === 'SCHEDULED') {
                <label class="flex flex-col gap-1">
                  <span
                    style="font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-text-secondary)"
                    >Pick up at</span
                  >
                  <input
                    type="datetime-local"
                    [value]="scheduledAt()"
                    (change)="onScheduledChange($event)"
                    [min]="minScheduled"
                    style="padding: 12px 14px; border: 1px solid var(--color-border); background: var(--color-cream); border-radius: 12px; font-family: var(--font-sans); font-size: 14px; color: var(--color-espresso); outline: none"
                  />
                  <span style="font-size: 12px; color: var(--color-text-tertiary)"
                    >Between 10 min and 24 h from now</span
                  >
                </label>
              }

              <div>
                <p
                  style="font-family: var(--font-sans); font-size: 24px; font-weight: 700; color: var(--color-caramel)"
                >
                  Ready by {{ readyTimeLabel() }}
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
                <span
                  style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-espresso)"
                  >Total</span
                >
                <span
                  style="font-family: var(--font-sans); font-size: 16px; font-weight: 700; color: var(--color-caramel)"
                >
                  {{ price(c.subtotalCents) }}
                </span>
              </div>
            </section>

            <form
              [formGroup]="contactForm"
              class="w-full flex flex-col"
              style="max-width: 500px; gap: var(--spacing-md)"
            >
              <input
                formControlName="customerName"
                placeholder="Name on the order"
                style="padding: 14px 16px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: 12px; font-family: var(--font-sans); font-size: 14px; color: var(--color-espresso); outline: none"
              />
              <input
                formControlName="notes"
                placeholder="Notes for the barista (optional)"
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
                submitting() ? 'Placing order…' : 'Pay ' + price(c.subtotalCents) + ' · Ready by ' + readyTimeLabel()
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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly cart = signal<CartView | null>(null);
  readonly mode = signal<PickupMode>('ASAP');
  readonly payment = signal<PaymentMethod>('APPLE_PAY');
  readonly scheduledAt = signal<string>(this.defaultScheduled());
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly contactForm = new FormGroup({
    customerName: new FormControl('', { nonNullable: true }),
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
    { n: 1, label: 'Time & store', state: 'current' },
    { n: 2, label: 'Contact', state: this.contactForm.controls.customerName.value ? 'done' : 'current' },
    { n: 3, label: 'Payment', state: 'upcoming' },
  ]);

  readonly canSubmit = computed(() => {
    const c = this.cart();
    if (!c || c.items.length === 0) return false;
    if (!this.authStore.isAuthenticated()) return false;
    if (this.mode() === 'SCHEDULED' && !this.scheduledAt()) return false;
    return true;
  });

  ngOnInit(): void {
    const storeSlug = this.route.snapshot.queryParamMap.get('store');
    if (storeSlug) {
      this.catalog.getStore(storeSlug).subscribe({
        next: (store) => this.cartService.load(store.id).subscribe((c) => this.cart.set(c)),
      });
    } else {
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

  private formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
