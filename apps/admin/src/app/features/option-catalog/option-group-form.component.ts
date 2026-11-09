import { Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import {
  type CatalogGroup,
  OPTION_GROUP_KINDS,
  OPTION_NAME_MAX_LENGTH,
  type OptionGroupKind,
  type UpsertCatalogGroupRequest,
} from '@takeaway/shared-types';

import { isSelectRangeValid } from '../../core/catalog/option-catalog';
import { MENU_FORM_STYLES } from '../menu/menu-form.styles';
import { parseCount } from '../menu/menu-input';

type CreatableType = UpsertCatalogGroupRequest['type'];
const TYPES: readonly CreatableType[] = ['A', 'B', 'C'];

/**
 * Create or edit one catalog group: what it is (variant or add-on), how it
 * is picked (A list, B yes/no, C counter — each with one line of
 * explanation), its name, an A group's bounds and the condition it is shown
 * on. A variant is never a counter. The form checks what the API would
 * refuse (OPTION_GROUP_INVALID) before sending.
 */
@Component({
  selector: 'app-option-group-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe],
  styles: [
    MENU_FORM_STYLES,
    `
      .choice {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 8px 10px;
        border: 1px solid var(--color-border-light);
        border-radius: 10px;
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-text-primary);
        cursor: pointer;
      }
      .choice.off {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .choice input {
        margin-top: 2px;
      }
    `,
  ],
  template: `
    <form
      [formGroup]="form"
      (ngSubmit)="submit()"
      class="flex flex-col"
      style="gap: 12px; padding: 14px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 14px"
      data-testid="option-group-form"
    >
      <h3 style="margin: 0; font-family: var(--font-display); font-size: 17px; color: var(--color-espresso)">
        @if (group(); as g) {
          {{ 'admin.optionsCatalog.groupForm.editTitle' | translate: { name: g.name } }}
        } @else {
          {{ 'admin.optionsCatalog.groupForm.newTitle' | translate }}
        }
      </h3>

      <fieldset class="box">
        <legend>{{ 'admin.optionsCatalog.groupForm.kind' | translate }}</legend>
        @for (k of kinds; track k) {
          <label class="choice">
            <input type="radio" formControlName="kind" [value]="k" />
            <span class="flex flex-col" style="gap: 2px">
              <strong>{{ 'admin.optionsCatalog.kinds.' + k | translate }}</strong>
              <span class="hint">{{ 'admin.optionsCatalog.kindHints.' + k | translate }}</span>
            </span>
          </label>
        }
      </fieldset>

      <fieldset class="box">
        <legend>{{ 'admin.optionsCatalog.groupForm.type' | translate }}</legend>
        @for (t of types; track t) {
          <label class="choice" [class.off]="t === 'C' && isVariant()">
            <input
              type="radio"
              formControlName="type"
              [value]="t"
              [attr.disabled]="t === 'C' && isVariant() ? '' : null"
              [attr.data-testid]="'group-type-' + t"
            />
            <span class="flex flex-col" style="gap: 2px">
              <strong>{{ t }} · {{ 'admin.optionsCatalog.types.' + t | translate }}</strong>
              <span class="hint">
                @if (t === 'C' && isVariant()) {
                  {{ 'admin.optionsCatalog.variantNotCounter' | translate }}
                } @else {
                  {{ 'admin.optionsCatalog.typeHints.' + t | translate }}
                }
              </span>
            </span>
          </label>
        }
      </fieldset>

      <label class="field">
        <span class="label">{{ 'admin.optionsCatalog.fields.name' | translate }}</span>
        <input
          class="control"
          formControlName="name"
          [attr.maxlength]="nameMax"
          [placeholder]="'admin.optionsCatalog.groupForm.namePlaceholder' | translate"
          data-testid="group-name"
        />
      </label>

      @if (isListType()) {
        <div class="flex flex-wrap" style="gap: 8px 12px">
          <label class="field" style="flex: 0 1 120px">
            <span class="label">{{ 'admin.optionsCatalog.groupForm.min' | translate }}</span>
            <input class="control" formControlName="minSelect" inputmode="numeric" data-testid="group-min" />
          </label>
          <label class="field" style="flex: 0 1 120px">
            <span class="label">{{ 'admin.optionsCatalog.groupForm.max' | translate }}</span>
            <input class="control" formControlName="maxSelect" inputmode="numeric" data-testid="group-max" />
          </label>
        </div>
      }

      <label class="field">
        <span class="label">{{ 'admin.optionsCatalog.groupForm.showIf' | translate }}</span>
        <select class="control" formControlName="showIfOptionId" data-testid="group-show-if">
          <option value="">{{ 'admin.optionsCatalog.groupForm.showIfAlways' | translate }}</option>
          @for (g of conditionGroups(); track g.id) {
            <optgroup [label]="g.name">
              @for (o of g.options; track o.id) {
                <option [value]="o.id">{{ o.name }}</option>
              }
            </optgroup>
          }
        </select>
        <span class="hint">{{ 'admin.optionsCatalog.groupForm.showIfHint' | translate }}</span>
      </label>

      @if (problem(); as key) {
        <span class="error" role="alert">{{ key | translate }}</span>
      }
      <div class="flex items-center flex-wrap" style="gap: 8px 12px">
        <button type="submit" class="primary disabled:opacity-50" [disabled]="busy()" data-testid="group-submit">
          {{ (group() ? 'common.save' : 'admin.optionsCatalog.groupForm.create') | translate }}
        </button>
        <button type="button" class="link muted" (click)="cancelled.emit()">{{ 'common.cancel' | translate }}</button>
      </div>
    </form>
  `,
})
export class OptionGroupFormComponent implements OnInit {
  /** The group being edited; null for a new one. */
  readonly group = input<CatalogGroup | null>(null);
  /** The whole catalog, for the condition picker. */
  readonly groups = input<readonly CatalogGroup[]>([]);
  readonly busy = input(false);

  readonly submitted = output<UpsertCatalogGroupRequest>();
  readonly cancelled = output<void>();

  private readonly destroyRef = inject(DestroyRef);

  readonly kinds = OPTION_GROUP_KINDS;
  readonly types = TYPES;
  readonly nameMax = OPTION_NAME_MAX_LENGTH;
  readonly form = new FormGroup({
    kind: new FormControl<OptionGroupKind>('ADDON', { nonNullable: true }),
    type: new FormControl<CreatableType>('A', { nonNullable: true }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(OPTION_NAME_MAX_LENGTH)],
    }),
    minSelect: new FormControl('0', { nonNullable: true }),
    maxSelect: new FormControl('1', { nonNullable: true }),
    showIfOptionId: new FormControl('', { nonNullable: true }),
  });

  private readonly kind = signal<OptionGroupKind>('ADDON');
  private readonly type = signal<CreatableType>('A');
  readonly isVariant = computed(() => this.kind() === 'VARIANT');
  readonly isListType = computed(() => this.type() === 'A');
  readonly problem = signal<string | null>(null);

  /** Every other group with options: a group cannot depend on an option of its own. */
  readonly conditionGroups = computed(() => {
    const own = this.group()?.id;
    return this.groups().filter((g) => g.id !== own && g.options.length > 0);
  });

  ngOnInit(): void {
    const g = this.group();
    if (g) {
      this.form.reset({
        kind: g.kind,
        type: g.type === 'D' ? 'A' : g.type,
        name: g.name,
        minSelect: String(g.minSelect ?? 0),
        maxSelect: String(g.maxSelect ?? 1),
        showIfOptionId: g.showIfOptionId ?? '',
      });
    }
    this.kind.set(this.form.controls.kind.value);
    this.type.set(this.form.controls.type.value);

    this.form.controls.kind.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((kind) => {
      this.kind.set(kind);
      if (kind === 'VARIANT' && this.form.controls.type.value === 'C') this.form.controls.type.setValue('A');
      // A variant is chosen at least once; an add-on list starts optional.
      if (!this.group() && this.form.controls.minSelect.pristine) {
        this.form.controls.minSelect.setValue(kind === 'VARIANT' ? '1' : '0');
      }
    });
    this.form.controls.type.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((type) => this.type.set(type));
  }

  submit(): void {
    const v = this.form.getRawValue();
    const name = v.name.trim();
    if (!name || name.length > OPTION_NAME_MAX_LENGTH) {
      this.problem.set('admin.optionsCatalog.validation.name');
      return;
    }
    if (v.kind === 'VARIANT' && v.type === 'C') {
      this.problem.set('admin.optionsCatalog.variantNotCounter');
      return;
    }
    let minSelect: number | null = null;
    let maxSelect: number | null = null;
    if (v.type === 'A') {
      minSelect = parseCount(v.minSelect || '0', 0, 99);
      maxSelect = parseCount(v.maxSelect || '1', 1, 99);
      if (minSelect === null || maxSelect === null || !isSelectRangeValid(minSelect, maxSelect)) {
        this.problem.set('admin.optionsCatalog.validation.select');
        return;
      }
    }
    this.problem.set(null);
    this.submitted.emit({
      kind: v.kind,
      type: v.type,
      name,
      minSelect,
      maxSelect,
      showIfOptionId: v.showIfOptionId || null,
    });
  }
}
