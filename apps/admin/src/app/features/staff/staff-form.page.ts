import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  STAFF_LOGIN_MAX_LENGTH,
  STAFF_LOGIN_MIN_LENGTH,
  STAFF_PASSWORD_MAX_LENGTH,
  STAFF_PASSWORD_MIN_LENGTH,
} from '@takeaway/shared-types';
import { generateTempPassword, tempPasswordValid } from '@takeaway/utils';

import { AuthStore } from '../../core/auth/auth.store';
import { emailOrLoginValidator, signInIdentifier } from '../../core/auth/sign-in-identifier';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import {
  type InviteStaffRequest,
  type StaffInviteResult,
  type StaffRole,
  StaffService,
} from '../../core/staff/staff.service';
import { FormPageComponent } from '../../shared/form-page.component';
import { staffErrorMessage } from './staff-errors';
import { StaffStorePickerComponent } from './staff-store-picker.component';

/**
 * Invite someone to the team, on its own route. The person can work at
 * several stores from the start; `?storeId=` ticks the store the list was
 * filtered by.
 *
 * Kitchen (STAFF) is picked by default: a café has one manager and several
 * people on the bar and in the kitchen, so it is the invite owners send most.
 * The temporary password shows its rule (the API's: 8–128 characters) and
 * can be generated. After sending, the page says whether the invite email
 * went out — and if not, what to hand over in person.
 *
 * Someone without an email is invited by a login instead (the same field:
 * no '@' makes it a login). Nothing is mailed then; the owner hands the
 * login and the temporary password over, and only the owner can reset it.
 */
@Component({
  selector: 'app-staff-form',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, FormPageComponent, StaffStorePickerComponent],
  template: `
    @if (result(); as r) {
      <section class="invited" data-testid="invite-result">
        <h1 class="invited-title">{{ 'admin.staff.invited.title' | translate }}</h1>
        <p class="invited-text">{{ r.name || r.email || r.login }} · {{ 'admin.staff.role.' + r.role | translate }}</p>
        @switch (r.inviteEmail) {
          @case ('NO_EMAIL') {
            <p class="invited-text" data-testid="invite-no-email">{{ 'admin.staff.invited.noEmail' | translate }}</p>
          }
          @case ('SENT') {
            <p class="invited-text" data-testid="invite-sent">
              {{
                (r.accountCreated ? 'admin.staff.invited.sentNew' : 'admin.staff.invited.sentExisting')
                  | translate: { email: r.email }
              }}
            </p>
          }
          @default {
            <p class="invited-warn" role="alert" data-testid="invite-not-sent">
              {{
                (r.inviteEmail === 'FAILED' ? 'admin.staff.invited.failed' : 'admin.staff.invited.notConfigured')
                  | translate
              }}
            </p>
          }
        }
        @if (r.inviteEmail !== 'SENT' || r.accountCreated) {
          <dl class="invited-handover">
            <div>
              <dt>{{ 'admin.staff.invited.cabinet' | translate }}</dt>
              <dd>{{ loginUrl }}</dd>
            </div>
            <div>
              <dt>{{ 'admin.staff.invited.login' | translate }}</dt>
              <dd data-testid="invite-login">{{ r.login || r.email }}</dd>
            </div>
            <div>
              <dt>{{ 'admin.staff.tempPassword' | translate }}</dt>
              <dd>
                @if (r.accountCreated) {
                  {{ sentPassword() }}
                } @else {
                  {{ 'admin.staff.invited.ownPassword' | translate }}
                }
              </dd>
            </div>
          </dl>
        }
        <div class="invited-actions">
          <a routerLink="/staff" class="invited-primary">{{ 'admin.staff.invited.toList' | translate }}</a>
          <button type="button" class="invited-secondary" (click)="inviteAnother()">
            {{ 'admin.staff.invited.another' | translate }}
          </button>
        </div>
      </section>
    } @else {
      <app-form-page
        [backTo]="['/staff']"
        backLabel="admin.staff.title"
        title="admin.staff.addTitle"
        saveLabel="admin.staff.addCta"
        [saveDisabled]="form.invalid || storeIds().length === 0"
        [saving]="saving()"
        [error]="error()"
        (save)="submit()"
      >
        <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col" style="gap: 14px">
          <div class="form-row">
            <div class="field">
              <label class="field-label" for="staff-identifier">{{ 'admin.staff.identifier' | translate }}</label>
              <input
                id="staff-identifier"
                formControlName="identifier"
                type="text"
                inputmode="email"
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
                class="field-input"
                [attr.aria-describedby]="'staff-identifier-hint'"
              />
              <p
                id="staff-identifier-hint"
                class="rule"
                [class.rule-bad]="identifierInvalid()"
                data-testid="identifier-rule"
              >
                {{ 'admin.staff.identifierHint' | translate: loginRule }}
              </p>
            </div>
            <label class="field">
              <span class="field-label">{{ 'admin.staff.name' | translate }}</span>
              <input formControlName="name" type="text" autocomplete="name" class="field-input" />
            </label>
          </div>

          <div class="form-row">
            <div class="field">
              <label class="field-label" for="staff-role">{{ 'admin.staff.roleLabel' | translate }}</label>
              <select id="staff-role" formControlName="role" class="field-input">
                @for (r of roleOptions(); track r) {
                  <option [value]="r">{{ 'admin.staff.role.' + r | translate }}</option>
                }
              </select>
              <ul class="roles" data-testid="role-descriptions">
                @for (r of roleOptions(); track r) {
                  <li [class.roles-on]="r === form.controls.role.value">
                    <strong>{{ 'admin.staff.role.' + r | translate }}</strong> —
                    {{ 'admin.staff.roleHint.' + r | translate }}
                  </li>
                }
              </ul>
            </div>
            <div class="field">
              <label class="field-label" for="staff-temp-password">{{ 'admin.staff.tempPassword' | translate }}</label>
              <div class="flex" style="gap: 8px">
                <input
                  id="staff-temp-password"
                  formControlName="tempPassword"
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  class="field-input field-input-mono"
                  style="flex: 1; min-width: 0"
                  [attr.aria-describedby]="'staff-temp-password-rule'"
                />
                <button type="button" class="generate" data-testid="generate-password" (click)="generate()">
                  {{ 'admin.staff.generate' | translate }}
                </button>
              </div>
              <p
                id="staff-temp-password-rule"
                class="rule"
                [class.rule-bad]="passwordInvalid()"
                data-testid="password-rule"
              >
                {{ 'admin.staff.tempPasswordRule' | translate: rule }}
              </p>
            </div>
          </div>

          <p class="rule" data-testid="temp-password-hint">
            {{ (byLogin() ? 'admin.staff.tempPasswordHintLogin' : 'admin.staff.tempPasswordHint') | translate }}
          </p>

          <app-staff-store-picker [stores]="stores()" [(selected)]="storeIds" />
        </form>
      </app-form-page>
    }
  `,
  styles: [
    `
      .roles {
        list-style: none;
        margin: 6px 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .roles-on {
        color: var(--color-text-primary);
      }
      .rule {
        margin: 6px 0 0;
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .rule-bad {
        color: var(--color-berry);
      }
      .generate {
        height: 38px;
        padding: 0 12px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-button);
        background: var(--color-latte);
        color: var(--color-espresso);
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
      }
      .invited {
        max-width: 640px;
        margin: 0 auto;
        padding: clamp(16px, 3vw, 28px);
        display: flex;
        flex-direction: column;
        gap: 12px;
        font-family: var(--font-sans);
      }
      .invited-title {
        margin: 0;
        font-family: var(--font-display);
        font-size: 26px;
        color: var(--color-espresso);
      }
      .invited-text,
      .invited-warn {
        margin: 0;
        font-size: 14px;
        color: var(--color-text-secondary);
      }
      .invited-warn {
        color: #8f2f3c;
      }
      .invited-handover {
        margin: 0;
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: 14px;
      }
      .invited-handover dt {
        font-size: 12px;
        color: var(--color-text-secondary);
      }
      .invited-handover dd {
        margin: 2px 0 0;
        font-family: var(--font-mono);
        font-size: 14px;
        overflow-wrap: anywhere;
      }
      .invited-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .invited-primary,
      .invited-secondary {
        height: 40px;
        padding: 0 18px;
        display: inline-flex;
        align-items: center;
        border-radius: var(--radius-button);
        font-size: 14px;
        font-weight: 600;
        text-decoration: none;
        cursor: pointer;
      }
      .invited-primary {
        background: var(--color-caramel);
        color: white;
      }
      .invited-secondary {
        border: 0;
        background: var(--color-latte);
        color: var(--color-espresso);
      }
    `,
  ],
})
export class StaffFormPage {
  /** The store the list page was filtered by. */
  readonly storeId = input<string | undefined>();

  private readonly catalog = inject(AdminCatalogApi);
  private readonly staffApi = inject(StaffService);
  private readonly brandCtx = inject(ActiveBrandService);
  private readonly authStore = inject(AuthStore);
  private readonly translate = inject(TranslateService);

  readonly stores = signal<StoreAdminDto[]>([]);
  readonly storeIds = signal<string[]>([]);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  /** The invite just sent, with whether its email went out. */
  readonly result = signal<StaffInviteResult | null>(null);
  /** The temporary password of the invite just sent, to hand over when no email went out. */
  readonly sentPassword = signal('');

  readonly rule = { min: STAFF_PASSWORD_MIN_LENGTH, max: STAFF_PASSWORD_MAX_LENGTH };
  readonly loginRule = { min: STAFF_LOGIN_MIN_LENGTH, max: STAFF_LOGIN_MAX_LENGTH };
  readonly loginUrl = `${location.origin}/login`;

  /** A store manager hires kitchen staff and menu editors, not other managers. */
  readonly roleOptions = computed<StaffRole[]>(() =>
    this.authStore.user()?.role === 'STORE_MANAGER'
      ? ['STAFF', 'MENU_EDITOR']
      : ['STORE_MANAGER', 'STAFF', 'MENU_EDITOR'],
  );

  readonly form = new FormGroup({
    /** An email, or a login for someone without one — an '@' tells them apart. */
    identifier: new FormControl('', { nonNullable: true, validators: [Validators.required, emailOrLoginValidator] }),
    name: new FormControl('', { nonNullable: true }),
    role: new FormControl<StaffRole>('STAFF', { nonNullable: true }),
    tempPassword: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(STAFF_PASSWORD_MIN_LENGTH),
        Validators.maxLength(STAFF_PASSWORD_MAX_LENGTH),
      ],
    }),
  });

  constructor() {
    effect(() => {
      const brandId = this.brandCtx.activeId();
      untracked(() =>
        this.catalog.listStores(brandId ?? undefined).subscribe({
          next: (list) => {
            this.stores.set(list);
            const preset = this.storeId();
            // The filtered store, or the only one there is.
            const only = list.length === 1 ? list.map((s) => s.id) : [];
            const wanted = preset && list.some((s) => s.id === preset) ? [preset] : only;
            this.storeIds.update((ids) => {
              const kept = ids.filter((id) => list.some((s) => s.id === id));
              return kept.length > 0 ? kept : wanted;
            });
          },
          error: (err) => this.error.set(staffErrorMessage(err, this.translate)),
        }),
      );
    });
  }

  private readonly identifierValue = toSignal(this.form.controls.identifier.valueChanges, { initialValue: '' });
  /** Typed something without an '@': the person is invited by a login, and gets no email. */
  readonly byLogin = computed(() => {
    const value = this.identifierValue().trim();
    return value.length > 0 && !value.includes('@');
  });
  /** The hint turns red once something was typed that is neither an email nor a login. */
  readonly identifierInvalid = computed(() => {
    const value = this.identifierValue();
    return value.trim().length > 0 && signInIdentifier(value) === null;
  });

  private readonly passwordValue = toSignal(this.form.controls.tempPassword.valueChanges, { initialValue: '' });
  /** The rule turns red once something was typed that breaks it. */
  readonly passwordInvalid = computed(() => {
    const value = this.passwordValue();
    return value.length > 0 && !tempPasswordValid(value);
  });

  /** Fills in a strong temporary password; the field shows it so it can be copied or dictated. */
  generate(): void {
    this.form.controls.tempPassword.setValue(generateTempPassword());
    this.form.controls.tempPassword.markAsDirty();
  }

  submit(): void {
    const storeIds = this.storeIds();
    const v = this.form.getRawValue();
    const identifier = signInIdentifier(v.identifier);
    if (this.form.invalid || storeIds.length === 0 || !identifier) return;
    this.saving.set(true);
    this.error.set(null);
    const body: InviteStaffRequest = { role: v.role, tempPassword: v.tempPassword, storeIds };
    if (identifier.kind === 'email') body.email = identifier.value;
    else body.login = identifier.value;
    if (v.name.trim()) body.name = v.name.trim();
    this.staffApi.invite(body, this.brandCtx.activeId()).subscribe({
      next: (result) => {
        this.saving.set(false);
        this.sentPassword.set(v.tempPassword);
        this.result.set(result);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(staffErrorMessage(err, this.translate));
      },
    });
  }

  /** Back to an empty form, keeping the stores picked. */
  inviteAnother(): void {
    this.result.set(null);
    this.sentPassword.set('');
    this.form.reset({ identifier: '', name: '', role: 'STAFF', tempPassword: '' });
  }
}
