import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LanguageSwitcherComponent } from '@takeaway/i18n';
import type { KitchenDeviceStores } from '@takeaway/shared-types';

import { AuthService } from '../../core/auth/auth.service';
import { apiErrorBody, apiErrorCode } from '../../core/http/api-error';
import { KitchenDeviceService } from '../../core/kitchen/kitchen-device.service';
import { KITCHEN_STORE_KEY, KitchenModeService, read, write } from '../../core/kitchen/kitchen-mode.service';
import { appendPinDigit, canSubmitPin, pinSlots } from '../../core/kitchen/kitchen-pin';

/** What the screen shows: binding instructions, a link being redeemed, or the keypad. */
type DeviceState = 'loading' | 'unbound' | 'pairing' | 'bound';

/** Codes after which this tablet's token is no good and it must be bound again. */
const UNBOUND_CODES: ReadonlySet<string> = new Set(['KDS_DEVICE_REQUIRED', 'KDS_DEVICE_UNKNOWN']);

/**
 * Kitchen tablet lockscreen, moved in from the standalone kitchen app.
 *
 * The tablet sits on the pass, in reach of the queue, and shifts change.
 * Typing a work email and a long password there is slow and shows an admin
 * credential to customers — so staff unlock with a short PIN scoped to
 * this one store, on a large keypad rather than the tablet's own keyboard.
 *
 * The store picker used to list every store of every brand. A tablet is now
 * bound to one brand (KitchenDeviceService) and offers only that brand's
 * stores; an unbound tablet explains how to bind it. PINs are 4–6 digits
 * and the PIN is sent with «Войти» (or Enter) — the screen cannot know a
 * PIN's length, and auto-sending at four digits made 5–6 digit PINs
 * impossible and spent a lockout attempt on every keystroke.
 */
@Component({
  selector: 'app-pin-login',
  standalone: true,
  imports: [LanguageSwitcherComponent, TranslatePipe, RouterLink],
  template: `
    <main class="pin">
      <div class="flex items-center justify-between w-full" style="max-width: 420px">
        <h1 class="pin-title">{{ 'kds.login.title' | translate }}</h1>
        <app-language-switcher />
      </div>

      @switch (state()) {
        @case ('loading') {
          <p class="pin-note">{{ 'common.loading' | translate }}</p>
        }
        @case ('pairing') {
          <p class="pin-note" data-testid="pin-pairing">{{ 'kds.device.pairing' | translate }}</p>
        }
        @case ('unbound') {
          <section class="pin-card" data-testid="pin-unbound">
            <h2 class="pin-card-title">{{ 'kds.device.unboundTitle' | translate }}</h2>
            @if (notice(); as n) {
              <p class="pin-note" style="color: var(--color-berry)" role="alert">{{ n }}</p>
            }
            <p class="pin-note">{{ 'kds.device.unboundBody' | translate }}</p>
            <ol class="pin-steps">
              <li>{{ 'kds.device.stepSignIn' | translate }}</li>
              <li>{{ 'kds.device.stepLink' | translate }}</li>
            </ol>
            <a class="pin-submit" routerLink="/login" [queryParams]="{ next: '/kitchen' }">{{
              'kds.device.signInToBind' | translate
            }}</a>
          </section>
        }
        @case ('bound') {
          @if (brandName(); as brand) {
            <p class="pin-caption" data-testid="pin-brand">{{ brand }}</p>
          }
          @if (stores().length === 0) {
            <p class="pin-note" data-testid="pin-no-stores">{{ 'kds.device.noPins' | translate }}</p>
          } @else {
            @if (stores().length > 1) {
              <label class="flex flex-col w-full" style="max-width: 420px; gap: 6px">
                <span class="pin-caption">{{ 'kds.pin.store' | translate }}</span>
                <select class="pin-select" [value]="storeId() ?? ''" (change)="selectStore($any($event.target).value)">
                  <option value="" disabled>{{ 'kds.pin.selectStore' | translate }}</option>
                  @for (store of stores(); track store.id) {
                    <option [value]="store.id">{{ store.name }} · {{ store.city }}</option>
                  }
                </select>
              </label>
            } @else if (stores()[0]; as only) {
              <p class="pin-store">{{ only.name }} · {{ only.city }}</p>
            }

            <div class="flex" style="gap: 14px; min-height: 22px" aria-hidden="true">
              @for (slot of slots(); track $index) {
                <span class="pin-dot" [class.pin-dot-on]="slot.filled" [class.pin-dot-optional]="slot.optional"></span>
              }
            </div>
            <p class="pin-note">{{ 'kds.pin.rule' | translate }}</p>

            <div class="pin-pad" [class.pin-pad-off]="!storeId()">
              @for (key of keys; track key) {
                @if (key === '') {
                  <span></span>
                } @else if (key === 'del') {
                  <button
                    type="button"
                    class="pin-key pin-key-del"
                    (click)="backspace()"
                    [attr.aria-label]="'kds.pin.delete' | translate"
                  >
                    ⌫
                  </button>
                } @else {
                  <button type="button" class="pin-key" (click)="press(key)" [disabled]="loading()">{{ key }}</button>
                }
              }
            </div>

            <button
              type="button"
              class="pin-submit"
              data-testid="pin-submit"
              [disabled]="!canSubmit()"
              (click)="submit()"
            >
              {{ (loading() ? 'admin.login.signingIn' : 'kds.pin.signIn') | translate }}
            </button>
          }

          <div style="min-height: 24px">
            @if (error()) {
              <p class="pin-note" style="color: var(--color-berry)" role="alert">{{ error() }}</p>
            }
          </div>

          <button type="button" class="pin-link" data-testid="pin-unbind" (click)="unbind()">
            {{ 'kds.device.unbind' | translate }}
          </button>
        }
      }

      <a routerLink="/login" class="pin-note" style="text-decoration: underline">{{
        'kds.pin.usePassword' | translate
      }}</a>
    </main>
  `,
  styles: [
    `
      .pin {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 20px;
        padding: 24px;
        background: var(--color-cream);
        color: var(--color-text-primary);
        font-family: var(--font-sans);
      }
      .pin-title {
        font-family: var(--font-display);
        font-size: 24px;
        font-weight: 700;
        color: var(--color-espresso);
        margin: 0;
      }
      .pin-caption,
      .pin-note {
        font-size: 13px;
        color: var(--color-text-secondary);
        margin: 0;
        text-align: center;
        max-width: 420px;
      }
      .pin-store {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--color-espresso);
      }
      .pin-card {
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: 100%;
        max-width: 420px;
        padding: 20px;
        background: var(--color-foam);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-card);
      }
      .pin-card .pin-note {
        text-align: left;
      }
      .pin-card-title {
        margin: 0;
        font-family: var(--font-display);
        font-size: 18px;
        color: var(--color-espresso);
      }
      .pin-steps {
        margin: 0;
        padding-left: 20px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
        color: var(--color-text-primary);
      }
      .pin-select {
        padding: 12px 16px;
        background: var(--color-foam);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-input);
        font-size: 15px;
        color: var(--color-text-primary);
      }
      .pin-dot {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 2px solid var(--color-caramel);
      }
      .pin-dot-optional {
        border-style: dashed;
        opacity: 0.6;
      }
      .pin-dot-on {
        background: var(--color-caramel);
        border-style: solid;
        opacity: 1;
      }
      .pin-pad {
        display: grid;
        grid-template-columns: repeat(3, 88px);
        gap: 14px;
      }
      .pin-pad-off {
        opacity: 0.4;
        pointer-events: none;
      }
      .pin-key {
        height: 72px;
        border-radius: 18px;
        border: 1px solid var(--color-border);
        background: var(--color-foam);
        font-family: var(--font-display);
        font-size: 28px;
        font-weight: 600;
        color: var(--color-espresso);
      }
      .pin-key-del {
        background: transparent;
        font-family: var(--font-sans);
        font-size: 22px;
        color: var(--color-text-secondary);
      }
      .pin-submit {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 292px;
        max-width: 100%;
        height: 56px;
        border: 0;
        border-radius: 18px;
        background: var(--color-caramel);
        color: white;
        font-size: 18px;
        font-weight: 700;
        text-decoration: none;
        align-self: center;
      }
      .pin-submit:disabled {
        opacity: 0.4;
      }
      .pin-link {
        background: transparent;
        border: 0;
        font-size: 12px;
        color: var(--color-text-tertiary);
        text-decoration: underline;
        cursor: pointer;
      }
    `,
  ],
})
export class PinLoginPage {
  private readonly auth = inject(AuthService);
  private readonly device = inject(KitchenDeviceService);
  private readonly mode = inject(KitchenModeService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);

  readonly keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  readonly state = signal<DeviceState>('loading');
  readonly brandName = signal<string | null>(null);
  readonly stores = signal<KitchenDeviceStores['stores']>([]);
  readonly storeId = signal<string | null>(null);
  readonly pin = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Why the tablet is shown as unbound, when it was bound a moment ago. */
  readonly notice = signal<string | null>(null);

  /** Six slots filled left to right; the last two are optional. Shows progress, never the digits. */
  readonly slots = computed(() => pinSlots(this.pin()));
  readonly canSubmit = computed(() => !!this.storeId() && canSubmitPin(this.pin()) && !this.loading());

  constructor() {
    const code = this.route.snapshot.queryParamMap.get('pair');
    if (code) this.redeem(code);
    else this.load();
  }

  /** A hardware keyboard works too: digits, Backspace, Enter. */
  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    if (this.state() !== 'bound' || (event.target as HTMLElement | null)?.tagName === 'SELECT') return;
    if (/^[0-9]$/.test(event.key)) this.press(event.key);
    else if (event.key === 'Backspace') this.backspace();
    else if (event.key === 'Enter') this.submit();
    else return;
    event.preventDefault();
  }

  selectStore(id: string): void {
    this.storeId.set(id || null);
    this.pin.set('');
    this.error.set(null);
    if (id) write(KITCHEN_STORE_KEY, id);
  }

  press(digit: string): void {
    if (this.loading()) return;
    this.error.set(null);
    this.pin.set(appendPinDigit(this.pin(), digit));
  }

  backspace(): void {
    if (this.loading()) return;
    this.error.set(null);
    this.pin.set(this.pin().slice(0, -1));
  }

  submit(): void {
    const storeId = this.storeId();
    const token = this.device.token();
    if (!this.canSubmit() || !storeId || !token) return;
    this.loading.set(true);
    this.auth.loginWithPin(storeId, this.pin(), token).subscribe({
      next: () => {
        this.loading.set(false);
        this.mode.enter();
        void this.router.navigate(['/kitchen'], { queryParams: { store: storeId } });
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.pin.set('');
        if (UNBOUND_CODES.has(apiErrorCode(err) ?? '')) {
          this.becomeUnbound(this.translate.instant('kds.device.unboundNow'));
          return;
        }
        this.error.set(this.pinErrorMessage(err));
      },
    });
  }

  /** "Not our business": forget the binding, e.g. a tablet moved to another café. */
  unbind(): void {
    if (!window.confirm(this.translate.instant('kds.device.unbindConfirm'))) return;
    this.becomeUnbound(null);
  }

  private load(): void {
    if (!this.device.token()) {
      this.state.set('unbound');
      return;
    }
    this.state.set('loading');
    this.device.stores().subscribe({
      next: (bound) => {
        this.brandName.set(bound.brandName);
        this.stores.set(bound.stores);
        const remembered = read(KITCHEN_STORE_KEY);
        const pick =
          bound.stores.find((s) => s.id === remembered) ?? (bound.stores.length === 1 ? bound.stores[0] : null);
        this.storeId.set(pick?.id ?? null);
        this.state.set('bound');
      },
      error: (err: unknown) => {
        if (UNBOUND_CODES.has(apiErrorCode(err) ?? '')) {
          this.becomeUnbound(this.translate.instant('kds.device.unboundNow'));
          return;
        }
        this.state.set('bound');
        this.error.set(this.translate.instant('kds.pin.storesUnavailable'));
      },
    });
  }

  private redeem(code: string): void {
    this.state.set('pairing');
    this.device.pair(code).subscribe({
      next: () => {
        // The code is spent; keep it out of the address bar and history.
        void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
        this.load();
      },
      error: () => {
        void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
        if (this.device.token()) {
          this.load();
          this.error.set(this.translate.instant('kds.device.linkInvalid'));
        } else {
          this.becomeUnbound(this.translate.instant('kds.device.linkInvalid'));
        }
      },
    });
  }

  private becomeUnbound(notice: string | null): void {
    this.device.forget();
    this.stores.set([]);
    this.storeId.set(null);
    this.brandName.set(null);
    this.notice.set(notice);
    this.state.set('unbound');
  }

  private pinErrorMessage(err: unknown): string {
    const code = apiErrorCode(err);
    // The server has no KDS_PIN_SECRET: no PIN can work, so don't say "wrong PIN".
    if (code === 'KDS_PIN_NOT_CONFIGURED') return this.translate.instant('kds.pin.notConfigured');
    const status = (err as { status?: number } | null)?.status;
    if (code === 'KDS_PIN_LOCKED') {
      const seconds = Number(apiErrorBody(err)?.['retryAfterSeconds']);
      if (Number.isFinite(seconds) && seconds > 0) {
        return this.translate.instant('kds.pin.lockedFor', { minutes: Math.max(1, Math.ceil(seconds / 60)) });
      }
      return this.translate.instant('kds.pin.locked');
    }
    // The per-IP throttle.
    if (status === 429) return this.translate.instant('kds.pin.locked');
    if (status === 401) return this.translate.instant('kds.pin.wrong');
    return this.translate.instant('common.genericError');
  }
}
