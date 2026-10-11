import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleFormatService } from '@takeaway/i18n';
import type { KitchenDeviceSummary } from '@takeaway/shared-types';

import { StaffService } from '../../core/staff/staff.service';
import { staffErrorMessage } from './staff-errors';

/**
 * The brand's kitchen tablets, on the Staff page. A tablet's PIN screen
 * shows only the stores of the brand it is bound to; it is bound once —
 * by someone of the team opening «Кухня» on it, or with the one-time link
 * made here (no password typed on a shared device). A tablet that is lost,
 * or went to another business, is unbound here.
 */
@Component({
  selector: 'app-kitchen-tablets',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <section class="tablets" aria-labelledby="kitchen-tablets-title">
      <h2 id="kitchen-tablets-title" class="tablets-title">{{ 'admin.staff.tablets.title' | translate }}</h2>
      <p class="tablets-note">{{ 'admin.staff.tablets.hint' | translate }}</p>

      <div class="flex items-center flex-wrap" style="gap: 10px">
        <button
          type="button"
          class="tablets-primary"
          [disabled]="linking()"
          (click)="makeLink()"
          data-testid="tablet-link"
        >
          {{ (linking() ? 'common.loading' : 'admin.staff.tablets.makeLink') | translate }}
        </button>
      </div>

      @if (link(); as l) {
        <div class="tablets-link" data-testid="tablet-link-box">
          <code>{{ l.url }}</code>
          <button type="button" class="tablets-secondary" (click)="copy(l.url)">
            {{ (copied() ? 'admin.staff.tablets.copied' : 'admin.staff.tablets.copy') | translate }}
          </button>
          <p class="tablets-note">{{ 'admin.staff.tablets.linkNote' | translate: { until: l.until } }}</p>
        </div>
      }

      @if (devices().length === 0) {
        <p class="tablets-note">{{ 'admin.staff.tablets.none' | translate }}</p>
      } @else {
        <ul class="tablets-list">
          @for (d of devices(); track d.id) {
            <li>
              <span>
                {{
                  'admin.staff.tablets.bound'
                    | translate: { date: fmt.dateTime(d.createdAt), name: d.createdByName ?? '—' }
                }}
                ·
                {{
                  d.lastUsedAt
                    ? ('admin.staff.tablets.lastUsed' | translate: { date: fmt.dateTime(d.lastUsedAt) })
                    : ('admin.staff.tablets.neverUsed' | translate)
                }}
              </span>
              <button type="button" class="tablets-danger" [disabled]="busyId() === d.id" (click)="unbind(d)">
                {{ 'admin.staff.tablets.unbind' | translate }}
              </button>
            </li>
          }
        </ul>
      }

      @if (error(); as message) {
        <p class="tablets-error" role="alert">{{ message }}</p>
      }
    </section>
  `,
  styles: [
    `
      .tablets {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 24px;
        padding: 20px;
        background: var(--color-foam);
        border-radius: var(--radius-card);
        box-shadow: var(--shadow-soft);
        font-family: var(--font-sans);
      }
      .tablets-title {
        margin: 0;
        font-family: var(--font-display);
        font-size: 18px;
        color: var(--color-espresso);
      }
      .tablets-note,
      .tablets-error {
        margin: 0;
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .tablets-error {
        color: var(--color-berry);
      }
      .tablets-link {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        background: var(--color-cream);
        border-radius: 10px;
      }
      .tablets-link code {
        flex: 1 1 260px;
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      .tablets-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
      }
      .tablets-list li {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .tablets-primary,
      .tablets-secondary,
      .tablets-danger {
        height: 34px;
        padding: 0 14px;
        border: 0;
        border-radius: var(--radius-button);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .tablets-primary {
        background: var(--color-caramel);
        color: white;
      }
      .tablets-secondary {
        background: var(--color-latte);
        color: var(--color-espresso);
      }
      .tablets-danger {
        background: transparent;
        color: var(--color-berry);
      }
      button:disabled {
        opacity: 0.5;
      }
    `,
  ],
})
export class KitchenTabletsComponent {
  readonly brandId = input.required<string>();

  private readonly staffApi = inject(StaffService);
  private readonly translate = inject(TranslateService);
  readonly fmt = inject(LocaleFormatService);

  readonly devices = signal<KitchenDeviceSummary[]>([]);
  readonly link = signal<{ url: string; until: string } | null>(null);
  readonly linking = signal(false);
  readonly copied = signal(false);
  readonly busyId = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const brandId = this.brandId();
      untracked(() => {
        this.link.set(null);
        this.load(brandId);
      });
    });
  }

  makeLink(): void {
    this.linking.set(true);
    this.error.set(null);
    this.copied.set(false);
    this.staffApi.kitchenPairingCode(this.brandId()).subscribe({
      next: ({ code, expiresAt }) => {
        this.linking.set(false);
        this.link.set({
          url: `${location.origin}/login/pin?pair=${encodeURIComponent(code)}`,
          until: this.fmt.dateTime(expiresAt),
        });
      },
      error: (err) => {
        this.linking.set(false);
        this.error.set(staffErrorMessage(err, this.translate));
      },
    });
  }

  copy(url: string): void {
    void navigator.clipboard?.writeText(url).then(
      () => this.copied.set(true),
      () => undefined,
    );
  }

  unbind(device: KitchenDeviceSummary): void {
    if (!window.confirm(this.translate.instant('admin.staff.tablets.unbindConfirm'))) return;
    this.busyId.set(device.id);
    this.error.set(null);
    this.staffApi.unbindKitchenDevice(this.brandId(), device.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.devices.update((list) => list.filter((d) => d.id !== device.id));
      },
      error: (err) => {
        this.busyId.set(null);
        this.error.set(staffErrorMessage(err, this.translate));
      },
    });
  }

  private load(brandId: string): void {
    this.staffApi.kitchenDevices(brandId).subscribe({
      next: (list) => this.devices.set(list),
      error: (err) => this.error.set(staffErrorMessage(err, this.translate)),
    });
  }
}
