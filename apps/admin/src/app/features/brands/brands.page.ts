import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

import {
  AdminBrand,
  BrandModerationStatus,
  BrandsService,
  SetBrandModerationRequest,
} from '../../core/brands/brands.service';

type Tab = BrandModerationStatus;

@Component({
  selector: 'app-admin-brands',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, TranslatePipe],
  template: `
    <section style="padding: 32px; max-width: 1100px">
      <header class="flex items-center justify-between" style="gap: 16px; margin-bottom: 24px">
        <div>
          <h1 style="font-family: var(--font-display); font-size: 28px; color: var(--color-espresso); margin: 0">
            {{ 'admin.brands.title' | translate }}
          </h1>
          <p
            style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 4px 0 0"
          >
            {{ 'admin.brands.subtitle' | translate }}
          </p>
        </div>
      </header>

      <div class="flex" style="gap: 8px; margin-bottom: 16px">
        @for (t of tabs; track t) {
          <button
            type="button"
            class="tab"
            [class.tab-active]="tab() === t"
            (click)="setTab(t)"
            style="padding: 8px 16px; border-radius: 999px; border: 1px solid var(--color-border); font-family: var(--font-sans); font-size: 14px; cursor: pointer"
          >
            {{ 'admin.brands.tabs.' + t | translate }} · {{ counts()[t] }}
          </button>
        }
      </div>

      @if (loading()) {
        <p style="font-family: var(--font-sans); color: var(--color-text-secondary)">
          {{ 'common.loading' | translate }}
        </p>
      } @else if (filtered().length === 0) {
        <p style="font-family: var(--font-sans); color: var(--color-text-secondary)">
          {{ 'admin.brands.empty' | translate }}
        </p>
      } @else {
        <div class="flex flex-col" style="gap: 12px">
          @for (b of filtered(); track b.id) {
            <article
              style="background: var(--color-foam); border-radius: var(--radius-card); padding: 20px; box-shadow: var(--shadow-soft)"
            >
              <div class="flex items-start justify-between" style="gap: 16px">
                <div>
                  <p
                    style="font-family: var(--font-display); font-size: 20px; color: var(--color-espresso); margin: 0 0 4px"
                  >
                    {{ b.name }}
                    <span
                      [attr.data-status]="b.moderationStatus"
                      class="status-pill"
                      style="margin-left: 8px; font-family: var(--font-sans); font-size: 11px; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; vertical-align: middle"
                      >{{ 'admin.brands.status.' + b.moderationStatus | translate }}</span
                    >
                  </p>
                  <p
                    style="font-family: var(--font-mono); font-size: 12px; color: var(--color-text-tertiary); margin: 0"
                  >
                    {{ b.slug }}
                  </p>
                </div>
                <div
                  style="text-align: right; font-family: var(--font-sans); font-size: 12px; color: var(--color-text-secondary)"
                >
                  <div>{{ 'admin.brands.submitted' | translate }}: {{ b.submittedAt | date: 'MMM d, y, HH:mm' }}</div>
                  @if (b.moderatedAt) {
                    <div>{{ 'admin.brands.moderated' | translate }}: {{ b.moderatedAt | date: 'MMM d, y, HH:mm' }}</div>
                  }
                </div>
              </div>

              <dl
                class="flex flex-wrap"
                style="gap: 24px; margin: 16px 0 0; font-family: var(--font-sans); font-size: 13px"
              >
                <div>
                  <dt style="color: var(--color-text-tertiary)">{{ 'admin.brands.owner' | translate }}</dt>
                  <dd style="margin: 2px 0 0; color: var(--color-text-primary)">
                    @if (b.owner) {
                      {{ b.owner.name || '—' }} · {{ b.owner.email || '—' }}
                    } @else {
                      —
                    }
                  </dd>
                </div>
                <div>
                  <dt style="color: var(--color-text-tertiary)">{{ 'admin.brands.stores' | translate }}</dt>
                  <dd style="margin: 2px 0 0; color: var(--color-text-primary)">{{ b._count.stores }}</dd>
                </div>
                <div>
                  <dt style="color: var(--color-text-tertiary)">{{ 'admin.brands.products' | translate }}</dt>
                  <dd style="margin: 2px 0 0; color: var(--color-text-primary)">{{ b._count.products }}</dd>
                </div>
              </dl>

              @if (b.moderationNote) {
                <p
                  style="margin: 12px 0 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); background: var(--color-cream); padding: 8px 12px; border-radius: 8px"
                >
                  {{ 'admin.brands.note' | translate }}: {{ b.moderationNote }}
                </p>
              }

              @if (b.moderationStatus !== 'APPROVED' && b.moderationStatus !== 'REJECTED') {
                <div class="flex" style="gap: 8px; margin-top: 16px">
                  <button
                    type="button"
                    (click)="setStatus(b, 'APPROVED')"
                    [disabled]="actingOnId() === b.id"
                    class="disabled:opacity-50"
                    style="padding: 8px 16px; background: var(--color-mint); color: white; border: 0; border-radius: var(--radius-button); font-family: var(--font-sans); font-weight: 600; cursor: pointer"
                  >
                    {{ 'admin.brands.approve' | translate }}
                  </button>
                  <button
                    type="button"
                    (click)="setStatus(b, 'REJECTED')"
                    [disabled]="actingOnId() === b.id"
                    class="disabled:opacity-50"
                    style="padding: 8px 16px; background: var(--color-berry); color: white; border: 0; border-radius: var(--radius-button); font-family: var(--font-sans); font-weight: 600; cursor: pointer"
                  >
                    {{ 'admin.brands.reject' | translate }}
                  </button>
                </div>
              } @else {
                <div class="flex" style="gap: 8px; margin-top: 16px">
                  <button
                    type="button"
                    (click)="setStatus(b, 'PENDING')"
                    [disabled]="actingOnId() === b.id"
                    class="disabled:opacity-50"
                    style="padding: 8px 16px; background: var(--color-latte); color: var(--color-espresso); border: 0; border-radius: var(--radius-button); font-family: var(--font-sans); font-weight: 600; cursor: pointer"
                  >
                    {{ 'admin.brands.revert' | translate }}
                  </button>
                </div>
              }
            </article>
          }
        </div>
      }

      @if (error()) {
        <p style="margin-top: 16px; color: var(--color-berry)">{{ error() }}</p>
      }
    </section>
  `,
  styles: [
    `
      .tab {
        background: var(--color-foam);
        color: var(--color-text-secondary);
      }
      .tab-active {
        background: var(--color-caramel);
        color: white;
        border-color: var(--color-caramel);
      }
      .status-pill[data-status='PENDING'] {
        background: var(--color-amber);
        color: white;
      }
      .status-pill[data-status='APPROVED'] {
        background: var(--color-mint);
        color: white;
      }
      .status-pill[data-status='REJECTED'] {
        background: var(--color-berry);
        color: white;
      }
    `,
  ],
})
export class AdminBrandsPage {
  private readonly brands = inject(BrandsService);

  readonly tabs: ReadonlyArray<Tab> = ['PENDING', 'APPROVED', 'REJECTED'];
  readonly tab = signal<Tab>('PENDING');
  readonly all = signal<AdminBrand[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly actingOnId = signal<string | null>(null);
  readonly noteInput = new FormControl('', { nonNullable: true });

  readonly counts = computed(() => {
    const c: Record<Tab, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
    for (const b of this.all()) c[b.moderationStatus]++;
    return c;
  });

  readonly filtered = computed(() => this.all().filter((b) => b.moderationStatus === this.tab()));

  constructor() {
    this.load();
  }

  setTab(t: Tab): void {
    this.tab.set(t);
  }

  setStatus(brand: AdminBrand, status: BrandModerationStatus): void {
    const body: SetBrandModerationRequest = { status };
    if (status === 'REJECTED') {
      const note = window.prompt('Reason for rejection (optional):') ?? undefined;
      if (note) body.note = note;
    }
    this.actingOnId.set(brand.id);
    this.error.set(null);
    this.brands.setModeration(brand.id, body).subscribe({
      next: (updated) => {
        this.all.update((list) => list.map((b) => (b.id === updated.id ? { ...b, ...updated } : b)));
        this.actingOnId.set(null);
      },
      error: (err) => {
        this.actingOnId.set(null);
        this.error.set(this.extractMessage(err));
      },
    });
  }

  private load(): void {
    this.loading.set(true);
    this.brands.list().subscribe({
      next: (list) => {
        this.all.set(list);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(this.extractMessage(err));
      },
    });
  }

  private extractMessage(err: unknown): string {
    const maybe = err as { error?: { message?: unknown }; message?: unknown };
    if (maybe.error?.message && typeof maybe.error.message === 'string') return maybe.error.message;
    if (typeof maybe.message === 'string') return maybe.message;
    return 'Something went wrong';
  }
}
