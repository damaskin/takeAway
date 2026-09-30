import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { API_CONFIG } from '../../core/api/api.config';
import { extractMessage } from '../../core/http/extract-message';
import { FormPageComponent } from '../../shared/form-page.component';
import { CAMPAIGN_AUDIENCES, CAMPAIGN_CHANNELS, type CampaignRow } from './campaign.types';

/**
 * Compose a campaign draft, on its own route. Sending stays on the list,
 * where the delivery counters are.
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
      [saveDisabled]="form.invalid"
      [saving]="creating()"
      [error]="error()"
      (save)="create()"
    >
      <form [formGroup]="form" (ngSubmit)="create()" class="flex flex-col" style="gap: 14px">
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
      </form>
    </app-form-page>
  `,
})
export class CampaignFormPage {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly channels = CAMPAIGN_CHANNELS;
  readonly audiences = CAMPAIGN_AUDIENCES;
  readonly creating = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2)] }),
    body: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2)] }),
    channel: new FormControl<CampaignRow['channel']>('PUSH', { nonNullable: true }),
    audience: new FormControl<CampaignRow['audience']>('HAS_ORDERED', { nonNullable: true }),
  });

  create(): void {
    if (this.form.invalid) return;
    this.creating.set(true);
    this.error.set(null);
    this.http.post<CampaignRow>(`${this.api.baseUrl}/admin/campaigns`, this.form.getRawValue()).subscribe({
      next: () => this.router.navigate(['/campaigns']),
      error: (err) => {
        this.creating.set(false);
        this.error.set(extractMessage(err) ?? this.translate.instant('common.genericError'));
      },
    });
  }
}
