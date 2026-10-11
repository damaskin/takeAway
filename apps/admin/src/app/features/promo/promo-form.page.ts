import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { type Promo, type PromoStatus, type PromoType, isPromoEditable } from '@takeaway/shared-types';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import {
  DEFAULT_INACTIVE_DAYS,
  INACTIVE_DAYS,
  type InactiveDays,
  campaignLink,
  parseInactiveDays,
} from '../../core/customers/inactive-segment';
import { apiErrorMessage } from '../../core/http/api-error';
import { AdminPromoApi } from '../../core/promo/promo.service';
import { FormPageComponent } from '../../shared/form-page.component';
import { PROMO_ERROR_WORDING } from './promo-errors';

type Audience = 'ALL' | 'INACTIVE';

const LIST = '/promotions/promo';
const DAY_MS = 24 * 60 * 60_000;

/**
 * Create or edit a promo code, on its own route. A draft, and a scheduled
 * or paused promo nobody has used, can change in full; any other promo
 * opens read-only — its status moves from the list.
 *
 * `?for=inactive&inactiveDays=&storeId=` (from «Возврат») opens it as a
 * win-back code: only inactive customers can use it, 15 % off for two
 * weeks, once per customer. `&then=campaign` takes the saved code straight
 * to a campaign for those customers.
 */
@Component({
  selector: 'app-promo-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, FormPageComponent],
  template: `
    <app-form-page
      [backTo]="[list]"
      backLabel="admin.promo.title"
      [title]="editing() ? 'admin.promo.editTitle' : 'admin.promo.createTitle'"
      [titleParams]="{ code: loaded()?.code ?? '' }"
      [saveLabel]="editing() ? 'admin.promo.form.save' : 'admin.promo.form.create'"
      [saveDisabled]="form.invalid || readOnly()"
      [saving]="saving()"
      [loading]="loadingPromo()"
      [error]="error()"
      (save)="submit()"
    >
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col" style="gap: 14px">
        @if (readOnly()) {
          <p class="promo-note">{{ 'admin.promo.form.readOnly' | translate }}</p>
        } @else if (winback()) {
          <p class="promo-note">
            {{ 'admin.promo.form.winbackNote' | translate }}
            @if (thenCampaign()) {
              {{ 'admin.promo.form.thenBroadcast' | translate }}
            }
          </p>
        }

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.promo.form.code' | translate }}</span>
            <input
              formControlName="code"
              type="text"
              class="field-input field-input-mono"
              style="text-transform: uppercase"
            />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.promo.form.label' | translate }}</span>
            <input formControlName="label" type="text" class="field-input" />
          </label>
        </div>

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.promo.table.type' | translate }}</span>
            <select formControlName="type" class="field-input">
              <option value="PERCENT">{{ 'admin.promo.form.typePercent' | translate }}</option>
              <option value="FIXED">{{ 'admin.promo.form.typeFixed' | translate }}</option>
              <option value="BOGO">{{ 'admin.promo.form.typeBogo' | translate }}</option>
              <option value="POINTS_MULTIPLIER">{{ 'admin.promo.form.typePoints' | translate }}</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.promo.form.value' | translate }}</span>
            <input formControlName="value" type="number" min="0" class="field-input field-input-mono" />
          </label>
          @if (!editing()) {
            <label class="field">
              <span class="field-label">{{ 'admin.promo.table.status' | translate }}</span>
              <select formControlName="status" class="field-input">
                <option value="DRAFT">{{ 'admin.promo.form.statusDraft' | translate }}</option>
                <option value="RUNNING">{{ 'admin.promo.form.statusActive' | translate }}</option>
              </select>
            </label>
          }
        </div>

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.promo.form.perUserLimit' | translate }}</span>
            <input formControlName="perUserLimit" type="number" min="0" class="field-input field-input-mono" />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.promo.form.maxRedemptions' | translate }}</span>
            <input formControlName="maxRedemptions" type="number" min="0" class="field-input field-input-mono" />
          </label>
        </div>

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.promo.form.starts' | translate }}</span>
            <input formControlName="startsAt" type="datetime-local" class="field-input" />
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.promo.form.ends' | translate }}</span>
            <input formControlName="endsAt" type="datetime-local" class="field-input" />
          </label>
        </div>

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.promo.form.audience' | translate }}</span>
            <select formControlName="audience" class="field-input">
              <option value="ALL">{{ 'admin.promo.form.audienceAll' | translate }}</option>
              <option value="INACTIVE">{{ 'admin.promo.form.audienceInactive' | translate }}</option>
            </select>
          </label>
          @if (audience() === 'INACTIVE') {
            <label class="field">
              <span class="field-label">{{ 'admin.promo.form.inactiveDays' | translate }}</span>
              <select formControlName="inactiveDays" class="field-input">
                @for (d of inactiveDays; track d) {
                  <option [ngValue]="d">{{ 'admin.campaigns.inactive.daysOption' | translate: { days: d } }}</option>
                }
              </select>
            </label>
            @if (stores().length > 1) {
              <label class="field">
                <span class="field-label">{{ 'admin.promo.form.store' | translate }}</span>
                <select formControlName="storeId" class="field-input">
                  <option value="">{{ 'admin.promo.form.allStores' | translate }}</option>
                  @for (s of stores(); track s.id) {
                    <option [value]="s.id">{{ s.name }}</option>
                  }
                </select>
              </label>
            }
          }
        </div>
        @if (audience() === 'INACTIVE') {
          <p class="promo-hint">{{ 'admin.promo.form.audienceHint' | translate: { days: days() } }}</p>
        }
      </form>
    </app-form-page>
  `,
  styles: [
    `
      .promo-note {
        margin: 0;
        padding: 10px 12px;
        border-radius: 12px;
        background: var(--color-cream);
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .promo-hint {
        margin: -4px 0 0;
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
    `,
  ],
})
export class PromoFormPage {
  private readonly api = inject(AdminPromoApi);
  private readonly catalog = inject(AdminCatalogApi);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;

  /** The `:promoId` route param, bound by `withComponentInputBinding`; absent on «new». */
  readonly promoId = input<string>();

  readonly list = LIST;
  readonly inactiveDays = INACTIVE_DAYS;
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly loaded = signal<Promo | null>(null);
  readonly loadingPromo = signal(false);
  readonly stores = signal<StoreAdminDto[]>([]);

  readonly editing = computed(() => Boolean(this.promoId()));
  readonly readOnly = computed(() => {
    const promo = this.loaded();
    return this.editing() && promo !== null && !isPromoEditable(promo);
  });
  /** Opened from «Возврат»: a code for the inactive segment. */
  readonly winback = signal(this.query.get('for') === 'inactive');
  readonly thenCampaign = signal(this.query.get('then') === 'campaign');

  readonly form = new FormGroup({
    code: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2)] }),
    label: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    type: new FormControl<PromoType>('PERCENT', { nonNullable: true }),
    value: new FormControl(10, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    perUserLimit: new FormControl(0, { nonNullable: true, validators: [Validators.min(0)] }),
    maxRedemptions: new FormControl(0, { nonNullable: true, validators: [Validators.min(0)] }),
    startsAt: new FormControl(toLocalInput(new Date()), { nonNullable: true }),
    endsAt: new FormControl(toLocalInput(new Date(Date.now() + 7 * DAY_MS)), { nonNullable: true }),
    status: new FormControl<PromoStatus>('RUNNING', { nonNullable: true }),
    audience: new FormControl<Audience>('ALL', { nonNullable: true }),
    inactiveDays: new FormControl<InactiveDays>(DEFAULT_INACTIVE_DAYS, { nonNullable: true }),
    storeId: new FormControl('', { nonNullable: true }),
  });

  readonly audience = toSignal(this.form.controls.audience.valueChanges, {
    initialValue: this.form.controls.audience.value,
  });
  readonly days = toSignal(this.form.controls.inactiveDays.valueChanges, {
    initialValue: this.form.controls.inactiveDays.value,
  });

  constructor() {
    if (this.winback()) this.prefillWinback();

    // Stores for the "orders at" choice follow the brand in the header.
    effect(() => {
      const brandId = this.activeBrand.activeId();
      if (!brandId) return;
      untracked(() => this.catalog.listStores(brandId).subscribe({ next: (list) => this.stores.set(list) }));
    });

    effect(() => {
      const id = this.promoId();
      if (!id) return;
      untracked(() => this.load(id));
    });
  }

  submit(): void {
    if (this.form.invalid || this.readOnly()) return;
    const brandId = this.activeBrand.activeId();
    if (!brandId) {
      this.error.set(this.translate.instant('admin.brandContext.noBrandsHint'));
      return;
    }
    const v = this.form.getRawValue();
    const inactive = v.audience === 'INACTIVE';
    const fields = {
      code: v.code.toUpperCase(),
      label: v.label,
      type: v.type,
      value: Number(v.value),
      perUserLimit: Number(v.perUserLimit),
      maxRedemptions: Number(v.maxRedemptions),
      startsAt: new Date(v.startsAt).toISOString(),
      endsAt: new Date(v.endsAt).toISOString(),
      inactiveDays: inactive ? v.inactiveDays : null,
      segmentStoreId: inactive && v.storeId ? v.storeId : null,
    };
    this.saving.set(true);
    this.error.set(null);

    const id = this.promoId();
    const request = id ? this.api.update(id, fields) : this.api.create({ ...fields, brandId, status: v.status });
    request.subscribe({
      next: (promo) => this.afterSave(promo),
      error: (err) => {
        this.saving.set(false);
        this.error.set(
          apiErrorMessage(err, this.translate, {
            ...PROMO_ERROR_WORDING,
            statuses: { 500: id ? 'admin.promo.errors.saveFailed' : 'admin.promo.errors.createFailed' },
          }),
        );
      },
    });
  }

  /**
   * An «акция» goes on to the campaign with the code in it; any other new
   * code lands on the list, which offers that campaign for a win-back code.
   */
  private afterSave(promo: Promo): void {
    const segment = promo.inactiveDays
      ? { days: parseInactiveDays(String(promo.inactiveDays)) ?? DEFAULT_INACTIVE_DAYS, storeId: promo.segmentStoreId }
      : null;
    if (segment && this.thenCampaign() && !this.editing()) {
      const link = campaignLink(segment, promo.code);
      void this.router.navigate(link.commands, { queryParams: link.queryParams });
      return;
    }
    if (this.editing()) {
      void this.router.navigate([LIST]);
      return;
    }
    void this.router.navigate([LIST], {
      queryParams: {
        created: promo.code,
        inactiveDays: segment?.days ?? undefined,
        storeId: segment?.storeId ?? undefined,
      },
    });
  }

  private prefillWinback(): void {
    this.form.patchValue({
      code: `COMEBACK${Math.floor(100 + Math.random() * 900)}`,
      label: this.translate.instant('admin.promo.winback.label'),
      type: 'PERCENT',
      value: 15,
      perUserLimit: 1,
      endsAt: toLocalInput(new Date(Date.now() + 14 * DAY_MS)),
      status: 'RUNNING',
      audience: 'INACTIVE',
      inactiveDays: parseInactiveDays(this.query.get('inactiveDays')) ?? DEFAULT_INACTIVE_DAYS,
      storeId: this.query.get('storeId') ?? '',
    });
  }

  private load(id: string): void {
    this.loadingPromo.set(true);
    this.api.get(id).subscribe({
      next: (promo) => {
        this.loaded.set(promo);
        this.loadingPromo.set(false);
        this.form.patchValue({
          code: promo.code,
          label: promo.label,
          type: promo.type,
          value: promo.value,
          perUserLimit: promo.perUserLimit,
          maxRedemptions: promo.maxRedemptions,
          startsAt: toLocalInput(new Date(promo.startsAt)),
          endsAt: toLocalInput(new Date(promo.endsAt)),
          status: promo.status,
          audience: promo.inactiveDays ? 'INACTIVE' : 'ALL',
          inactiveDays: parseInactiveDays(String(promo.inactiveDays)) ?? DEFAULT_INACTIVE_DAYS,
          storeId: promo.segmentStoreId ?? '',
        });
        if (!isPromoEditable(promo)) this.form.disable();
      },
      error: (err) => {
        this.loadingPromo.set(false);
        this.error.set(
          apiErrorMessage(err, this.translate, {
            network: 'common.networkError',
            statuses: { 404: 'admin.promo.form.loadFailed' },
          }),
        );
      },
    });
  }
}

/** `datetime-local` wants local wall-clock time, not an ISO instant. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
