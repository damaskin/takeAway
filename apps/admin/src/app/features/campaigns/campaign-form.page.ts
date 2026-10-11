import { Location } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable, type Subscription, switchMap } from 'rxjs';

import { API_CONFIG } from '../../core/api/api.config';
import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
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
 * Compose a campaign — a new draft on `/campaigns/new`, or a draft or a
 * rejected campaign on `/campaigns/:id`. Retries stay on the list, where
 * the delivery counters are. Before saving, the form shows how many people
 * the audience reaches and through what, and lets the admin send the copy
 * to themselves to see it arrive.
 *
 * «Сохранить черновик» keeps it for later; «Отправить на модерацию» saves
 * and submits it in one go. Nothing is sent before the takeAway team
 * approves it — at once, or at the time picked here. A platform admin's
 * campaign needs no review, so their button reads «Отправить».
 */
@Component({
  selector: 'app-campaign-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, FormPageComponent],
  template: `
    <app-form-page
      [backTo]="['/campaigns']"
      backLabel="admin.campaigns.title"
      [title]="campaignId() ? 'admin.campaigns.editTitle' : 'admin.campaigns.createTitle'"
      saveLabel="admin.campaigns.saveDraft"
      [saveDisabled]="form.invalid || !brandId() || locked()"
      [saving]="creating()"
      [loading]="loading()"
      [error]="error()"
      (save)="create()"
    >
      <form [formGroup]="form" (ngSubmit)="create()" class="flex flex-col" style="gap: 14px">
        @if (!brandId()) {
          <p role="alert" style="margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">
            {{ 'admin.campaigns.noBrand' | translate }}
          </p>
        }

        @if (rejection(); as reason) {
          <div class="review-banner" role="note">
            <strong>{{ 'admin.campaigns.moderation.rejectedTitle' | translate }}</strong>
            <span>{{ reason }}</span>
            <span class="review-hint">{{ 'admin.campaigns.moderation.fixHint' | translate }}</span>
          </div>
        }
        @if (locked()) {
          <p role="alert" style="margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">
            {{ 'admin.campaigns.errors.notEditable' | translate }}
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

        <label class="field">
          <span class="field-label">{{ 'admin.campaigns.fields.scheduledAt' | translate }}</span>
          <input type="datetime-local" formControlName="scheduledAt" class="field-input" [min]="minSchedule" />
          <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
            (isPlatformAdmin()
              ? 'admin.campaigns.fields.scheduledAtHintAdmin'
              : 'admin.campaigns.fields.scheduledAtHint'
            ) | translate
          }}</span>
        </label>

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
          (click)="saveAndSubmit()"
          [disabled]="form.invalid || !brandId() || locked() || creating()"
          class="disabled:opacity-50"
          style="height: 40px; padding: 0 18px; background: var(--color-espresso); color: white; border: 0; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600; cursor: pointer"
        >
          {{ (isPlatformAdmin() ? 'admin.campaigns.send' : 'admin.campaigns.moderation.submit') | translate }}
        </button>
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
  styles: [
    `
      .review-banner {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 12px 14px;
        border-radius: 12px;
        background: rgba(244, 67, 54, 0.08);
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-berry);
        overflow-wrap: anywhere;
      }
      .review-hint {
        color: var(--color-text-secondary);
      }
    `,
  ],
})
export class CampaignFormPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly translate = inject(TranslateService);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly auth = inject(AuthStore);

  readonly channels = CAMPAIGN_CHANNELS;
  readonly audiences = CAMPAIGN_AUDIENCES;
  readonly creating = signal(false);
  readonly error = signal<string | null>(null);
  /** The campaign being edited; null on /campaigns/new. Set after the first save of a new one. */
  readonly campaignId = signal<string | null>(inject(ActivatedRoute).snapshot.paramMap.get('id'));
  readonly loading = signal(this.campaignId() !== null);
  /** The moderator's reason, while a rejected campaign is being fixed. */
  readonly rejection = signal<string | null>(null);
  /** The campaign went into review or out since the form opened: nothing here can change it. */
  readonly locked = signal(false);
  readonly isPlatformAdmin = computed(() => this.auth.user()?.role === 'SUPER_ADMIN');
  /** A send time cannot be in the past (local, minute precision, as the input wants it). */
  readonly minSchedule = toLocalInput(new Date());

  readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2)] }),
    body: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2)] }),
    channel: new FormControl<CampaignRow['channel']>('PUSH', { nonNullable: true }),
    audience: new FormControl<CampaignRow['audience']>('ALL', { nonNullable: true }),
    /** `datetime-local` value in the admin's time zone; empty — as soon as it is approved. */
    scheduledAt: new FormControl('', { nonNullable: true }),
  });

  readonly brandId = this.activeBrand.activeId;
  readonly channel = toSignal(this.form.controls.channel.valueChanges, {
    initialValue: this.form.controls.channel.value,
  });
  readonly audience = toSignal(this.form.controls.audience.valueChanges, {
    initialValue: this.form.controls.audience.value,
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
    effect(() => {
      const brandId = this.brandId();
      const audience = this.audience();
      const channel = this.channel();
      this.loadPreview(brandId, audience, channel);
    });
    inject(DestroyRef).onDestroy(() => this.previewSub?.unsubscribe());
  }

  ngOnInit(): void {
    if (!this.activeBrand.loaded()) this.activeBrand.refresh();
    const id = this.campaignId();
    if (id) this.loadCampaign(id);
  }

  /** «Сохранить черновик»: back to the list. */
  create(): void {
    this.persist().subscribe({
      next: () => void this.router.navigate(['/campaigns']),
      error: (err) => this.fail(err),
    });
  }

  /** Saves, then submits for review (approves, for a platform admin) and goes back to the list. */
  saveAndSubmit(): void {
    this.persist()
      .pipe(switchMap((row) => this.http.post<CampaignRow>(`${this.api.baseUrl}/admin/campaigns/${row.id}/submit`, {})))
      .subscribe({
        next: () => void this.router.navigate(['/campaigns']),
        error: (err) => this.fail(err),
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

  /**
   * Creates the draft or saves the changes. A new draft turns the form into
   * its edit form, so a submit that fails afterwards (the time has passed,
   * say) never creates it twice.
   */
  private persist(): Observable<CampaignRow> {
    return new Observable<CampaignRow>((subscriber) => {
      const brandId = this.brandId();
      if (this.form.invalid || !brandId || this.locked()) {
        subscriber.complete();
        return;
      }
      this.creating.set(true);
      this.error.set(null);
      const raw = this.form.getRawValue();
      const body = {
        title: raw.title,
        body: raw.body,
        channel: raw.channel,
        audience: raw.audience,
        scheduledAt: raw.scheduledAt ? new Date(raw.scheduledAt).toISOString() : null,
      };
      const id = this.campaignId();
      const request = id
        ? this.http.patch<CampaignRow>(`${this.api.baseUrl}/admin/campaigns/${id}`, body)
        : this.http.post<CampaignRow>(`${this.api.baseUrl}/admin/campaigns`, body, { params: { brandId } });
      const sub = request.subscribe({
        next: (row) => {
          if (!id) {
            // The address follows without reloading the page, so an error
            // from the submit that comes next stays on screen.
            this.campaignId.set(row.id);
            this.location.replaceState(`/campaigns/${row.id}`);
          }
          subscriber.next(row);
          subscriber.complete();
        },
        error: (err) => subscriber.error(err),
      });
      return () => sub.unsubscribe();
    });
  }

  private fail(err: unknown): void {
    this.creating.set(false);
    this.error.set(apiErrorMessage(err, this.translate, CAMPAIGN_ERROR_WORDING));
  }

  private loadCampaign(id: string): void {
    this.http.get<CampaignRow>(`${this.api.baseUrl}/admin/campaigns/${id}`).subscribe({
      next: (row) => {
        this.form.patchValue({
          title: row.title,
          body: row.body,
          channel: row.channel,
          audience: row.audience,
          scheduledAt: row.scheduledAt ? toLocalInput(new Date(row.scheduledAt)) : '',
        });
        this.rejection.set(row.status === 'REJECTED' ? (row.reviewNote ?? '') || null : null);
        this.locked.set(!row.editable);
        if (!row.editable) this.form.disable();
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(apiErrorMessage(err, this.translate, CAMPAIGN_ERROR_WORDING));
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

  private loadPreview(
    brandId: string | null,
    audience: CampaignRow['audience'],
    channel: CampaignRow['channel'],
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
        params: { brandId, audience, channel },
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

/** A date as a `datetime-local` value, in the browser's time zone: 2026-10-12T09:00. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
