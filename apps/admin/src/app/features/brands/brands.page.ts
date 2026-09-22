import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import {
  AdminBrand,
  BrandModerationStatus,
  BrandsService,
  SetBrandModerationRequest,
} from '../../core/brands/brands.service';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'THB', 'IDR', 'MDL', 'RUP'] as const;

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
        <button
          type="button"
          (click)="toggleCreate()"
          style="padding: 10px 18px; background: var(--color-caramel); color: white; border: 0; border-radius: var(--radius-button); font-family: var(--font-sans); font-weight: 600; cursor: pointer"
        >
          {{ (createOpen() ? 'common.close' : 'admin.brands.create.cta') | translate }}
        </button>
      </header>

      @if (createOpen()) {
        <form
          [formGroup]="createForm"
          (ngSubmit)="submitCreate()"
          class="grid"
          style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; padding: 20px; margin-bottom: 20px; background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft)"
        >
          <p
            style="grid-column: 1 / -1; margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
          >
            {{ 'admin.brands.create.hint' | translate }}
          </p>
          <label class="flex flex-col" style="gap: 4px">
            <span class="field-label">{{ 'admin.brands.create.name' | translate }}</span>
            <input formControlName="name" (input)="syncSlug()" class="field-input" />
          </label>
          <label class="flex flex-col" style="gap: 4px">
            <span class="field-label">{{ 'admin.brands.create.slug' | translate }}</span>
            <input formControlName="slug" class="field-input" style="font-family: var(--font-mono)" />
          </label>
          <label class="flex flex-col" style="gap: 4px">
            <span class="field-label">{{ 'admin.brands.create.currency' | translate }}</span>
            <select formControlName="currency" class="field-input">
              @for (c of currencies; track c) {
                <option [value]="c">{{ c }}</option>
              }
            </select>
          </label>
          <label class="flex flex-col" style="gap: 4px">
            <span class="field-label">{{ 'admin.brands.create.locale' | translate }}</span>
            <select formControlName="locale" class="field-input">
              <option value="EN">EN</option>
              <option value="RU">RU</option>
            </select>
          </label>
          <div style="grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px">
            <button
              type="submit"
              [disabled]="createForm.invalid || creating()"
              class="disabled:opacity-50"
              style="padding: 10px 20px; background: var(--color-caramel); color: white; border: 0; border-radius: var(--radius-button); font-family: var(--font-sans); font-weight: 600; cursor: pointer"
            >
              {{ (creating() ? 'common.loading' : 'admin.brands.create.submit') | translate }}
            </button>
          </div>
          @if (createError()) {
            <p style="grid-column: 1 / -1; margin: 0; color: var(--color-berry); font-family: var(--font-sans)">
              {{ createError() }}
            </p>
          }
        </form>
      }

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
      .field-label {
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-text-secondary);
      }
      .field-input {
        height: 38px;
        padding: 0 12px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-input);
        font-family: var(--font-sans);
        font-size: 14px;
        background: var(--color-cream);
      }
    `,
  ],
})
export class AdminBrandsPage {
  private readonly brands = inject(BrandsService);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly translate = inject(TranslateService);

  readonly currencies = CURRENCIES;
  readonly createOpen = signal(false);
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);
  readonly createForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    slug: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.pattern(/^[a-z0-9-]+$/)],
    }),
    currency: new FormControl<string>('USD', { nonNullable: true }),
    locale: new FormControl<'EN' | 'RU'>('EN', { nonNullable: true }),
  });

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

  toggleCreate(): void {
    this.createOpen.update((v) => !v);
    this.createError.set(null);
  }

  /** Keeps the slug in step with the name until the operator edits it. */
  syncSlug(): void {
    const slug = this.createForm.controls.slug;
    if (slug.dirty) return;
    slug.setValue(slugify(this.createForm.controls.name.value), { emitEvent: false });
  }

  submitCreate(): void {
    if (this.createForm.invalid) return;
    const v = this.createForm.getRawValue();
    this.creating.set(true);
    this.createError.set(null);
    this.brands.create({ name: v.name.trim(), slug: v.slug.trim(), currency: v.currency, locale: v.locale }).subscribe({
      next: (brand) => {
        this.creating.set(false);
        this.createOpen.set(false);
        this.createForm.reset({ name: '', slug: '', currency: 'USD', locale: 'EN' });
        this.all.update((list) => [brand, ...list]);
        this.tab.set(brand.moderationStatus);
        // Make it the context the rest of the panel works in, so stores
        // and menu are immediately usable without a reload.
        this.activeBrand.adopt({
          id: brand.id,
          slug: brand.slug,
          name: brand.name,
          currency: brand.currency,
          locale: brand.locale,
          logoUrl: null,
        });
      },
      error: (err) => {
        this.creating.set(false);
        this.createError.set(this.extractMessage(err));
      },
    });
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
    if (Array.isArray((maybe.error as { message?: unknown })?.message)) {
      return ((maybe.error as { message: unknown[] }).message as string[]).join(', ');
    }
    if (typeof maybe.message === 'string') return maybe.message;
    return this.translate.instant('common.genericError');
  }
}

function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
