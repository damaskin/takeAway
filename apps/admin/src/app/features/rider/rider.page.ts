import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthService } from '../../core/auth/auth.service';
import { AuthStore } from '../../core/auth/auth.store';
import { DeliveryApi, type RiderQueueRow } from '../../core/delivery/delivery.service';

/**
 * Rider workspace — single-page layout shown to users with role === RIDER.
 *
 * Mental model:
 *   - Top section: "My deliveries" — orders assigned to me, with
 *     actions to move READY → OUT_FOR_DELIVERY → DELIVERED.
 *   - Bottom section: "Available nearby" — unassigned READY orders in
 *     stores where I'm rostered, with a Claim button.
 *
 * Kept compact and phone-friendly because riders are on the move.
 */
@Component({
  selector: 'app-rider',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div
      class="flex items-center justify-between flex-wrap"
      style="min-height: 56px; padding: 10px 16px; background: var(--color-foam); border-bottom: 1px solid var(--color-border-light); gap: 10px"
    >
      <h1
        style="font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        {{ 'admin.rider.title' | translate }}
      </h1>
      <div class="flex items-center" style="gap: 10px">
        <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">
          {{ userName() }}
        </span>
        <button
          type="button"
          (click)="refresh()"
          [disabled]="loading()"
          style="height: 32px; padding: 0 12px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 8px; font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)"
        >
          ↻
        </button>
        <button
          type="button"
          (click)="logout()"
          style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)"
        >
          {{ 'common.signOut' | translate }}
        </button>
      </div>
    </div>

    <section style="padding: 16px; display: flex; flex-direction: column; gap: 24px; max-width: 640px; margin: 0 auto">
      @if (error()) {
        <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 0">
          {{ error() }}
        </p>
      }

      <!-- Mine ─────────────────────────────────────────────────────────── -->
      <div class="flex flex-col" style="gap: 10px">
        <h2
          style="font-family: var(--font-sans); font-size: 12px; font-weight: 700; color: var(--color-text-tertiary); letter-spacing: 1px; text-transform: uppercase; margin: 0"
        >
          {{ 'admin.rider.mine' | translate }}
        </h2>

        @if (mine().length === 0 && !loading()) {
          <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0">
            {{ 'admin.rider.emptyMine' | translate }}
          </p>
        }

        @for (o of mine(); track o.id) {
          <article
            class="flex flex-col"
            style="background: var(--color-foam); border: 2px solid var(--color-caramel); border-radius: 16px; padding: 14px; gap: 10px"
          >
            <div class="flex items-center justify-between" style="gap: 8px">
              <span
                style="font-family: var(--font-sans); font-size: 15px; font-weight: 700; color: var(--color-espresso)"
                >#{{ o.orderCode }}</span
              >
              <span
                [style.background]="statusBg(o.status)"
                [style.color]="statusColor(o.status)"
                style="padding: 3px 10px; border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 700"
                >{{ 'admin.orders.status.' + o.status | translate }}</span
              >
            </div>

            <div class="flex flex-col" style="gap: 2px">
              <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)">
                🏪 {{ o.store.name }} · {{ o.store.addressLine }}
              </span>
              <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-primary)">
                📍 {{ o.deliveryAddressLine }}, {{ o.deliveryCity }}
              </span>
              @if (o.deliveryNotes) {
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">
                  📝 {{ o.deliveryNotes }}
                </span>
              }
              @if (o.customerPhone) {
                <a
                  [attr.href]="'tel:' + o.customerPhone"
                  style="font-family: var(--font-sans); font-size: 13px; color: var(--color-caramel); font-weight: 600"
                >
                  📱 {{ o.customerPhone }}
                </a>
              }
            </div>

            <div class="flex" style="gap: 8px">
              @if (o.status === 'READY') {
                <button
                  type="button"
                  (click)="markOut(o.id)"
                  [disabled]="acting()"
                  class="flex-1 disabled:opacity-50"
                  style="height: 42px; background: var(--color-caramel); color: white; border-radius: 10px; font-family: var(--font-sans); font-size: 14px; font-weight: 600"
                >
                  {{ 'admin.rider.markOut' | translate }}
                </button>
              }
              @if (o.status === 'OUT_FOR_DELIVERY') {
                <button
                  type="button"
                  (click)="markDelivered(o.id)"
                  [disabled]="acting()"
                  class="flex-1 disabled:opacity-50"
                  style="height: 42px; background: #3E8868; color: white; border-radius: 10px; font-family: var(--font-sans); font-size: 14px; font-weight: 600"
                >
                  {{ 'admin.rider.markDelivered' | translate }}
                </button>
              }
            </div>
          </article>
        }
      </div>

      <!-- Available ────────────────────────────────────────────────────── -->
      <div class="flex flex-col" style="gap: 10px">
        <h2
          style="font-family: var(--font-sans); font-size: 12px; font-weight: 700; color: var(--color-text-tertiary); letter-spacing: 1px; text-transform: uppercase; margin: 0"
        >
          {{ 'admin.rider.available' | translate }}
        </h2>

        @if (available().length === 0 && !loading()) {
          <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0">
            {{ 'admin.rider.emptyAvailable' | translate }}
          </p>
        }

        @for (o of available(); track o.id) {
          <article
            class="flex flex-col"
            style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 16px; padding: 14px; gap: 10px"
          >
            <div class="flex items-center justify-between" style="gap: 8px">
              <span
                style="font-family: var(--font-sans); font-size: 15px; font-weight: 700; color: var(--color-espresso)"
                >#{{ o.orderCode }}</span
              >
              <span style="font-family: var(--font-sans); font-size: 11px; color: var(--color-text-tertiary)">
                🏪 {{ o.store.name }}
              </span>
            </div>
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-primary)">
              📍 {{ o.deliveryAddressLine }}, {{ o.deliveryCity }}
            </span>
            <button
              type="button"
              (click)="claim(o.id)"
              [disabled]="acting()"
              class="disabled:opacity-50"
              style="height: 38px; background: var(--color-caramel); color: white; border-radius: 10px; font-family: var(--font-sans); font-size: 13px; font-weight: 600"
            >
              {{ 'admin.rider.claim' | translate }}
            </button>
          </article>
        }
      </div>
    </section>
  `,
})
export class RiderPage implements OnInit {
  private readonly delivery = inject(DeliveryApi);
  private readonly store = inject(AuthStore);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly queue = signal<RiderQueueRow[]>([]);
  readonly loading = signal(false);
  readonly acting = signal(false);
  readonly error = signal<string | null>(null);

  readonly mine = () => this.queue().filter((o) => o.mine);
  readonly available = () => this.queue().filter((o) => !o.mine);

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.delivery.myQueue().subscribe({
      next: (list) => {
        this.queue.set(list);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(extractMessage(err));
      },
    });
  }

  claim(orderId: string): void {
    this.acting.set(true);
    this.delivery.selfAssign(orderId).subscribe({
      next: () => {
        this.acting.set(false);
        this.refresh();
      },
      error: (err) => {
        this.acting.set(false);
        this.error.set(extractMessage(err));
      },
    });
  }

  markOut(orderId: string): void {
    this.patch(orderId, 'OUT_FOR_DELIVERY');
  }

  markDelivered(orderId: string): void {
    this.patch(orderId, 'DELIVERED');
  }

  userName(): string {
    const u = this.store.user();
    return u?.name ?? u?.phone ?? '';
  }

  logout(): void {
    this.auth.logout().subscribe({ complete: () => void this.router.navigate(['/login']) });
  }

  statusBg(status: string): string {
    if (status === 'OUT_FOR_DELIVERY') return 'var(--color-caramel-light)';
    if (status === 'READY') return '#7BC4A433';
    return 'var(--color-surface-variant)';
  }

  statusColor(status: string): string {
    if (status === 'OUT_FOR_DELIVERY') return 'var(--color-caramel)';
    if (status === 'READY') return '#3E8868';
    return 'var(--color-text-secondary)';
  }

  private patch(orderId: string, to: 'OUT_FOR_DELIVERY' | 'DELIVERED'): void {
    this.acting.set(true);
    this.delivery.transitionStatus(orderId, to).subscribe({
      next: () => {
        this.acting.set(false);
        this.refresh();
      },
      error: (err) => {
        this.acting.set(false);
        this.error.set(extractMessage(err));
      },
    });
  }
}

function extractMessage(err: unknown): string {
  const maybe = err as { error?: { message?: unknown }; message?: unknown };
  if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
  if (typeof maybe.message === 'string') return maybe.message;
  return 'Request failed';
}
