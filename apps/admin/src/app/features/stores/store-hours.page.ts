import { Component, effect, inject, input, signal } from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AdminCatalogApi, type StoreWorkingHourDto } from '../../core/catalog/admin-catalog.service';
import { extractMessage } from '../../core/http/extract-message';
import { FormPageComponent } from '../../shared/form-page.component';

type DayGroup = FormGroup<{
  isClosed: FormControl<boolean>;
  opens: FormControl<string>;
  closes: FormControl<string>;
}>;

/** Opening hours for one store, on their own route. */
@Component({
  selector: 'app-store-hours',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, FormPageComponent],
  template: `
    <app-form-page
      [backTo]="['/stores']"
      backLabel="admin.stores.title"
      title="admin.stores.hoursTitle"
      [subtitle]="storeName()"
      [saving]="saving()"
      [loading]="loading()"
      [error]="error()"
      (save)="submit()"
    >
      <form [formGroup]="form" class="flex flex-col" style="gap: 10px">
        <div [formArrayName]="'days'" class="flex flex-col" style="gap: 10px">
          @for (day of days.controls; track $index; let i = $index) {
            <div [formGroupName]="i" class="flex items-center flex-wrap" style="gap: 12px">
              <span
                style="width: 44px; font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-primary)"
                >{{ 'admin.stores.editor.day.' + i | translate }}</span
              >
              <label class="flex items-center" style="gap: 6px">
                <input formControlName="isClosed" type="checkbox" />
                <span class="field-label">{{ 'admin.stores.editor.closed' | translate }}</span>
              </label>
              <input
                formControlName="opens"
                type="time"
                [attr.disabled]="day.controls.isClosed.value ? '' : null"
                class="field-input field-input-mono"
                style="width: 120px"
              />
              <span style="font-family: var(--font-sans); color: var(--color-text-tertiary)">—</span>
              <input
                formControlName="closes"
                type="time"
                [attr.disabled]="day.controls.isClosed.value ? '' : null"
                class="field-input field-input-mono"
                style="width: 120px"
              />
            </div>
          }
        </div>
      </form>
    </app-form-page>
  `,
})
export class StoreHoursPage {
  readonly storeId = input.required<string>();

  private readonly api = inject(AdminCatalogApi);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly storeName = signal<string | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({ days: new FormArray<DayGroup>([]) });

  get days(): FormArray<DayGroup> {
    return this.form.controls.days;
  }

  constructor() {
    // Seven rows, Sunday first, matching JS getDay() and the API's weekday.
    for (let i = 0; i < 7; i++) {
      this.days.push(
        new FormGroup({
          isClosed: new FormControl(false, { nonNullable: true }),
          opens: new FormControl('09:00', { nonNullable: true }),
          closes: new FormControl('21:00', { nonNullable: true }),
        }),
      );
    }

    effect(() => {
      const id = this.storeId();
      this.loading.set(true);
      this.api.getStore(id).subscribe({
        next: (store) => {
          this.storeName.set(store.name);
          for (const h of store.workingHours ?? []) {
            this.days.at(h.weekday)?.patchValue({
              isClosed: h.isClosed,
              opens: minutesToTime(h.opensAt),
              closes: minutesToTime(h.closesAt),
            });
          }
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.error.set(extractMessage(err) ?? this.translate.instant('common.genericError'));
        },
      });
    });
  }

  submit(): void {
    this.saving.set(true);
    this.error.set(null);
    const hours: StoreWorkingHourDto[] = this.days.controls.map((day, weekday) => {
      const v = day.getRawValue();
      return {
        weekday,
        isClosed: v.isClosed,
        opensAt: timeToMinutes(v.opens),
        closesAt: timeToMinutes(v.closes),
      };
    });
    this.api.replaceWorkingHours(this.storeId(), hours).subscribe({
      next: () => this.router.navigate(['/stores']),
      error: (err) => {
        this.saving.set(false);
        this.error.set(extractMessage(err) ?? this.translate.instant('common.genericError'));
      },
    });
  }
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(mins: number): string {
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
}
