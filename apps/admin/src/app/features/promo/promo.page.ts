import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import type { Promo, PromoStatus, PromoType } from '@takeaway/shared-types';
import { TranslatePipe } from '@ngx-translate/core';

import { AdminPromoApi } from '../../core/promo/promo.service';

type FilterKey = 'All' | 'Running' | 'Scheduled' | 'Expired' | 'Paused' | 'Draft';

const FILTER_MAP: Record<Exclude<FilterKey, 'All'>, PromoStatus> = {
  Running: 'RUNNING',
  Scheduled: 'SCHEDULED',
  Expired: 'EXPIRED',
  Paused: 'PAUSED',
  Draft: 'DRAFT',
};

/**
 * Admin Promo / Loyalty — pencil C4 (5fLM7).
 *
 * Lists /admin/promo, supports status filter, PATCHes status from the table,
 * and has a lightweight inline "create promo" form that POSTs /admin/promo.
 */
@Component({
  selector: 'app-admin-promo',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe],
  template: `
    <div
      class="flex items-center justify-between"
      style="height: 64px; padding: 0 24px; background: var(--color-foam); border-bottom: 1px solid var(--color-border-light)"
    >
      <h1
        style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        {{ 'admin.promo.title' | translate }}
      </h1>
      <div class="flex items-center" style="gap: 8px">
        <button
          type="button"
          (click)="refresh()"
          [disabled]="loading()"
          class="flex items-center"
          style="height: 36px; padding: 0 14px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
        >
          {{ (loading() ? 'common.refreshing' : 'common.refresh') | translate }}
        </button>
        <button
          type="button"
          (click)="toggleForm()"
          class="flex items-center"
          style="height: 36px; padding: 0 14px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 13px; font-weight: 600"
        >
          {{ (formOpen() ? 'admin.promo.closeForm' : 'admin.promo.newPromo') | translate }}
        </button>
      </div>
    </div>

    <section style="padding: 24px; display: flex; flex-direction: column; gap: 24px">
      <!-- Loyalty tier cards (static — tiers come from M5 analytics) -->
      <div class="grid" style="grid-template-columns: repeat(4, 1fr); gap: 16px">
        @for (t of tiers; track t.name) {
          <article
            class="flex flex-col"
            [style.background]="t.gradient"
            style="border-radius: 20px; padding: 20px; gap: 8px; color: white"
          >
            <span
              style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.8); letter-spacing: 1px"
              >{{ t.name.toUpperCase() }}</span
            >
            <span style="font-family: var(--font-display); font-size: 28px; font-weight: 700">{{ t.members }}</span>
            <span style="font-family: var(--font-sans); font-size: 12px; color: rgba(255,255,255,0.8)"
              >{{ t.threshold }} {{ 'admin.promo.tiers.pointsSuffix' | translate }} · {{ t.benefit | translate }}</span
            >
          </article>
        }
      </div>

      <!-- Create form -->
      @if (formOpen()) {
        <article
          [formGroup]="form"
          style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; padding: 20px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px"
        >
          <input
            formControlName="code"
            placeholder="Code (ex. WELCOME10)"
            style="grid-column: span 1; height: 40px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 10px; font-family: var(--font-mono); font-size: 13px; text-transform: uppercase"
          />
          <input
            formControlName="label"
            placeholder="Label"
            style="grid-column: span 2; height: 40px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 10px; font-family: var(--font-sans); font-size: 13px"
          />
          <select
            formControlName="type"
            style="height: 40px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 10px; font-family: var(--font-sans); font-size: 13px"
          >
            <option value="PERCENT">Percent off</option>
            <option value="FIXED">Fixed cents off</option>
            <option value="BOGO">BOGO</option>
            <option value="POINTS_MULTIPLIER">Points multiplier (×10)</option>
          </select>
          <input
            formControlName="value"
            type="number"
            placeholder="Value"
            style="height: 40px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 10px; font-family: var(--font-sans); font-size: 13px"
          />
          <input
            formControlName="startsAt"
            type="datetime-local"
            style="height: 40px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 10px; font-family: var(--font-sans); font-size: 13px"
          />
          <input
            formControlName="endsAt"
            type="datetime-local"
            style="height: 40px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 10px; font-family: var(--font-sans); font-size: 13px"
          />
          <select
            formControlName="status"
            style="height: 40px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 10px; font-family: var(--font-sans); font-size: 13px"
          >
            <option value="DRAFT">Draft</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="RUNNING">Running</option>
          </select>
          <button
            type="button"
            (click)="submit()"
            [disabled]="form.invalid || submitting()"
            class="disabled:opacity-50"
            style="grid-column: span 4; height: 42px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600"
          >
            {{ submitting() ? 'Saving…' : 'Create promo' }}
          </button>
          @if (formError()) {
            <span
              style="grid-column: span 4; font-family: var(--font-sans); font-size: 12px; color: var(--color-berry)"
              >{{ formError() }}</span
            >
          }
        </article>
      }

      <!-- Promos table -->
      <article
        class="flex flex-col"
        style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 20px; overflow: hidden"
      >
        <header
          class="flex items-center justify-between"
          style="padding: 20px; border-bottom: 1px solid var(--color-border-light)"
        >
          <div class="flex flex-col" style="gap: 4px">
            <h2
              style="font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--color-espresso); margin: 0"
            >
              {{ 'admin.promo.table.title' | translate }}
            </h2>
            <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-tertiary)"
              >{{ promos().length }} total · {{ runningCount() }} running</span
            >
          </div>
          <div class="flex" style="gap: 8px">
            @for (f of filters; track f) {
              <button
                type="button"
                (click)="filter.set(f)"
                [style.background]="filter() === f ? 'var(--color-caramel)' : 'var(--color-cream)'"
                [style.color]="filter() === f ? 'white' : 'var(--color-text-primary)'"
                style="height: 30px; padding: 0 14px; border-radius: 9999px; font-family: var(--font-sans); font-size: 12px; font-weight: 600"
              >
                {{ 'admin.promo.filters.' + f.toLowerCase() | translate }}
              </button>
            }
          </div>
        </header>

        @if (filtered().length === 0) {
          <p
            class="text-center"
            style="padding: 40px; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)"
          >
            @if (loading()) {
              {{ 'admin.promo.table.loading' | translate }}
            } @else {
              No promos in this bucket yet.
            }
          </p>
        } @else {
          <table style="width: 100%; border-collapse: collapse; font-family: var(--font-sans)">
            <thead style="background: var(--color-cream)">
              <tr>
                <th
                  style="text-align: left; padding: 12px 16px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                >
                  {{ 'admin.promo.table.code' | translate }}
                </th>
                <th
                  style="text-align: left; padding: 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                >
                  {{ 'admin.promo.table.label' | translate }}
                </th>
                <th
                  style="text-align: left; padding: 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                >
                  {{ 'admin.promo.table.type' | translate }}
                </th>
                <th
                  style="text-align: right; padding: 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                >
                  {{ 'admin.promo.table.value' | translate }}
                </th>
                <th
                  style="text-align: left; padding: 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                >
                  {{ 'admin.promo.table.window' | translate }}
                </th>
                <th
                  style="text-align: right; padding: 12px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                >
                  {{ 'admin.promo.table.usage' | translate }}
                </th>
                <th
                  style="text-align: center; padding: 12px 16px; font-size: 11px; font-weight: 600; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                >
                  {{ 'admin.promo.table.status' | translate }}
                </th>
              </tr>
            </thead>
            <tbody>
              @for (p of filtered(); track p.id) {
                <tr style="border-top: 1px solid var(--color-border-light)">
                  <td
                    style="padding: 12px 16px; font-family: var(--font-mono); font-size: 13px; font-weight: 700; color: var(--color-caramel)"
                  >
                    {{ p.code }}
                  </td>
                  <td style="padding: 12px; font-size: 14px; color: var(--color-text-primary)">{{ p.label }}</td>
                  <td style="padding: 12px; font-size: 13px; color: var(--color-text-secondary)">{{ p.type }}</td>
                  <td
                    style="padding: 12px; font-size: 14px; font-weight: 600; color: var(--color-text-primary); text-align: right"
                  >
                    {{ formatValue(p) }}
                  </td>
                  <td style="padding: 12px; font-size: 12px; color: var(--color-text-secondary)">
                    {{ formatWindow(p) }}
                  </td>
                  <td style="padding: 12px; font-size: 13px; color: var(--color-text-secondary); text-align: right">
                    {{ p.redemptionsCount }}{{ p.maxRedemptions > 0 ? '/' + p.maxRedemptions : '' }}
                  </td>
                  <td style="padding: 12px 16px; text-align: center">
                    <button
                      type="button"
                      (click)="cyclePromo(p)"
                      [style.background]="statusBg(p.status)"
                      [style.color]="statusColor(p.status)"
                      style="padding: 4px 10px; border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 700; border: none; cursor: pointer"
                    >
                      {{ p.status }}
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </article>
    </section>
  `,
})
export class AdminPromoPage implements OnInit {
  private readonly api = inject(AdminPromoApi);

  readonly filter = signal<FilterKey>('All');
  readonly filters: FilterKey[] = ['All', 'Running', 'Scheduled', 'Paused', 'Draft', 'Expired'];

  readonly loading = signal(false);
  readonly promos = signal<Promo[]>([]);
  readonly formOpen = signal(false);
  readonly submitting = signal(false);
  readonly formError = signal<string | null>(null);

  readonly form = new FormGroup({
    code: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2)] }),
    label: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    type: new FormControl<PromoType>('PERCENT', { nonNullable: true }),
    value: new FormControl(10, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    startsAt: new FormControl(this.toLocalInput(new Date()), { nonNullable: true }),
    endsAt: new FormControl(this.toLocalInput(new Date(Date.now() + 7 * 24 * 60 * 60_000)), { nonNullable: true }),
    status: new FormControl<PromoStatus>('SCHEDULED', { nonNullable: true }),
  });

  readonly tiers = [
    {
      name: 'Silver',
      members: '—',
      threshold: '0',
      benefit: 'admin.promo.tiers.silverBenefit',
      gradient: 'linear-gradient(135deg, #A39888 0%, #6B5E54 100%)',
    },
    {
      name: 'Gold',
      members: '—',
      threshold: '1,500',
      benefit: 'admin.promo.tiers.goldBenefit',
      gradient: 'linear-gradient(135deg, var(--color-caramel) 0%, #a0612a 100%)',
    },
    {
      name: 'Platinum',
      members: '—',
      threshold: '3,000',
      benefit: 'admin.promo.tiers.platinumBenefit',
      gradient: 'linear-gradient(135deg, #8E5FB0 0%, #5B3D78 100%)',
    },
    {
      name: 'Signature',
      members: '—',
      threshold: '10,000',
      benefit: 'admin.promo.tiers.signatureBenefit',
      gradient: 'linear-gradient(135deg, #1a1414 0%, #3a3430 100%)',
    },
  ];

  readonly filtered = computed<Promo[]>(() => {
    const all = this.promos();
    const f = this.filter();
    if (f === 'All') return all;
    const target = FILTER_MAP[f];
    return all.filter((p) => p.status === target);
  });

  readonly runningCount = computed(() => this.promos().filter((p) => p.status === 'RUNNING').length);

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.api.list().subscribe({
      next: (list) => {
        this.promos.set(list);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  toggleForm(): void {
    this.formOpen.update((v) => !v);
    this.formError.set(null);
  }

  submit(): void {
    const first = this.promos()[0];
    const brandId = first?.brandId;
    if (!brandId) {
      // Bootstrap case: no promos yet → we need to know which brand we're in.
      // For M3 we rely on having at least one seeded promo; future UI will
      // surface a brand picker.
      this.formError.set('Refresh first to load a brand context');
      return;
    }
    if (this.form.invalid) return;
    this.submitting.set(true);
    this.formError.set(null);
    const v = this.form.getRawValue();
    this.api
      .create({
        brandId,
        code: v.code.toUpperCase(),
        label: v.label,
        type: v.type,
        value: Number(v.value),
        startsAt: new Date(v.startsAt).toISOString(),
        endsAt: new Date(v.endsAt).toISOString(),
        status: v.status,
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.form.reset({
            code: '',
            label: '',
            type: 'PERCENT',
            value: 10,
            startsAt: this.toLocalInput(new Date()),
            endsAt: this.toLocalInput(new Date(Date.now() + 7 * 24 * 60 * 60_000)),
            status: 'SCHEDULED',
          });
          this.formOpen.set(false);
          this.refresh();
        },
        error: (err) => {
          this.submitting.set(false);
          const msg =
            (err as { error?: { message?: string }; message?: string })?.error?.message ?? 'Could not create promo';
          this.formError.set(msg);
        },
      });
  }

  cyclePromo(p: Promo): void {
    // Simple state machine: DRAFT → SCHEDULED → RUNNING → PAUSED → RUNNING.
    const next: PromoStatus =
      p.status === 'DRAFT'
        ? 'SCHEDULED'
        : p.status === 'SCHEDULED'
          ? 'RUNNING'
          : p.status === 'RUNNING'
            ? 'PAUSED'
            : p.status === 'PAUSED'
              ? 'RUNNING'
              : 'DRAFT';
    this.api.updateStatus(p.id, next).subscribe({
      next: (updated) => {
        this.promos.update((list) => list.map((x) => (x.id === updated.id ? updated : x)));
      },
    });
  }

  formatValue(p: Promo): string {
    switch (p.type) {
      case 'PERCENT':
        return `${p.value}%`;
      case 'FIXED':
        return `$${(p.value / 100).toFixed(2)} off`;
      case 'BOGO':
        return 'Buy 1 get 1';
      case 'POINTS_MULTIPLIER':
        return `${(p.value / 10).toFixed(1)}× pts`;
      default:
        return String(p.value);
    }
  }

  formatWindow(p: Promo): string {
    const fmt = (iso: string) =>
      new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
    return `${fmt(p.startsAt)} — ${fmt(p.endsAt)}`;
  }

  statusBg(status: PromoStatus): string {
    if (status === 'RUNNING') return '#7BC4A433';
    if (status === 'SCHEDULED') return 'var(--color-caramel-light)';
    if (status === 'PAUSED') return '#E9A84B33';
    if (status === 'EXPIRED') return '#D94B5E22';
    return 'var(--color-surface-variant)';
  }

  statusColor(status: PromoStatus): string {
    if (status === 'RUNNING') return '#3E8868';
    if (status === 'SCHEDULED') return 'var(--color-caramel)';
    if (status === 'PAUSED') return '#8A6720';
    if (status === 'EXPIRED') return '#8F2F3C';
    return 'var(--color-text-secondary)';
  }

  private toLocalInput(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}
