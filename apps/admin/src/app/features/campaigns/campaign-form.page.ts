import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { Subscription } from 'rxjs';

import { API_CONFIG } from '../../core/api/api.config';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import {
  DEFAULT_INACTIVE_DAYS,
  INACTIVE_DAYS,
  type InactiveDays,
  parseInactiveDays,
} from '../../core/customers/inactive-segment';
import { apiErrorMessage } from '../../core/http/api-error';
import { FormPageComponent } from '../../shared/form-page.component';
import {
  CAMPAIGN_AUDIENCES,
  CAMPAIGN_CHANNELS,
  type CampaignPreview,
  type CampaignRow,
  type CampaignTestResult,
} from './campaign.types';
import { CAMPAIGN_ERROR_WORDING } from './campaign-errors';

/**
 * Compose a campaign draft, on its own route. Sending stays on the list,
 * where the delivery counters are. Before saving, the form shows how many
 * people the audience reaches and through what, and lets the admin send
 * the copy to themselves to see it arrive.
 *
 * `?audience=INACTIVE&inactiveDays=&storeId=` (from «Возврат», «Клиенты →
 * Неактивные» or a saved win-back code) opens it on the inactive segment
 * with a ready "we miss you" copy; `&code=` puts that promo code in it.
 */
@Component({
  selector: 'app-campaign-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, FormPageComponent],
  template: `
    <app-form-page
      [backTo]="['/campaigns']"
      backLabel="admin.campaigns.title"
      title="admin.campaigns.createTitle"
      saveLabel="admin.campaigns.saveDraft"
      [saveDisabled]="form.invalid || !brandId()"
      [saving]="creating()"
      [error]="error()"
      (save)="create()"
    >
      <form [formGroup]="form" (ngSubmit)="create()" class="flex flex-col" style="gap: 14px">
        @if (!brandId()) {
          <p role="alert" style="margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">
            {{ 'admin.campaigns.noBrand' | translate }}
          </p>
        }

        <label class="field">
          <span class="field-label">{{ 'admin.campaigns.fields.title' | translate }}</span>
          <input type="text" formControlName="title" maxlength="120" class="field-input" />
        </label>

        <label class="field">
          <span class="field-label">{{ 'admin.campaigns.fields.body' | translate }}</span>
          <textarea formControlName="body" rows="5" maxlength="2000" class="field-input"></textarea>
        </label>

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.campaigns.fields.channel' | translate }}</span>
            <select formControlName="channel" class="field-input">
              @for (c of channels; track c) {
                <option [value]="c">{{ 'admin.campaigns.channels.' + c | translate }}</option>
              }
            </select>
          </label>
          <label class="field">
            <span class="field-label">{{ 'admin.campaigns.fields.audience' | translate }}</span>
            <select formControlName="audience" class="field-input">
              @for (a of audiences; track a) {
                <option [value]="a">{{ 'admin.campaigns.audiences.' + a | translate }}</option>
              }
            </select>
          </label>
        </div>

        @if (audience() === 'INACTIVE') {
          <div class="form-row">
            <label class="field">
              <span class="field-label">{{ 'admin.campaigns.inactive.days' | translate }}</span>
              <select formControlName="inactiveDays" class="field-input">
                @for (d of inactiveDays; track d) {
                  <option [ngValue]="d">{{ 'admin.campaigns.inactive.daysOption' | translate: { days: d } }}</option>
                }
              </select>
            </label>
            @if (stores().length > 1) {
              <label class="field">
                <span class="field-label">{{ 'admin.campaigns.inactive.store' | translate }}</span>
                <select formControlName="storeId" class="field-input">
                  <option value="">{{ 'admin.campaigns.inactive.allStores' | translate }}</option>
                  @for (s of stores(); track s.id) {
                    <option [value]="s.id">{{ s.name }}</option>
                  }
                </select>
              </label>
            }
          </div>
          <p
            style="margin: -4px 0 0; font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)"
          >
            {{ 'admin.campaigns.inactive.hint' | translate }}
          </p>
        }

        <!-- Reach: who would get it, before anything is sent -->
        <div
          aria-live="polite"
          style="background: var(--color-cream); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; font-family: var(--font-sans); font-size: 13px; color: var(--color-espresso)"
        >
          <span style="font-weight: 600">{{ 'admin.campaigns.reach.title' | translate }}</span>
          @if (previewLoading()) {
            <span style="color: var(--color-text-secondary)">{{ 'admin.campaigns.reach.loading' | translate }}</span>
          } @else if (previewError()) {
            <span style="color: var(--color-berry)">{{ previewError() }}</span>
          } @else if (preview(); as p) {
            @if (p.total === 0) {
              <span>{{ 'admin.campaigns.reach.empty' | translate }}</span>
            } @else {
              <span style="font-size: 15px; font-weight: 700">
                {{ 'admin.campaigns.reach.summary' | translate: { reachable: p.reachable, total: p.total } }}
              </span>
              <span class="flex flex-wrap" style="gap: 4px 14px">
                @if (channel() === 'EMAIL') {
                  <span>{{ 'admin.campaigns.reach.email' | translate: { count: p.byChannel.email } }}</span>
                } @else {
                  @if (channel() === 'PUSH') {
                    <span>{{ 'admin.campaigns.reach.appPush' | translate: { count: p.byChannel.appPush } }}</span>
                    <span>{{ 'admin.campaigns.reach.webPush' | translate: { count: p.byChannel.webPush } }}</span>
                  }
                  <span>{{ 'admin.campaigns.reach.telegram' | translate: { count: p.byChannel.telegram } }}</span>
                }
              </span>
              @if (p.noChannel > 0 || p.optedOut > 0) {
                <span class="flex flex-wrap" style="gap: 4px 14px; color: var(--color-text-secondary)">
                  @if (p.noChannel > 0) {
                    <span>{{ 'admin.campaigns.reach.noChannel' | translate: { count: p.noChannel } }}</span>
                  }
                  @if (p.optedOut > 0) {
                    <span>{{ 'admin.campaigns.reach.optedOut' | translate: { count: p.optedOut } }}</span>
                  }
                </span>
              }
              @if (p.reachable === 0) {
                <span style="color: var(--color-berry)">{{ 'admin.campaigns.reach.none' | translate }}</span>
              }
            }
            @if (channel() === 'PUSH') {
              <span style="color: var(--color-text-secondary)">{{ 'admin.campaigns.reach.pushHint' | translate }}</span>
            }
            @for (warning of transportWarnings(); track warning) {
              <span style="color: var(--color-amber)">{{ warning | translate }}</span>
            }
          }
        </div>
      </form>

      <div formPageExtraActions class="flex items-center flex-wrap" style="gap: 12px">
        <button
          type="button"
          (click)="sendTest()"
          [disabled]="form.invalid || testing()"
          class="disabled:opacity-50"
          style="height: 40px; padding: 0 18px; background: transparent; color: var(--color-espresso); border: 1px solid var(--color-border-light); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600; cursor: pointer"
        >
          {{ (testing() ? 'admin.campaigns.test.sending' : 'admin.campaigns.test.button') | translate }}
        </button>
        @if (testMessage(); as m) {
          <span
            role="status"
            style="font-family: var(--font-sans); font-size: 13px"
            [style.color]="m.ok ? 'var(--color-mint)' : 'var(--color-berry)'"
            >{{ m.text }}</span
          >
        }
      </div>
    </app-form-page>
  `,
})
export class CampaignFormPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly catalog = inject(AdminCatalogApi);
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;

  readonly channels = CAMPAIGN_CHANNELS;
  readonly audiences = CAMPAIGN_AUDIENCES;
  readonly inactiveDays = INACTIVE_DAYS;
  readonly stores = signal<StoreAdminDto[]>([]);
  readonly creating = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2)] }),
    body: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2)] }),
    channel: new FormControl<CampaignRow['channel']>('PUSH', { nonNullable: true }),
    audience: new FormControl<CampaignRow['audience']>('ALL', { nonNullable: true }),
    inactiveDays: new FormControl<InactiveDays>(DEFAULT_INACTIVE_DAYS, { nonNullable: true }),
    storeId: new FormControl('', { nonNullable: true }),
  });

  readonly brandId = this.activeBrand.activeId;
  readonly channel = toSignal(this.form.controls.channel.valueChanges, {
    initialValue: this.form.controls.channel.value,
  });
  readonly audience = toSignal(this.form.controls.audience.valueChanges, {
    initialValue: this.form.controls.audience.value,
  });
  readonly days = toSignal(this.form.controls.inactiveDays.valueChanges, {
    initialValue: this.form.controls.inactiveDays.value,
  });
  readonly storeId = toSignal(this.form.controls.storeId.valueChanges, {
    initialValue: this.form.controls.storeId.value,
  });

  readonly preview = signal<CampaignPreview | null>(null);
  readonly previewLoading = signal(false);
  readonly previewError = signal<string | null>(null);

  readonly testing = signal(false);
  readonly testMessage = signal<{ ok: boolean; text: string } | null>(null);

  /** Transports the chosen channel leans on that the server has no credentials for. */
  readonly transportWarnings = computed<string[]>(() => {
    const p = this.preview();
    if (!p) return [];
    const t = p.transports;
    const channel = this.channel();
    if (channel === 'EMAIL') return t.email ? [] : ['admin.campaigns.reach.emailOff'];
    const warnings: string[] = [];
    if (channel === 'PUSH' && !t.fcm && !t.apns) warnings.push('admin.campaigns.reach.fcmOff');
    if (!t.telegram) warnings.push('admin.campaigns.reach.telegramOff');
    return warnings;
  });

  private previewSub: Subscription | null = null;

  constructor() {
    this.prefill();
    effect(() => {
      const brandId = this.brandId();
      const audience = this.audience();
      const channel = this.channel();
      const days = this.days();
      const storeId = this.storeId();
      this.loadPreview(brandId, audience, channel, { days, storeId });
    });
    // Stores for the inactive segment's "orders at" follow the brand in the header.
    effect(() => {
      const brandId = this.brandId();
      if (!brandId) return;
      untracked(() => this.catalog.listStores(brandId).subscribe({ next: (list) => this.stores.set(list) }));
    });
    inject(DestroyRef).onDestroy(() => this.previewSub?.unsubscribe());
  }

  ngOnInit(): void {
    if (!this.activeBrand.loaded()) this.activeBrand.refresh();
  }

  create(): void {
    const brandId = this.brandId();
    if (this.form.invalid || !brandId) return;
    this.creating.set(true);
    this.error.set(null);
    const { inactiveDays, storeId, ...copy } = this.form.getRawValue();
    const body = copy.audience === 'INACTIVE' ? { ...copy, inactiveDays, ...(storeId ? { storeId } : {}) } : copy;
    this.http.post<CampaignRow>(`${this.api.baseUrl}/admin/campaigns`, body, { params: { brandId } }).subscribe({
      next: () => this.router.navigate(['/campaigns']),
      error: (err) => {
        this.creating.set(false);
        this.error.set(apiErrorMessage(err, this.translate, CAMPAIGN_ERROR_WORDING));
      },
    });
  }

  /** Sends the current copy to the signed-in admin only. */
  sendTest(): void {
    if (this.form.invalid) return;
    const { title, body, channel } = this.form.getRawValue();
    this.testing.set(true);
    this.testMessage.set(null);
    this.http.post<CampaignTestResult>(`${this.api.baseUrl}/admin/campaigns/test`, { title, body, channel }).subscribe({
      next: (r) => {
        this.testing.set(false);
        this.testMessage.set(this.describeTest(r));
      },
      error: (err) => {
        this.testing.set(false);
        this.testMessage.set({ ok: false, text: apiErrorMessage(err, this.translate, CAMPAIGN_ERROR_WORDING) });
      },
    });
  }

  private describeTest(r: CampaignTestResult): { ok: boolean; text: string } {
    if (r.outcome === 'sent') {
      const via = r.via.map((v) => this.translate.instant(`admin.campaigns.test.via.${v}`)).join(', ');
      // It arrived, but not everywhere it should have (e.g. the app push
      // failed and the Telegram bot stepped in) — say what broke.
      if (r.error) {
        return {
          ok: false,
          text: this.translate.instant('admin.campaigns.test.sentWithError', { via, error: r.error }),
        };
      }
      return { ok: true, text: this.translate.instant('admin.campaigns.test.sent', { via }) };
    }
    if (r.outcome === 'failed') {
      return { ok: false, text: this.translate.instant('admin.campaigns.test.failed', { error: r.error ?? '' }) };
    }
    return { ok: false, text: this.translate.instant('admin.campaigns.test.noChannel') };
  }

  /**
   * The inactive segment and a ready copy when the composer was opened for
   * it; the admin edits the words before saving.
   */
  private prefill(): void {
    if (this.query.get('audience') !== 'INACTIVE') return;
    const code = this.query.get('code');
    this.form.patchValue({
      audience: 'INACTIVE',
      inactiveDays: parseInactiveDays(this.query.get('inactiveDays')) ?? DEFAULT_INACTIVE_DAYS,
      storeId: this.query.get('storeId') ?? '',
      title: this.translate.instant('admin.campaigns.template.title'),
      body: code
        ? this.translate.instant('admin.campaigns.template.bodyWithCode', { code })
        : this.translate.instant('admin.campaigns.template.body'),
    });
  }

  private loadPreview(
    brandId: string | null,
    audience: CampaignRow['audience'],
    channel: CampaignRow['channel'],
    segment: { days: InactiveDays; storeId: string },
  ): void {
    this.previewSub?.unsubscribe();
    this.preview.set(null);
    this.previewError.set(null);
    if (!brandId) {
      this.previewLoading.set(false);
      return;
    }
    this.previewLoading.set(true);
    this.previewSub = this.http
      .get<CampaignPreview>(`${this.api.baseUrl}/admin/campaigns/preview`, {
        params:
          audience === 'INACTIVE'
            ? {
                brandId,
                audience,
                channel,
                inactiveDays: segment.days,
                ...(segment.storeId ? { storeId: segment.storeId } : {}),
              }
            : { brandId, audience, channel },
      })
      .subscribe({
        next: (p) => {
          this.preview.set(p);
          this.previewLoading.set(false);
        },
        error: () => {
          this.previewError.set(this.translate.instant('admin.campaigns.reach.error'));
          this.previewLoading.set(false);
        },
      });
  }
}
