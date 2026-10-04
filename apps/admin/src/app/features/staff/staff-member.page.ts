import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { of, switchMap } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { type StaffMember, type StaffRole, StaffService } from '../../core/staff/staff.service';
import { FormPageComponent } from '../../shared/form-page.component';
import { storeErrorMessage } from '../stores/store-errors';
import { staffErrorMessage } from './staff-errors';
import { StaffStorePickerComponent } from './staff-store-picker.component';

const PIN_PATTERN = /^[0-9]{4,6}$/;

/**
 * One employee: their role, the stores they work at, and the kitchen PIN.
 * Stores are ticked here rather than people being added store by store.
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
      [subtitle]="member()?.name || member()?.email || null"
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
              <p class="note">
                @if (m.hasKdsPin) {
                  {{ 'admin.staff.pinOpens' | translate: { store: pinStoreName() } }}
                } @else {
                  {{ 'admin.staff.pinNone' | translate }}
                }
              </p>
              <p class="note">{{ 'admin.staff.pinHint' | translate }}</p>
              @if (m.stores.length > 0) {
                <form class="pin-row" (submit)="setPin($event)">
                  <label class="field">
                    <span class="field-label">{{ 'admin.staff.pinStore' | translate }}</span>
                    <select
                      class="field-input"
                      [value]="pinStoreId()"
                      (change)="pinStoreId.set($any($event.target).value)"
                    >
                      @for (s of m.stores; track s.id) {
                        <option [value]="s.id" [selected]="s.id === pinStoreId()">{{ s.name }}</option>
                      }
                    </select>
                  </label>
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
                      {{
                        (pinReplaces() ? 'admin.stores.kitchen.changePin' : 'admin.stores.kitchen.setPin') | translate
                      }}
                    </button>
                    @if (m.hasKdsPin) {
                      <button type="button" class="danger-link" [disabled]="pinBusy()" (click)="clearPin()">
                        {{ 'admin.stores.kitchen.resetPin' | translate }}
                      </button>
                    }
                  </div>
                </form>
                @if (pin() && !pinValid()) {
                  <p class="note">{{ 'admin.stores.errors.pinFormat' | translate }}</p>
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
      .primary:disabled,
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

  readonly pinStoreId = signal('');
  readonly pin = signal('');
  readonly pinBusy = signal(false);
  readonly pinSaved = signal(false);
  readonly pinError = signal<string | null>(null);

  readonly isSelf = computed(() => this.member()?.userId === this.authStore.user()?.id);

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

  readonly pinValid = computed(() => PIN_PATTERN.test(this.pin()));

  /** A new PIN replaces the current one, whichever store that one opens. */
  readonly pinReplaces = computed(() => !!this.member()?.hasKdsPin);

  readonly pinStoreName = computed(() => {
    const m = this.member();
    return m?.stores.find((s) => s.id === m.kdsPinStoreId)?.name ?? '';
  });

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
    const name = m.name || m.email || m.phone || '';
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

  onPinInput(event: Event): void {
    const field = event.target as HTMLInputElement;
    const digits = field.value.replace(/\D/g, '').slice(0, 6);
    field.value = digits;
    this.pin.set(digits);
    this.pinSaved.set(false);
  }

  setPin(event: Event): void {
    event.preventDefault();
    const m = this.member();
    const storeId = this.pinStoreId();
    if (!m || !storeId || !this.pinValid() || this.pinBusy()) return;
    this.startPin();
    this.staffApi.setKdsPin(storeId, m.userId, this.pin()).subscribe({
      next: () => {
        this.finishPin({ ...m, hasKdsPin: true, kdsPinStoreId: storeId });
        this.pin.set('');
      },
      error: (err) => this.failPin(err),
    });
  }

  clearPin(): void {
    const m = this.member();
    if (!m?.kdsPinStoreId || this.pinBusy()) return;
    const name = m.name || m.email || '';
    if (!window.confirm(this.translate.instant('admin.stores.kitchen.resetConfirm', { name }))) return;
    this.startPin();
    this.staffApi.clearKdsPin(m.kdsPinStoreId, m.userId).subscribe({
      next: () => this.finishPin({ ...m, hasKdsPin: false, kdsPinStoreId: null }),
      error: (err) => this.failPin(err),
    });
  }

  private load(userId: string, brandId: string | null): void {
    this.loading.set(true);
    this.error.set(null);
    this.catalog.listStores(brandId ?? undefined).subscribe({
      next: (list) => this.stores.set(list),
      error: (err) => this.error.set(staffErrorMessage(err, this.translate)),
    });
    this.staffApi.getMember(userId, brandId).subscribe({
      next: (m) => {
        this.member.set(m);
        this.role.set(m.role);
        this.selectedStores.set(m.stores.map((s) => s.id));
        this.pinStoreId.set(m.kdsPinStoreId ?? m.stores[0]?.id ?? '');
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
