import { Location } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocalDatePipe } from '@takeaway/i18n';
import { Observable, switchMap } from 'rxjs';

import { API_CONFIG } from '../../core/api/api.config';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { apiErrorMessage } from '../../core/http/api-error';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import { FormPageComponent } from '../../shared/form-page.component';
import { ANNOUNCEMENT_ERROR_WORDING } from './announcement-errors';
import type {
  AnnouncementLinkKind,
  AnnouncementPreview,
  AnnouncementRow,
  AnnouncementTestResult,
} from './announcement.types';

/** The sender every announcement push starts with — the API's PLATFORM_SENDER_NAME. */
const PLATFORM_SENDER = 'takeAway';

/**
 * Compose a platform announcement — a new one on `/announcements/new`, a
 * draft on `/announcements/:id`. Optional link: a tap opens a store's menu
 * or a brand's (to announce a new partner). Before sending the form shows
 * who gets it — every customer who allows promotions, in «Уведомления»; of
 * them, who a push reaches — and lets the admin send it to themselves.
 * «Отправить» saves and sends, at once or at the time picked, after a
 * confirmation: it goes to every customer.
 */
@Component({
  selector: 'app-announcement-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, LocalDatePipe, FormPageComponent, ConfirmDialogComponent],
  template: `
    <app-form-page
      [backTo]="['/announcements']"
      backLabel="admin.announcements.title"
      [title]="announcementId() ? 'admin.announcements.editTitle' : 'admin.announcements.createTitle'"
      saveLabel="admin.announcements.saveDraft"
      [saveDisabled]="form.invalid || locked() || !linkComplete()"
      [saving]="saving()"
      [loading]="loading()"
      [error]="error()"
      (save)="saveDraft()"
    >
      <form [formGroup]="form" (ngSubmit)="saveDraft()" class="flex flex-col" style="gap: 14px">
        @if (locked()) {
          <p role="alert" class="hint" style="color: var(--color-berry)">
            {{ 'admin.announcements.errors.notEditable' | translate }}
          </p>
        }

        <label class="field">
          <span class="field-label">{{ 'admin.announcements.fields.title' | translate }}</span>
          <input type="text" formControlName="title" maxlength="120" class="field-input" />
        </label>

        <label class="field">
          <span class="field-label">{{ 'admin.announcements.fields.body' | translate }}</span>
          <textarea formControlName="body" rows="5" maxlength="2000" class="field-input"></textarea>
        </label>

        <div class="form-row">
          <label class="field">
            <span class="field-label">{{ 'admin.announcements.fields.link' | translate }}</span>
            <select formControlName="linkKind" class="field-input">
              <option value="NONE">{{ 'admin.announcements.link.NONE' | translate }}</option>
              <option value="STORE">{{ 'admin.announcements.link.STORE' | translate }}</option>
              <option value="BRAND">{{ 'admin.announcements.link.BRAND' | translate }}</option>
            </select>
          </label>
          @if (linkKind() !== 'NONE') {
            <label class="field">
              <span class="field-label">{{ 'admin.announcements.fields.brand' | translate }}</span>
              <select formControlName="brandId" class="field-input">
                <option value="">{{ 'admin.announcements.pickBrand' | translate }}</option>
                @for (b of brands(); track b.id) {
                  <option [value]="b.id">{{ b.name }}</option>
                }
              </select>
            </label>
          }
          @if (linkKind() === 'STORE' && brandId()) {
            <label class="field">
              <span class="field-label">{{ 'admin.announcements.fields.store' | translate }}</span>
              <select formControlName="storeId" class="field-input">
                <option value="">{{ 'admin.announcements.pickStore' | translate }}</option>
                @for (s of stores(); track s.id) {
                  <option [value]="s.id">{{ s.name }}</option>
                }
              </select>
            </label>
          }
        </div>
        <p class="hint">{{ 'admin.announcements.link.hint' | translate }}</p>

        <label class="field">
          <span class="field-label">{{ 'admin.announcements.fields.scheduledAt' | translate }}</span>
          <input type="datetime-local" formControlName="scheduledAt" class="field-input" [min]="minSchedule" />
          <span class="hint">{{ 'admin.announcements.fields.scheduledAtHint' | translate }}</span>
        </label>

        <!-- How it looks on the phone -->
        <div class="push-preview" aria-hidden="true">
          <span class="push-preview-label">{{ 'admin.announcements.pushPreview' | translate }}</span>
          <strong>{{ pushTitle() }}</strong>
          <span>{{ form.controls.body.value || '…' }}</span>
        </div>

        <!-- Reach -->
        <div class="reach" aria-live="polite">
          <span style="font-weight: 600">{{ 'admin.announcements.reach.title' | translate }}</span>
          @if (preview(); as p) {
            <span style="font-size: 15px; font-weight: 700">
              {{
                'admin.announcements.reach.summary' | translate: { recipients: p.recipients, customers: p.customers }
              }}
            </span>
            <span class="flex flex-wrap" style="gap: 4px 14px">
              <span>{{ 'admin.campaigns.reach.appPush' | translate: { count: p.byChannel.appPush } }}</span>
              <span>{{ 'admin.campaigns.reach.webPush' | translate: { count: p.byChannel.webPush } }}</span>
              <span>{{ 'admin.campaigns.reach.telegram' | translate: { count: p.byChannel.telegram } }}</span>
            </span>
            <span class="flex flex-wrap" style="gap: 4px 14px; color: var(--color-text-secondary)">
              @if (p.noChannel > 0) {
                <span>{{ 'admin.announcements.reach.inboxOnly' | translate: { count: p.noChannel } }}</span>
              }
              @if (p.optedOut > 0) {
                <span>{{ 'admin.campaigns.reach.optedOut' | translate: { count: p.optedOut } }}</span>
              }
            </span>
            <span style="color: var(--color-text-secondary)">{{ 'admin.announcements.reach.hint' | translate }}</span>
            @if (!p.transports.fcm && !p.transports.apns) {
              <span style="color: var(--color-amber)">{{ 'admin.campaigns.reach.fcmOff' | translate }}</span>
            }
            @if (!p.transports.telegram) {
              <span style="color: var(--color-amber)">{{ 'admin.campaigns.reach.telegramOff' | translate }}</span>
            }
          } @else if (previewError()) {
            <span style="color: var(--color-berry)">{{ previewError() }}</span>
          } @else {
            <span style="color: var(--color-text-secondary)">{{ 'admin.campaigns.reach.loading' | translate }}</span>
          }
        </div>
      </form>

      <div formPageExtraActions class="flex items-center flex-wrap" style="gap: 12px">
        <button
          type="button"
          (click)="confirmingSend.set(true)"
          [disabled]="form.invalid || locked() || saving() || !linkComplete()"
          class="disabled:opacity-50 btn-dark"
        >
          {{ (scheduled() ? 'admin.announcements.schedule' : 'admin.announcements.send') | translate }}
        </button>
        <button
          type="button"
          (click)="sendTest()"
          [disabled]="form.invalid || testing() || !linkComplete()"
          class="disabled:opacity-50 btn-outline"
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

    @if (confirmingSend()) {
      <app-confirm-dialog
        [title]="'admin.announcements.sendDialog.title' | translate: { title: form.controls.title.value }"
        [body]="
          (scheduled() ? 'admin.announcements.sendDialog.scheduled' : 'admin.announcements.sendDialog.now')
            | translate: { time: scheduledIso() ? (scheduledIso() | localDate: 'dateTime') : '' }
        "
        [confirmLabel]="(scheduled() ? 'admin.announcements.schedule' : 'admin.announcements.send') | translate"
        [cancelLabel]="'common.cancel' | translate"
        [busy]="saving()"
        (confirmed)="saveAndSend()"
        (cancelled)="confirmingSend.set(false)"
      />
    }
  `,
  styles: [
    `
      .hint {
        margin: -4px 0 0;
        font-family: var(--font-sans);
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .push-preview {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-width: 420px;
        padding: 10px 14px;
        border-radius: 14px;
        background: var(--color-cream);
        border: 1px solid var(--color-border-light);
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-espresso);
        white-space: pre-line;
        overflow-wrap: anywhere;
      }
      .push-preview-label {
        font-size: 11px;
        color: var(--color-text-secondary);
      }
      .reach {
        background: var(--color-cream);
        border-radius: 12px;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-espresso);
      }
      .btn-dark {
        height: 40px;
        padding: 0 18px;
        background: var(--color-espresso);
        color: white;
        border: 0;
        border-radius: var(--radius-button);
        font-family: var(--font-sans);
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }
      .btn-outline {
        height: 40px;
        padding: 0 18px;
        background: transparent;
        color: var(--color-espresso);
        border: 1px solid var(--color-border-light);
        border-radius: var(--radius-button);
        font-family: var(--font-sans);
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }
    `,
  ],
})
export class AnnouncementFormPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly translate = inject(TranslateService);
  private readonly activeBrand = inject(ActiveBrandService);
  private readonly catalog = inject(AdminCatalogApi);

  /** Every brand — the platform admin's brand list. */
  readonly brands = this.activeBrand.brands;
  readonly stores = signal<StoreAdminDto[]>([]);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly announcementId = signal<string | null>(inject(ActivatedRoute).snapshot.paramMap.get('id'));
  readonly loading = signal(this.announcementId() !== null);
  /** Sent or scheduled since the form opened: nothing here can change it. */
  readonly locked = signal(false);
  readonly confirmingSend = signal(false);
  readonly minSchedule = toLocalInput(new Date());

  readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2)] }),
    body: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2)] }),
    linkKind: new FormControl<AnnouncementLinkKind>('NONE', { nonNullable: true }),
    brandId: new FormControl('', { nonNullable: true }),
    storeId: new FormControl('', { nonNullable: true }),
    /** `datetime-local` in the admin's time zone; empty — «Отправить» sends at once. */
    scheduledAt: new FormControl('', { nonNullable: true }),
  });

  readonly linkKind = toSignal(this.form.controls.linkKind.valueChanges, {
    initialValue: this.form.controls.linkKind.value,
  });
  readonly brandId = toSignal(this.form.controls.brandId.valueChanges, {
    initialValue: this.form.controls.brandId.value,
  });
  private readonly storeId = toSignal(this.form.controls.storeId.valueChanges, {
    initialValue: this.form.controls.storeId.value,
  });
  private readonly title = toSignal(this.form.controls.title.valueChanges, {
    initialValue: this.form.controls.title.value,
  });
  private readonly scheduledAtValue = toSignal(this.form.controls.scheduledAt.valueChanges, {
    initialValue: this.form.controls.scheduledAt.value,
  });

  readonly scheduled = computed(() => Boolean(this.scheduledAtValue()));
  readonly scheduledIso = computed(() => {
    const value = this.scheduledAtValue();
    return value ? new Date(value).toISOString() : null;
  });
  readonly pushTitle = computed(() => `${PLATFORM_SENDER}: ${this.title() || '…'}`);
  /** A link kind that is picked is also filled in. */
  readonly linkComplete = computed(() => {
    const kind = this.linkKind();
    if (kind === 'BRAND') return Boolean(this.brandId());
    if (kind === 'STORE') return Boolean(this.storeId());
    return true;
  });

  readonly preview = signal<AnnouncementPreview | null>(null);
  readonly previewError = signal<string | null>(null);
  readonly testing = signal(false);
  readonly testMessage = signal<{ ok: boolean; text: string } | null>(null);

  constructor() {
    // The stores of the picked brand, for a store link.
    effect(() => {
      const brandId = this.brandId();
      const kind = this.linkKind();
      untracked(() => {
        if (!brandId || kind !== 'STORE') {
          this.stores.set([]);
          return;
        }
        this.catalog.listStores(brandId).subscribe({
          next: (list) => {
            this.stores.set(list);
            // A store picked under another brand does not belong here.
            const picked = this.form.controls.storeId.value;
            if (picked && !list.some((s) => s.id === picked)) this.form.controls.storeId.setValue('');
          },
        });
      });
    });
  }

  ngOnInit(): void {
    if (!this.activeBrand.loaded()) this.activeBrand.refresh();
    this.loadPreview();
    const id = this.announcementId();
    if (id) this.load(id);
  }

  /** «Сохранить черновик»: back to the list. */
  saveDraft(): void {
    this.persist().subscribe({
      next: () => void this.router.navigate(['/announcements']),
      error: (err) => this.fail(err),
    });
  }

  /** Saves, then sends (or schedules) and goes back to the list. */
  saveAndSend(): void {
    this.persist()
      .pipe(
        switchMap((row) =>
          this.http.post<AnnouncementRow>(`${this.api.baseUrl}/admin/announcements/${row.id}/send`, {}),
        ),
      )
      .subscribe({
        next: () => {
          this.confirmingSend.set(false);
          void this.router.navigate(['/announcements']);
        },
        error: (err) => {
          this.confirmingSend.set(false);
          this.fail(err);
        },
      });
  }

  /** The current copy to the signed-in admin only. */
  sendTest(): void {
    if (this.form.invalid) return;
    const raw = this.form.getRawValue();
    this.testing.set(true);
    this.testMessage.set(null);
    this.http
      .post<AnnouncementTestResult>(`${this.api.baseUrl}/admin/announcements/test`, {
        title: raw.title,
        body: raw.body,
        ...this.linkBody(),
      })
      .subscribe({
        next: (r) => {
          this.testing.set(false);
          this.testMessage.set(this.describeTest(r));
        },
        error: (err) => {
          this.testing.set(false);
          this.testMessage.set({ ok: false, text: apiErrorMessage(err, this.translate, ANNOUNCEMENT_ERROR_WORDING) });
        },
      });
  }

  /** The link as the API takes it: one id or none, the other cleared. */
  private linkBody(): { linkStoreId: string | null; linkBrandId: string | null } {
    const raw = this.form.getRawValue();
    if (raw.linkKind === 'STORE' && raw.storeId) return { linkStoreId: raw.storeId, linkBrandId: null };
    if (raw.linkKind === 'BRAND' && raw.brandId) return { linkStoreId: null, linkBrandId: raw.brandId };
    return { linkStoreId: null, linkBrandId: null };
  }

  /**
   * Creates the draft or saves the changes. A new draft turns the form into
   * its edit form, so a send that fails afterwards never creates it twice.
   */
  private persist(): Observable<AnnouncementRow> {
    return new Observable<AnnouncementRow>((subscriber) => {
      if (this.form.invalid || this.locked() || !this.linkComplete()) {
        subscriber.complete();
        return;
      }
      this.saving.set(true);
      this.error.set(null);
      const raw = this.form.getRawValue();
      const body = {
        title: raw.title,
        body: raw.body,
        ...this.linkBody(),
        scheduledAt: raw.scheduledAt ? new Date(raw.scheduledAt).toISOString() : null,
      };
      const id = this.announcementId();
      const request = id
        ? this.http.patch<AnnouncementRow>(`${this.api.baseUrl}/admin/announcements/${id}`, body)
        : this.http.post<AnnouncementRow>(`${this.api.baseUrl}/admin/announcements`, body);
      const sub = request.subscribe({
        next: (row) => {
          if (!id) {
            this.announcementId.set(row.id);
            this.location.replaceState(`/announcements/${row.id}`);
          }
          this.saving.set(false);
          subscriber.next(row);
          subscriber.complete();
        },
        error: (err) => subscriber.error(err),
      });
      return () => sub.unsubscribe();
    });
  }

  private fail(err: unknown): void {
    this.saving.set(false);
    this.error.set(apiErrorMessage(err, this.translate, ANNOUNCEMENT_ERROR_WORDING));
  }

  private load(id: string): void {
    this.http.get<AnnouncementRow>(`${this.api.baseUrl}/admin/announcements/${id}`).subscribe({
      next: (row) => {
        // A store link names its brand so the store list can load.
        const brandId = row.linkBrandId ?? '';
        this.form.patchValue({
          title: row.title,
          body: row.body,
          linkKind: row.linkStoreId ? 'STORE' : row.linkBrandId ? 'BRAND' : 'NONE',
          brandId,
          storeId: row.linkStoreId ?? '',
          scheduledAt: row.scheduledAt ? toLocalInput(new Date(row.scheduledAt)) : '',
        });
        if (row.linkStoreId) this.selectBrandOfStore(row.linkStoreId);
        this.locked.set(!row.editable);
        if (!row.editable) this.form.disable();
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(apiErrorMessage(err, this.translate, ANNOUNCEMENT_ERROR_WORDING));
      },
    });
  }

  /** The announcement keeps only the store id; its brand is looked up for the pickers. */
  private selectBrandOfStore(storeId: string): void {
    this.catalog.listStores().subscribe({
      next: (list) => {
        const store = list.find((s) => s.id === storeId);
        if (!store) return;
        this.form.controls.brandId.setValue(store.brandId);
        this.form.controls.storeId.setValue(storeId);
      },
    });
  }

  private loadPreview(): void {
    this.http.get<AnnouncementPreview>(`${this.api.baseUrl}/admin/announcements/preview`).subscribe({
      next: (p) => this.preview.set(p),
      error: () => this.previewError.set(this.translate.instant('admin.campaigns.reach.error')),
    });
  }

  private describeTest(r: AnnouncementTestResult): { ok: boolean; text: string } {
    if (r.outcome === 'sent') {
      const via = r.via.map((v) => this.translate.instant(`admin.campaigns.test.via.${v}`)).join(', ');
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
    return { ok: false, text: this.translate.instant('admin.announcements.testNoChannel') };
  }
}

/** A date as a `datetime-local` value, in the browser's time zone: 2026-10-12T09:00. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
