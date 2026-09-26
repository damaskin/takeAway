import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LanguageSwitcherComponent } from '@takeaway/i18n';

import { AuthService } from '../../core/auth/auth.service';
import { KITCHEN_STORE_KEY, KitchenModeService, read, write } from '../../core/kitchen/kitchen-mode.service';
import { KitchenApi } from '../../core/kitchen/kitchen.api';

const PIN_MAX = 6;
const PIN_MIN = 4;

/**
 * Kitchen tablet lockscreen, moved in from the standalone kitchen app.
 *
 * The tablet sits on the pass, in reach of the queue, and shifts change.
 * Typing a work email and a long password there is slow and shows an admin
 * credential to customers — so staff unlock with a short PIN scoped to
 * this one store, on a large keypad rather than the tablet's own keyboard.
 * A PIN sign-in opens the board in tablet mode.
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

      <label class="flex flex-col w-full" style="max-width: 420px; gap: 6px">
        <span class="pin-caption">{{ 'kds.pin.store' | translate }}</span>
        <select class="pin-select" [value]="storeId() ?? ''" (change)="selectStore($any($event.target).value)">
          <option value="" disabled>{{ 'kds.pin.selectStore' | translate }}</option>
          @for (store of stores(); track store.id) {
            <option [value]="store.id">{{ store.name }} · {{ store.city }}</option>
          }
        </select>
      </label>

      <div class="flex" style="gap: 14px; min-height: 22px" aria-hidden="true">
        @for (filled of dots(); track $index) {
          <span class="pin-dot" [class.pin-dot-on]="filled"></span>
        }
      </div>

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

      <div style="min-height: 24px">
        @if (loading()) {
          <p class="pin-note">{{ 'admin.login.signingIn' | translate }}</p>
        } @else if (error()) {
          <p class="pin-note" style="color: var(--color-berry)" role="alert">{{ error() }}</p>
        }
      </div>

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
        gap: 24px;
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
      .pin-dot-on {
        background: var(--color-caramel);
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
    `,
  ],
})
export class PinLoginPage {
  private readonly auth = inject(AuthService);
  private readonly kitchen = inject(KitchenApi);
  private readonly mode = inject(KitchenModeService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  readonly stores = signal<Array<{ id: string; name: string; city: string }>>([]);
  readonly storeId = signal<string | null>(read(KITCHEN_STORE_KEY));
  readonly pin = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Six slots, filled left to right — shows progress without showing digits. */
  readonly dots = computed(() => Array.from({ length: PIN_MAX }, (_, i) => i < this.pin().length));

  constructor() {
    this.kitchen.publicStores().subscribe({
      next: (list) => this.stores.set(list),
      error: () => this.error.set(this.translate.instant('kds.pin.storesUnavailable')),
    });
  }

  selectStore(id: string): void {
    this.storeId.set(id || null);
    this.pin.set('');
    this.error.set(null);
    if (id) write(KITCHEN_STORE_KEY, id);
  }

  press(digit: string): void {
    if (this.loading() || this.pin().length >= PIN_MAX) return;
    this.error.set(null);
    const next = this.pin() + digit;
    this.pin.set(next);
    // Submit on the shortest valid length. A longer PIN still works: the
    // attempt fails, and the next digit re-submits.
    if (next.length >= PIN_MIN) this.submit();
  }

  backspace(): void {
    if (this.loading()) return;
    this.error.set(null);
    this.pin.set(this.pin().slice(0, -1));
  }

  private submit(): void {
    const storeId = this.storeId();
    if (!storeId) return;
    this.loading.set(true);
    this.auth.loginWithPin(storeId, this.pin()).subscribe({
      next: () => {
        this.loading.set(false);
        this.mode.enter();
        void this.router.navigate(['/kitchen'], { queryParams: { store: storeId } });
      },
      error: (err: { status?: number; error?: { message?: unknown } }) => {
        this.loading.set(false);
        this.pin.set('');
        // 401 is "wrong PIN" — say that, not however the server phrased it.
        const message = err.status !== 401 && typeof err.error?.message === 'string' ? err.error.message : null;
        this.error.set(message ?? this.translate.instant('kds.pin.wrong'));
      },
    });
  }
}
