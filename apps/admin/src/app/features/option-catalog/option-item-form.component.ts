import { Component, OnInit, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import {
  type CatalogGroup,
  type CatalogOption,
  OPTION_MAX_QTY_LIMIT,
  OPTION_NAME_MAX_LENGTH,
  OPTION_NOTE_MAX_LENGTH,
  type UpsertCatalogOptionRequest,
} from '@takeaway/shared-types';

import { isQtyRangeValid } from '../../core/catalog/option-catalog';
import { MENU_FORM_STYLES } from '../menu/menu-form.styles';
import { parseCount } from '../menu/menu-input';

/**
 * Create or edit one option of a catalog group: its name and note
 * («300–350 мл»); for a list or yes/no group whether it starts picked; for
 * a counter its bounds and starting count (`0 ≤ min ≤ start ≤ max ≤ 20`,
 * blanks read as 0 / 0 / 20).
 */
@Component({
  selector: 'app-option-item-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe],
  styles: [MENU_FORM_STYLES],
  template: `
    <form
      [formGroup]="form"
      (ngSubmit)="submit()"
      class="flex flex-col"
      style="gap: 8px; padding: 10px 12px; background: var(--color-cream); border-radius: 10px"
      data-testid="option-item-form"
    >
      <div class="flex items-end flex-wrap" style="gap: 8px 12px">
        <label class="field" style="flex: 1 1 180px">
          <span class="label">{{ 'admin.optionsCatalog.fields.name' | translate }}</span>
          <input
            class="control small"
            formControlName="name"
            [attr.maxlength]="nameMax"
            [placeholder]="'admin.optionsCatalog.optionForm.namePlaceholder' | translate"
            data-testid="option-name"
          />
        </label>
        <label class="field" style="flex: 1 1 140px">
          <span class="label">{{ 'admin.optionsCatalog.fields.note' | translate }}</span>
          <input
            class="control small"
            formControlName="note"
            [attr.maxlength]="noteMax"
            [placeholder]="'admin.optionsCatalog.optionForm.notePlaceholder' | translate"
            data-testid="option-note"
          />
        </label>
        @if (group().type === 'C') {
          <label class="field" style="flex: 0 1 80px">
            <span class="label">{{ 'admin.optionsCatalog.optionForm.min' | translate }}</span>
            <input class="control small" formControlName="minQty" inputmode="numeric" placeholder="0" />
          </label>
          <label class="field" style="flex: 0 1 80px">
            <span class="label">{{ 'admin.optionsCatalog.optionForm.start' | translate }}</span>
            <input class="control small" formControlName="defaultQty" inputmode="numeric" placeholder="0" />
          </label>
          <label class="field" style="flex: 0 1 80px">
            <span class="label">{{ 'admin.optionsCatalog.optionForm.max' | translate }}</span>
            <input class="control small" formControlName="maxQty" inputmode="numeric" [placeholder]="qtyLimit" />
          </label>
        }
      </div>
      @if (group().type === 'C') {
        <span class="hint">{{ 'admin.optionsCatalog.optionForm.qtyHint' | translate }}</span>
      } @else {
        <label class="check">
          <input type="checkbox" formControlName="isDefault" data-testid="option-default" />
          <span>{{ 'admin.optionsCatalog.optionForm.isDefault' | translate }}</span>
        </label>
      }
      @if (problem(); as key) {
        <span class="error" role="alert">{{ key | translate }}</span>
      }
      <div class="flex items-center flex-wrap" style="gap: 8px 12px">
        <button type="submit" class="primary small disabled:opacity-50" [disabled]="busy()" data-testid="option-submit">
          {{ (option() ? 'common.save' : 'admin.optionsCatalog.optionForm.create') | translate }}
        </button>
        <button type="button" class="link muted" (click)="cancelled.emit()">{{ 'common.cancel' | translate }}</button>
      </div>
    </form>
  `,
})
export class OptionItemFormComponent implements OnInit {
  readonly group = input.required<CatalogGroup>();
  /** The option being edited; null for a new one. */
  readonly option = input<CatalogOption | null>(null);
  readonly busy = input(false);

  readonly submitted = output<UpsertCatalogOptionRequest>();
  readonly cancelled = output<void>();

  readonly nameMax = OPTION_NAME_MAX_LENGTH;
  readonly noteMax = OPTION_NOTE_MAX_LENGTH;
  readonly qtyLimit = String(OPTION_MAX_QTY_LIMIT);
  readonly problem = signal<string | null>(null);
  readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(OPTION_NAME_MAX_LENGTH)],
    }),
    note: new FormControl('', { nonNullable: true }),
    isDefault: new FormControl(false, { nonNullable: true }),
    minQty: new FormControl('', { nonNullable: true }),
    maxQty: new FormControl('', { nonNullable: true }),
    defaultQty: new FormControl('', { nonNullable: true }),
  });

  ngOnInit(): void {
    const o = this.option();
    if (!o) return;
    this.form.reset({
      name: o.name,
      note: o.note ?? '',
      isDefault: o.isDefault,
      minQty: o.minQty === null ? '' : String(o.minQty),
      maxQty: o.maxQty === null ? '' : String(o.maxQty),
      defaultQty: o.defaultQty === null ? '' : String(o.defaultQty),
    });
  }

  submit(): void {
    const v = this.form.getRawValue();
    const name = v.name.trim();
    const note = v.note.trim();
    if (!name || name.length > OPTION_NAME_MAX_LENGTH) {
      this.problem.set('admin.optionsCatalog.validation.name');
      return;
    }
    if (note.length > OPTION_NOTE_MAX_LENGTH) {
      this.problem.set('admin.optionsCatalog.validation.note');
      return;
    }
    const counter = this.group().type === 'C';
    const qty = (text: string): number | null | undefined =>
      text.trim() === '' ? null : (parseCount(text, 0, OPTION_MAX_QTY_LIMIT) ?? undefined);
    const minQty = counter ? qty(v.minQty) : null;
    const maxQty = counter ? qty(v.maxQty) : null;
    const defaultQty = counter ? qty(v.defaultQty) : null;
    if (
      minQty === undefined ||
      maxQty === undefined ||
      defaultQty === undefined ||
      (counter && !isQtyRangeValid(minQty, defaultQty, maxQty))
    ) {
      this.problem.set('admin.optionsCatalog.validation.qty');
      return;
    }
    this.problem.set(null);
    this.submitted.emit({
      name,
      note: note || null,
      isDefault: counter ? false : v.isDefault,
      minQty,
      maxQty,
      defaultQty,
    });
  }
}
