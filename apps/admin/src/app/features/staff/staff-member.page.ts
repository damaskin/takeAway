import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  STAFF_LOGIN_MAX_LENGTH,
  STAFF_LOGIN_MIN_LENGTH,
  STAFF_PASSWORD_MAX_LENGTH,
  STAFF_PASSWORD_MIN_LENGTH,
} from '@takeaway/shared-types';
import { generateTempPassword, tempPasswordValid } from '@takeaway/utils';
import { of, switchMap } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { signInIdentifier } from '../../core/auth/sign-in-identifier';
import { apiErrorCode } from '../../core/http/api-error';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import {
  type StaffInviteResult,
  type StaffMember,
  type StaffPasswordReset,
  type StaffRole,
  StaffService,
} from '../../core/staff/staff.service';
import { newPinProblem } from '../../core/kitchen/kitchen-pin';
import { FormPageComponent } from '../../shared/form-page.component';
import { storeErrorMessage } from '../stores/store-errors';
import { staffErrorMessage } from './staff-errors';
import { StaffStorePickerComponent } from './staff-store-picker.component';

/**
 * One employee: their role, the stores they work at, the kitchen PIN and —
 * for the owner — «Сбросить пароль». Stores are ticked here rather than
 * people being added store by store.
 *
 * The PIN is the person's one PIN for every store they work at in the
 * brand. A PIN set before that opens one store only; the page says so and
 * offers a new one. Kitchen staff invited with a PIN only have no email,
 * login or password: the owner can add a way into the cabinet here.
 */
@Component({
  selector: 'app-staff-member',
  standalone: true,
  imports: [TranslatePipe, FormPageComponent, StaffStorePickerComponent],
  template: `
    <app-form-page
      [backTo]="['/staff']"
      backLabel="admin.staff.title"
      title="admin.staff.memberTitle"
      [subtitle]="member()?.name || member()?.email || member()?.login || null"
      [saveDisabled]="!canSave()"
      [saving]="saving()"
      [loading]="loading()"
      [error]="error()"
      (save)="save()"
    >
      @if (member(); as m) {
        <div class="flex flex-col" style="gap: 18px">
          <dl class="contact">
            @if (m.email) {
              <div>
                <dt>{{ 'admin.staff.email' | translate }}</dt>
                <dd>{{ m.email }}</dd>
              </div>
            }
            @if (m.login) {
              <div>
                <dt>{{ 'admin.staff.login' | translate }}</dt>
                <dd data-testid="member-login">{{ m.login }}</dd>
              </div>
            }
            @if (m.phone) {
              <div>
                <dt>{{ 'admin.staff.phone' | translate }}</dt>
                <dd>{{ m.phone }}</dd>
              </div>
            }
            @if (m.blocked) {
              <div>
                <dd class="blocked">{{ 'admin.staff.blocked' | translate }}</dd>
              </div>
            }
          </dl>

          @if (!m.editable) {
            <p class="note">
              {{ (isSelf() ? 'admin.staff.readOnlySelf' : 'admin.staff.readOnlyManager') | translate }}
            </p>
          }

          <label class="field" style="max-width: 320px">
            <span class="field-label">{{ 'admin.staff.roleLabel' | translate }}</span>
            <select
              class="field-input"
              [disabled]="!m.editable"
              [value]="role()"
              (change)="role.set($any($event.target).value)"
            >
              @for (r of roleOptions(); track r) {
                <option [value]="r" [selected]="r === role()">{{ 'admin.staff.role.' + r | translate }}</option>
              }
            </select>
          </label>

          <app-staff-store-picker [stores]="stores()" [(selected)]="selectedStores" [disabled]="!m.editable" />
          @if (m.editable && selectedStores().length === 0) {
            <p class="warn">{{ 'admin.staff.noStoresWarning' | translate }}</p>
          }

          @if (m.role === 'STAFF' || m.role === 'STORE_MANAGER') {
            <section class="pin" aria-labelledby="member-kitchen-pin">
              <h2 id="member-kitchen-pin">{{ 'admin.staff.kitchenPin' | translate }}</h2>
              <p class="note" data-testid="member-pin-state">
                @if (m.hasKdsPin && m.kdsPinStoreId) {
                  {{ 'admin.staff.pinOpensLegacy' | translate: { store: pinStoreName() } }}
                } @else if (m.hasKdsPin) {
                  {{ 'admin.staff.pinOpensAll' | translate }}
                } @else if (pinOnly()) {
                  {{ 'admin.staff.pinNoneNoSignIn' | translate }}
                } @else {
                  {{ 'admin.staff.pinNone' | translate }}
                }
              </p>
              <p class="note">{{ 'admin.staff.pinHint' | translate }}</p>
              @if (m.editable && m.stores.length > 0) {
                <form class="pin-row" (submit)="setPin($event)">
                  <label class="field">
                    <span class="field-label">{{ 'admin.stores.kitchen.pin' | translate }}</span>
                    <input
                      type="text"
                      inputmode="numeric"
                      autocomplete="off"
                      maxlength="6"
                      class="field-input field-input-mono"
                      style="letter-spacing: 0.2em"
                      [value]="pin()"
                      (input)="onPinInput($event)"
                      [placeholder]="'admin.stores.kitchen.pinPlaceholder' | translate"
                    />
                  </label>
                  <div class="pin-actions">
                    <button type="submit" class="primary" [disabled]="pinBusy() || !pinValid()">
                      {{ (m.hasKdsPin ? 'admin.stores.kitchen.changePin' : 'admin.stores.kitchen.setPin') | translate }}
                    </button>
                    @if (m.hasKdsPin) {
                      <button type="button" class="danger-link" [disabled]="pinBusy()" (click)="clearPin()">
                        {{ 'admin.stores.kitchen.resetPin' | translate }}
                      </button>
                    }
                  </div>
                </form>
                @if (pin() && !pinValid()) {
                  <p class="note">
                    {{
                      (pinProblem() === 'TOO_SIMPLE'
                        ? 'admin.stores.errors.pinTooSimple'
                        : 'admin.stores.errors.pinFormat'
                      ) | translate
                    }}
                  </p>
                }
                @if (pinSaved()) {
                  <p class="ok">{{ 'admin.stores.kitchen.saved' | translate }}</p>
                }
                @if (pinError(); as message) {
                  <p role="alert" class="err">{{ message }}</p>
                }
              }
            </section>
          }

          @if (canResetPassword() && (pinOnly() || signInAdded())) {
            <section class="pin" aria-labelledby="member-sign-in" data-testid="member-sign-in">
              <h2 id="member-sign-in">{{ 'admin.staff.signIn.title' | translate }}</h2>
              @if (signInAdded(); as added) {
                <p class="note">{{ 'admin.staff.signIn.done' | translate }}</p>
                <dl class="contact">
                  <div>
                    <dt>{{ 'admin.staff.invited.login' | translate }}</dt>
                    <dd>{{ added.login || added.email }}</dd>
                  </div>
                  <div>
                    <dt>{{ 'admin.staff.tempPassword' | translate }}</dt>
                    <dd data-testid="sign-in-temp-password">{{ signInPassword() }}</dd>
                  </div>
                </dl>
              } @else {
                <p class="note">{{ 'admin.staff.signIn.none' | translate }}</p>
                <form class="pin-row" (submit)="addSignIn($event)">
                  <label class="field">
                    <span class="field-label">{{ 'admin.staff.identifier' | translate }}</span>
                    <input
                      type="text"
                      autocomplete="off"
                      autocapitalize="none"
                      spellcheck="false"
                      class="field-input"
                      [value]="signInId()"
                      (input)="signInId.set($any($event.target).value)"
                    />
                  </label>
                  <label class="field">
                    <span class="field-label">{{ 'admin.staff.tempPassword' | translate }}</span>
                    <input
                      type="text"
                      autocomplete="off"
                      spellcheck="false"
                      class="field-input field-input-mono"
                      [value]="signInPassword()"
                      (input)="signInPassword.set($any($event.target).value)"
                    />
                  </label>
                  <div class="pin-actions">
                    <button type="button" class="outline" (click)="signInPassword.set(generate())">
                      {{ 'admin.staff.generate' | translate }}
                    </button>
                    <button type="submit" class="primary" [disabled]="signInBusy() || !signInValid()">
                      {{ 'admin.staff.signIn.add' | translate }}
                    </button>
                  </div>
                </form>
                <p class="note">{{ 'admin.staff.identifierHint' | translate: loginRule }}</p>
                <p class="note">{{ 'admin.staff.tempPasswordRule' | translate: passwordRule }}</p>
              }
              @if (signInError(); as message) {
                <p role="alert" class="err">{{ message }}</p>
              }
            </section>
          }

          @if (canResetPassword() && !pinOnly() && !signInAdded()) {
            <section class="pin" aria-labelledby="member-password">
              <h2 id="member-password">{{ 'admin.staff.password.title' | translate }}</h2>
              @if (passwordReset(); as r) {
                <p class="note">{{ 'admin.staff.password.done' | translate }}</p>
                <div class="pin-actions">
                  <code class="temp-password" data-testid="reset-temp-password">{{ r.tempPassword }}</code>
                  <button type="button" class="primary" (click)="copyPassword(r.tempPassword)">
                    {{ (passwordCopied() ? 'admin.staff.tablets.copied' : 'admin.staff.tablets.copy') | translate }}
                  </button>
                </div>
                <p class="warn">{{ 'admin.staff.password.showOnce' | translate }}</p>
                @switch (r.resetEmail) {
                  @case ('SENT') {
                    <p class="note">{{ 'admin.staff.password.emailSent' | translate: { email: m.email } }}</p>
                  }
                  @case ('FAILED') {
                    <p class="note">{{ 'admin.staff.password.emailFailed' | translate }}</p>
                  }
                  @case ('NO_EMAIL') {
                    <p class="note" data-testid="reset-no-email">{{ 'admin.staff.password.noEmail' | translate }}</p>
                  }
                  @default {
                    <p class="note">{{ 'admin.staff.password.emailOff' | translate }}</p>
                  }
                }
              } @else {
                <p class="note">{{ 'admin.staff.password.hint' | translate }}</p>
                <div class="pin-actions">
                  <button type="button" class="outline" [disabled]="passwordBusy()" (click)="resetPassword()">
                    {{ 'admin.staff.password.reset' | translate }}
                  </button>
                </div>
              }
              @if (passwordError(); as message) {
                <p role="alert" class="err">{{ message }}</p>
              }
            </section>
          }
        </div>
      }

      @if (member()?.editable) {
        <button formPageExtraActions type="button" class="remove" [disabled]="saving()" (click)="removeFromTeam()">
          {{ 'admin.staff.removeFromTeam' | translate }}
        </button>
      }
    </app-form-page>
  `,
  styles: [
    `
      .contact {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 24px;
        margin: 0;
        font-family: var(--font-sans);
      }
      .contact dt {
        font-size: 12px;
        color: var(--color-text-secondary);
      }
      .contact dd {
        margin: 2px 0 0;
        font-family: var(--font-mono);
        font-size: 13px;
        color: var(--color-text-primary);
        overflow-wrap: anywhere;
      }
      .contact dd.blocked {
        font-family: var(--font-sans);
        color: var(--color-berry);
        font-weight: 600;
      }
      .note,
      .warn,
      .ok,
      .err {
        margin: 0;
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .warn {
        color: var(--color-berry);
      }
      .ok {
        color: var(--color-mint);
      }
      .err {
        color: var(--color-berry);
      }
      .pin {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding-top: 16px;
        border-top: 1px solid var(--color-border-light);
      }
      .pin h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: 18px;
        color: var(--color-espresso);
      }
      .pin-row {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        align-items: end;
      }
      .pin-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .primary {
        height: 38px;
        padding: 0 16px;
        background: var(--color-caramel);
        color: white;
        border: 0;
        border-radius: var(--radius-button);
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .outline {
        height: 38px;
        padding: 0 16px;
        background: transparent;
        color: var(--color-espresso);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-button);
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .temp-password {
        padding: 8px 12px;
        background: var(--color-cream);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        font-family: var(--font-mono);
        font-size: 16px;
        letter-spacing: 0.08em;
        user-select: all;
      }
      .primary:disabled,
      .outline:disabled,
      .remove:disabled,
      .danger-link:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .danger-link {
        height: 38px;
        padding: 0 8px;
        background: transparent;
        color: var(--color-berry);
        border: 0;
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .remove {
        height: 40px;
        padding: 0 16px;
        background: transparent;
        color: var(--color-berry);
        border: 1px solid var(--color-berry);
        border-radius: var(--radius-button);
        font-family: var(--font-sans);
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }
    `,
  ],
})
export class StaffMemberPage {
  /** Route param. */
  readonly userId = input.required<string>();

  private readonly staffApi = inject(StaffService);
  private readonly catalog = inject(AdminCatalogApi);
  private readonly brandCtx = inject(ActiveBrandService);
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly member = signal<StaffMember | null>(null);
  readonly stores = signal<StoreAdminDto[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly role = signal<StaffRole>('STAFF');
  readonly selectedStores = signal<string[]>([]);

  readonly pin = signal('');
  readonly pinBusy = signal(false);
  readonly pinSaved = signal(false);
  readonly pinError = signal<string | null>(null);

  /** The new temporary password after «Сбросить пароль» — shown on this page once. */
  readonly passwordReset = signal<StaffPasswordReset | null>(null);
  readonly passwordBusy = signal(false);
  readonly passwordCopied = signal(false);
  readonly passwordError = signal<string | null>(null);

  /** «Вход в кабинет» for someone with a PIN only: an email or a login and a temporary password. */
  readonly signInId = signal('');
  readonly signInPassword = signal('');
  readonly signInBusy = signal(false);
  readonly signInError = signal<string | null>(null);
  readonly signInAdded = signal<StaffInviteResult | null>(null);

  readonly loginRule = { min: STAFF_LOGIN_MIN_LENGTH, max: STAFF_LOGIN_MAX_LENGTH };
  readonly passwordRule = { min: STAFF_PASSWORD_MIN_LENGTH, max: STAFF_PASSWORD_MAX_LENGTH };

  readonly isSelf = computed(() => this.member()?.userId === this.authStore.user()?.id);

  /** Signs in with a kitchen PIN only: no email, no login, no password. */
  readonly pinOnly = computed(() => {
    const m = this.member();
    return !!m && !m.email && !m.login;
  });

  /** The owner (and the platform admin) can reset the password of someone they can edit. */
  readonly canResetPassword = computed(() => {
    const role = this.authStore.user()?.role;
    return (role === 'BRAND_ADMIN' || role === 'SUPER_ADMIN') && !!this.member()?.editable;
  });

  /** A store manager cannot appoint managers; the current role always stays listed. */
  readonly roleOptions = computed<StaffRole[]>(() => {
    const all: StaffRole[] = ['STORE_MANAGER', 'STAFF', 'MENU_EDITOR'];
    if (this.authStore.user()?.role !== 'STORE_MANAGER') return all;
    return all.filter((r) => r !== 'STORE_MANAGER' || this.member()?.role === 'STORE_MANAGER');
  });

  readonly dirty = computed(() => {
    const m = this.member();
    if (!m) return false;
    const saved = m.stores.map((s) => s.id).sort();
    const picked = [...this.selectedStores()].sort();
    return m.role !== this.role() || saved.join() !== picked.join();
  });

  readonly canSave = computed(() => !!this.member()?.editable && this.dirty());

  /** A new PIN is 6 digits and not a first guess; PINs set earlier with 4–5 digits keep working. */
  readonly pinProblem = computed(() => newPinProblem(this.pin()));
  readonly pinValid = computed(() => this.pinProblem() === null);

  /** The one store an old PIN opens. */
  readonly pinStoreName = computed(() => {
    const m = this.member();
    return m?.stores.find((s) => s.id === m.kdsPinStoreId)?.name ?? '';
  });

  readonly signInValid = computed(
    () => signInIdentifier(this.signInId()) !== null && tempPasswordValid(this.signInPassword()),
  );

  constructor() {
    effect(() => {
      const userId = this.userId();
      const brandId = this.brandCtx.activeId();
      untracked(() => this.load(userId, brandId));
    });
  }

  save(): void {
    const m = this.member();
    if (!m || !this.canSave()) return;
    const storeIds = this.selectedStores();
    if (storeIds.length === 0) {
      this.removeFromTeam();
      return;
    }
    const brandId = this.brandCtx.activeId();
    const role = this.role();
    const saved = m.stores.map((s) => s.id).sort();
    const storesChanged = saved.join() !== [...storeIds].sort().join();
    this.saving.set(true);
    this.error.set(null);
    (role !== m.role ? this.staffApi.setRole(m.userId, role, brandId) : of(m))
      .pipe(switchMap((after) => (storesChanged ? this.staffApi.setStores(m.userId, storeIds, brandId) : of(after))))
      .subscribe({
        next: () => void this.router.navigate(['/staff']),
        error: (err) => {
          this.saving.set(false);
          this.error.set(staffErrorMessage(err, this.translate));
        },
      });
  }

  removeFromTeam(): void {
    const m = this.member();
    if (!m || !m.editable) return;
    const name = m.name || m.email || m.login || m.phone || '';
    if (!window.confirm(this.translate.instant('admin.staff.confirmRemoveFromTeam', { name }))) return;
    this.saving.set(true);
    this.error.set(null);
    this.staffApi.setStores(m.userId, [], this.brandCtx.activeId()).subscribe({
      next: () => void this.router.navigate(['/staff']),
      error: (err) => {
        this.saving.set(false);
        this.error.set(staffErrorMessage(err, this.translate));
      },
    });
  }

  /**
   * Ends the person's sessions and replaces their password with a generated
   * one, which the owner passes on; the person changes it at the next
   * sign-in, or sets their own from the emailed link.
   */
  resetPassword(): void {
    const m = this.member();
    if (!m || this.passwordBusy()) return;
    const name = m.name || m.email || m.login || '';
    if (!window.confirm(this.translate.instant('admin.staff.password.confirm', { name }))) return;
    this.passwordBusy.set(true);
    this.passwordError.set(null);
    this.staffApi.resetPassword(m.userId, this.brandCtx.activeId()).subscribe({
      next: (result) => {
        this.passwordBusy.set(false);
        this.passwordCopied.set(false);
        this.passwordReset.set(result);
      },
      error: (err) => {
        this.passwordBusy.set(false);
        this.passwordError.set(
          apiErrorCode(err) === 'STAFF_NOT_EDITABLE'
            ? this.translate.instant('admin.staff.password.notEditable')
            : staffErrorMessage(err, this.translate),
        );
      },
    });
  }

  copyPassword(password: string): void {
    void navigator.clipboard?.writeText(password).then(
      () => this.passwordCopied.set(true),
      () => undefined,
    );
  }

  generate(): string {
    return generateTempPassword();
  }

  /** Gives someone with a PIN only an email or a login and a temporary password for the cabinet. */
  addSignIn(event: Event): void {
    event.preventDefault();
    const m = this.member();
    const identifier = signInIdentifier(this.signInId());
    if (!m || !identifier || !this.signInValid() || this.signInBusy()) return;
    this.signInBusy.set(true);
    this.signInError.set(null);
    const body =
      identifier.kind === 'email'
        ? { email: identifier.value, tempPassword: this.signInPassword() }
        : { login: identifier.value, tempPassword: this.signInPassword() };
    this.staffApi.addSignIn(m.userId, body, this.brandCtx.activeId()).subscribe({
      next: (result) => {
        this.signInBusy.set(false);
        this.signInAdded.set(result);
        this.member.set(result);
      },
      error: (err) => {
        this.signInBusy.set(false);
        this.signInError.set(staffErrorMessage(err, this.translate));
      },
    });
  }

  onPinInput(event: Event): void {
    const field = event.target as HTMLInputElement;
    const digits = field.value.replace(/\D/g, '').slice(0, 6);
    field.value = digits;
    this.pin.set(digits);
    this.pinSaved.set(false);
  }

  /** The person's one PIN for all their stores of the brand; it replaces the old one and signs them out of the tablets. */
  setPin(event: Event): void {
    event.preventDefault();
    const m = this.member();
    if (!m || !this.pinValid() || this.pinBusy()) return;
    this.startPin();
    this.staffApi.setMemberPin(m.userId, this.pin(), this.brandCtx.activeId()).subscribe({
      next: (updated) => {
        this.finishPin(updated);
        this.pin.set('');
      },
      error: (err) => this.failPin(err),
    });
  }

  clearPin(): void {
    const m = this.member();
    if (!m?.hasKdsPin || this.pinBusy()) return;
    const name = m.name || m.email || m.login || '';
    if (!window.confirm(this.translate.instant('admin.stores.kitchen.resetConfirm', { name }))) return;
    this.startPin();
    this.staffApi.clearMemberPin(m.userId, this.brandCtx.activeId()).subscribe({
      next: (updated) => this.finishPin(updated),
      error: (err) => this.failPin(err),
    });
  }

  private load(userId: string, brandId: string | null): void {
    this.loading.set(true);
    this.error.set(null);
    this.passwordReset.set(null);
    this.passwordError.set(null);
    this.signInAdded.set(null);
    this.signInError.set(null);
    this.catalog.listStores(brandId ?? undefined).subscribe({
      next: (list) => this.stores.set(list),
      error: (err) => this.error.set(staffErrorMessage(err, this.translate)),
    });
    this.staffApi.getMember(userId, brandId).subscribe({
      next: (m) => {
        this.member.set(m);
        this.role.set(m.role);
        this.selectedStores.set(m.stores.map((s) => s.id));
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(staffErrorMessage(err, this.translate));
      },
    });
  }

  private startPin(): void {
    this.pinBusy.set(true);
    this.pinSaved.set(false);
    this.pinError.set(null);
  }

  private finishPin(updated: StaffMember): void {
    this.pinBusy.set(false);
    this.pinSaved.set(true);
    this.member.set(updated);
  }

  private failPin(err: unknown): void {
    this.pinBusy.set(false);
    this.pinError.set(storeErrorMessage(err, this.translate));
  }
}
