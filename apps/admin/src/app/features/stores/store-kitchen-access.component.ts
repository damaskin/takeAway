import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { StaffService, type StaffRoster } from '../../core/staff/staff.service';
import { storeErrorMessage } from './store-errors';

const PIN_PATTERN = /^[0-9]{4,6}$/;

/**
 * Who can unlock this store's kitchen tablet, and with which PIN. The KDS
 * lockscreen asks for a 4–6 digit PIN scoped to one store; until now there
 * was no screen to set one, so staff could only sign in with email and
 * password on a shared tablet.
 */
@Component({
  selector: 'app-store-kitchen-access',
  standalone: true,
  imports: [TranslatePipe, RouterLink],
  template: `
    <div class="flex flex-col" style="gap: 12px">
      <p style="margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">
        {{ 'admin.stores.kitchen.hint' | translate }}
      </p>

      @if (loading()) {
        <p style="margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">
          {{ 'common.loading' | translate }}
        </p>
      } @else if (loadError()) {
        <div class="flex items-center flex-wrap" style="gap: 10px">
          <p role="alert" style="margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-berry)">
            {{ loadError() }}
          </p>
          <button
            type="button"
            (click)="load()"
            style="height: 30px; padding: 0 12px; background: var(--color-latte); color: var(--color-espresso); border: 0; border-radius: 8px; font-family: var(--font-sans); font-size: 12px; font-weight: 600; cursor: pointer"
          >
            {{ 'common.retry' | translate }}
          </button>
        </div>
      } @else if (people().length === 0) {
        <p style="margin: 0; font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary)">
          {{ 'admin.stores.kitchen.empty' | translate }}
          <a routerLink="/staff" style="color: var(--color-caramel)">{{
            'admin.stores.kitchen.toStaff' | translate
          }}</a>
        </p>
      } @else {
        <ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px">
          @for (person of people(); track person.userId) {
            <li
              class="flex flex-col"
              style="gap: 8px; padding: 10px 12px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 10px"
            >
              <div class="flex items-center flex-wrap" style="gap: 8px">
                <span
                  style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
                >
                  {{ person.name || person.email }}
                </span>
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">
                  {{ 'admin.staff.role.' + person.role | translate }}
                </span>
                <span
                  [style.background]="person.hasKdsPin ? '#7BC4A433' : 'var(--color-cream)'"
                  [style.color]="person.hasKdsPin ? '#3E8868' : 'var(--color-text-secondary)'"
                  style="padding: 2px 8px; border-radius: 999px; font-family: var(--font-sans); font-size: 11px; font-weight: 700"
                >
                  {{ (person.hasKdsPin ? 'admin.stores.kitchen.pinSet' : 'admin.stores.kitchen.pinUnset') | translate }}
                </span>
                @if (person.blocked) {
                  <span style="font-family: var(--font-sans); font-size: 11px; color: var(--color-berry)">{{
                    'admin.stores.kitchen.blocked' | translate
                  }}</span>
                }
              </div>
              <form (submit)="setPin(person, $event)" class="flex items-center flex-wrap" style="gap: 8px">
                <input
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  maxlength="6"
                  [value]="draft(person.userId)"
                  (input)="setDraft(person.userId, $event)"
                  [placeholder]="'admin.stores.kitchen.pinPlaceholder' | translate"
                  [attr.aria-label]="('admin.stores.kitchen.pin' | translate) + ': ' + (person.name || person.email)"
                  style="width: 120px; height: 32px; padding: 0 10px; background: var(--color-cream); border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-mono); font-size: 14px; letter-spacing: 0.2em; outline: none"
                />
                <button
                  type="submit"
                  [disabled]="busyId() === person.userId || !pinValid(person.userId)"
                  class="disabled:opacity-50"
                  style="height: 32px; padding: 0 12px; background: var(--color-caramel); color: white; border: 0; border-radius: 8px; font-family: var(--font-sans); font-size: 12px; font-weight: 600; cursor: pointer"
                >
                  {{
                    (person.hasKdsPin ? 'admin.stores.kitchen.changePin' : 'admin.stores.kitchen.setPin') | translate
                  }}
                </button>
                @if (person.hasKdsPin) {
                  <button
                    type="button"
                    (click)="clearPin(person)"
                    [disabled]="busyId() === person.userId"
                    style="height: 32px; padding: 0 10px; background: transparent; color: var(--color-berry); border: 0; font-family: var(--font-sans); font-size: 12px; font-weight: 600; cursor: pointer"
                  >
                    {{ 'admin.stores.kitchen.resetPin' | translate }}
                  </button>
                }
                @if (savedId() === person.userId) {
                  <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-mint)">{{
                    'admin.stores.kitchen.saved' | translate
                  }}</span>
                }
              </form>
              @if (draft(person.userId) && !pinValid(person.userId)) {
                <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
                  'admin.stores.errors.pinFormat' | translate
                }}</span>
              }
              @if (rowError()?.userId === person.userId) {
                <span role="alert" style="font-family: var(--font-sans); font-size: 12px; color: var(--color-berry)">{{
                  rowError()?.text
                }}</span>
              }
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class StoreKitchenAccessComponent implements OnInit {
  readonly storeId = input.required<string>();

  private readonly staff = inject(StaffService);
  private readonly translate = inject(TranslateService);

  private readonly roster = signal<StaffRoster[]>([]);
  private readonly drafts = signal<Record<string, string>>({});
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);
  readonly savedId = signal<string | null>(null);
  readonly rowError = signal<{ userId: string; text: string } | null>(null);

  /** Only the roles the KDS lets in: menu editors never work the pass. */
  readonly people = computed(() => this.roster().filter((p) => p.role === 'STAFF' || p.role === 'STORE_MANAGER'));

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.staff.list(this.storeId()).subscribe({
      next: (list) => {
        this.roster.set(list);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.loadError.set(storeErrorMessage(err, this.translate));
      },
    });
  }

  draft(userId: string): string {
    return this.drafts()[userId] ?? '';
  }

  setDraft(userId: string, event: Event): void {
    const digits = (event.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6);
    (event.target as HTMLInputElement).value = digits;
    this.drafts.update((d) => ({ ...d, [userId]: digits }));
  }

  pinValid(userId: string): boolean {
    return PIN_PATTERN.test(this.draft(userId));
  }

  setPin(person: StaffRoster, event: Event): void {
    event.preventDefault();
    const pin = this.draft(person.userId);
    if (!PIN_PATTERN.test(pin) || this.busyId()) return;
    this.start(person.userId);
    this.staff.setKdsPin(this.storeId(), person.userId, pin).subscribe({
      next: () => this.done(person.userId, true),
      error: (err) => this.fail(person.userId, err),
    });
  }

  clearPin(person: StaffRoster): void {
    if (this.busyId()) return;
    const name = person.name || person.email || '';
    if (!confirm(this.translate.instant('admin.stores.kitchen.resetConfirm', { name }))) return;
    this.start(person.userId);
    this.staff.clearKdsPin(this.storeId(), person.userId).subscribe({
      next: () => this.done(person.userId, false),
      error: (err) => this.fail(person.userId, err),
    });
  }

  private start(userId: string): void {
    this.busyId.set(userId);
    this.savedId.set(null);
    this.rowError.set(null);
  }

  private done(userId: string, hasKdsPin: boolean): void {
    this.busyId.set(null);
    this.savedId.set(userId);
    this.drafts.update((d) => ({ ...d, [userId]: '' }));
    this.roster.update((list) => list.map((p) => (p.userId === userId ? { ...p, hasKdsPin } : p)));
    setTimeout(() => this.savedId.update((id) => (id === userId ? null : id)), 2500);
  }

  private fail(userId: string, err: unknown): void {
    this.busyId.set(null);
    this.rowError.set({ userId, text: storeErrorMessage(err, this.translate) });
  }
}
