import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LanguageSwitcherComponent } from '@takeaway/i18n';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../core/auth/auth.service';
import { StoresApi, type StoreSummary } from '../../core/stores/stores.service';

const PIN_MAX = 6;
const PIN_MIN = 4;
/** Which store this tablet belongs to — chosen once, then remembered. */
const STORE_KEY = 'takeaway.kds.storeId';

/**
 * Kitchen tablet lockscreen.
 *
 * The tablet sits on the pass, in reach of the queue, and shifts change.
 * Typing a work email and an eight-character password there is both slow
 * and a way to leak an admin credential in front of customers — so staff
 * unlock with a short PIN scoped to this one store, and the email form
 * stays behind a link for managers.
 *
 * Built for the actual device: a large on-screen keypad rather than a text
 * input, because the tablet's own keyboard would cover half the screen and
 * a barista is often wearing one glove.
 */
@Component({
  selector: 'app-kds-pin',
  standalone: true,
  imports: [LanguageSwitcherComponent, TranslatePipe, RouterLink],
  template: `
    <main
      class="min-h-screen flex flex-col items-center justify-center"
      style="background: var(--color-cream); color: var(--color-text-primary); padding: 24px; gap: 24px"
    >
      <div class="flex items-center justify-between w-full" style="max-width: 420px">
        <h1
          class="text-2xl"
          style="font-family: var(--font-display); color: var(--color-espresso); font-weight: 700; margin: 0"
        >
          {{ 'kds.login.title' | translate }}
        </h1>
        <app-language-switcher />
      </div>

      <!-- Store picker: chosen once per tablet, then remembered. -->
      <div class="flex flex-col w-full" style="max-width: 420px; gap: 6px">
        <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">{{
          'kds.pin.store' | translate
        }}</span>
        <select
          [value]="storeId() ?? ''"
          (change)="selectStore($event)"
          class="px-4 py-3 outline-none"
          style="background: var(--color-foam); color: var(--color-text-primary); border: 1px solid var(--color-border); border-radius: var(--radius-input); font-family: var(--font-sans); font-size: 15px"
        >
          <option value="" disabled>{{ 'kds.pin.selectStore' | translate }}</option>
          @for (store of stores(); track store.id) {
            <option [value]="store.id">{{ store.name }} · {{ store.city }}</option>
          }
        </select>
      </div>

      <!-- PIN dots -->
      <div class="flex" style="gap: 14px; min-height: 22px">
        @for (slot of dots(); track $index) {
          <span
            style="width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--color-caramel)"
            [style.background]="slot ? 'var(--color-caramel)' : 'transparent'"
          ></span>
        }
      </div>

      <!-- Keypad -->
      <div
        class="grid"
        style="grid-template-columns: repeat(3, 88px); gap: 14px"
        [style.opacity]="storeId() ? '1' : '0.4'"
        [style.pointerEvents]="storeId() ? 'auto' : 'none'"
      >
        @for (key of keys; track key) {
          @if (key === '') {
            <span></span>
          } @else if (key === 'del') {
            <button
              type="button"
              (click)="backspace()"
              [attr.aria-label]="'kds.pin.delete' | translate"
              style="height: 72px; border-radius: 18px; border: 1px solid var(--color-border); background: transparent; font-family: var(--font-sans); font-size: 22px; color: var(--color-text-secondary)"
            >
              ⌫
            </button>
          } @else {
            <button
              type="button"
              (click)="press(key)"
              [disabled]="loading()"
              style="height: 72px; border-radius: 18px; border: 1px solid var(--color-border); background: var(--color-foam); font-family: var(--font-display); font-size: 28px; font-weight: 600; color: var(--color-espresso)"
            >
              {{ key }}
            </button>
          }
        }
      </div>

      <div style="min-height: 24px">
        @if (loading()) {
          <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
            {{ 'admin.login.signingIn' | translate }}
          </p>
        } @else if (error()) {
          <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-berry); margin: 0">
            {{ error() }}
          </p>
        }
      </div>

      <a
        routerLink="/login/password"
        style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); text-decoration: underline"
        >{{ 'kds.pin.usePassword' | translate }}</a
      >
    </main>
  `,
})
export class KdsPinPage {
  private readonly auth = inject(AuthService);
  private readonly storesApi = inject(StoresApi);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  readonly stores = signal<StoreSummary[]>([]);
  readonly storeId = signal<string | null>(readStoredStore());
  readonly pin = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Six slots, filled left to right — shows progress without showing digits. */
  readonly dots = computed(() => {
    const length = this.pin().length;
    return Array.from({ length: PIN_MAX }, (_, i) => i < length);
  });

  constructor() {
    this.storesApi.list().subscribe({
      next: (list) => this.stores.set(list),
      error: () => this.error.set(this.translate.instant('kds.pin.storesUnavailable')),
    });
  }

  selectStore(event: Event): void {
    const id = (event.target as HTMLSelectElement).value || null;
    this.storeId.set(id);
    this.pin.set('');
    this.error.set(null);
    if (id) {
      try {
        localStorage.setItem(STORE_KEY, id);
      } catch {
        // Private mode or blocked storage — the picker just asks again.
      }
    }
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
        void this.router.navigate(['/']);
      },
      error: (err) => {
        this.loading.set(false);
        this.pin.set('');
        this.error.set(extractMessage(err, this.translate.instant('kds.pin.wrong')));
      },
    });
  }
}

function readStoredStore(): string | null {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

function extractMessage(err: unknown, fallback: string): string {
  const maybe = err as { status?: number; error?: { message?: unknown } };
  // 401 is "wrong PIN" — say that, not whatever the server phrased it as.
  if (maybe.status === 401) return fallback;
  if (typeof maybe.error?.message === 'string') return maybe.error.message;
  return fallback;
}
