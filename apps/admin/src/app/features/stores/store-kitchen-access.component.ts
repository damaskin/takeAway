import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { StaffService, type StaffRoster } from '../../core/staff/staff.service';
import { KitchenTabletsComponent } from '../staff/kitchen-tablets.component';
import { storeErrorMessage } from './store-errors';

/**
 * «Доступ на кухню» in the store editor: who can open this store's kitchen
 * tablet — kitchen staff and managers of the store with a PIN — each with a
 * link to their card, where the PIN is set. A PIN is the person's one PIN
 * for every store they work at in the brand, so it is not set per store any
 * more. Below, the brand's kitchen tablets and the one-time link to bind
 * one more — the same block as on the Staff page, where owners did not
 * think to look for it.
 */
@Component({
  selector: 'app-store-kitchen-access',
  standalone: true,
  imports: [TranslatePipe, RouterLink, KitchenTabletsComponent],
  template: `
    <div class="flex flex-col" style="gap: 12px">
      <p class="access-note">{{ 'admin.stores.kitchen.hint' | translate }}</p>
      <p class="access-note">
        {{ 'admin.stores.kitchen.where' | translate }}
        <a routerLink="/login/pin" style="color: var(--color-caramel); font-family: var(--font-mono)">{{ pinUrl }}</a>
      </p>

      @if (loading()) {
        <p class="access-note">{{ 'common.loading' | translate }}</p>
      } @else if (loadError()) {
        <div class="flex items-center flex-wrap" style="gap: 10px">
          <p role="alert" class="access-note" style="color: var(--color-berry)">{{ loadError() }}</p>
          <button type="button" class="access-retry" (click)="load()">{{ 'common.retry' | translate }}</button>
        </div>
      } @else if (people().length === 0) {
        <p class="access-note">
          {{ 'admin.stores.kitchen.empty' | translate }}
          <a routerLink="/staff" style="color: var(--color-caramel)">{{
            'admin.stores.kitchen.toStaff' | translate
          }}</a>
        </p>
      } @else {
        <h3 class="access-title">{{ 'admin.stores.kitchen.canEnter' | translate: { count: withPin().length } }}</h3>
        <ul class="access-list" data-testid="kitchen-access-list">
          @for (person of people(); track person.userId) {
            <li class="access-row">
              <a class="access-name" [routerLink]="['/staff', person.userId]">
                {{ person.name || person.email || person.login }}
              </a>
              <span class="access-role">{{ 'admin.staff.role.' + person.role | translate }}</span>
              <span class="access-chip" [class.access-chip-on]="person.hasKdsPin">
                {{ (person.hasKdsPin ? 'admin.stores.kitchen.pinSet' : 'admin.stores.kitchen.pinUnset') | translate }}
              </span>
              @if (person.blocked) {
                <span class="access-role" style="color: var(--color-berry)">{{
                  'admin.stores.kitchen.blocked' | translate
                }}</span>
              }
            </li>
          }
        </ul>
        @if (withPin().length < people().length) {
          <p class="access-note">{{ 'admin.stores.kitchen.setOnCard' | translate }}</p>
        }
      }

      @if (brandId(); as brand) {
        <app-kitchen-tablets [brandId]="brand" />
      }
    </div>
  `,
  styles: [
    `
      .access-note {
        margin: 0;
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--color-text-secondary);
      }
      .access-title {
        margin: 4px 0 0;
        font-family: var(--font-sans);
        font-size: 14px;
        font-weight: 700;
        color: var(--color-espresso);
      }
      .access-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .access-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: 10px;
        font-family: var(--font-sans);
      }
      .access-name {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
        text-decoration: underline;
        text-underline-offset: 3px;
      }
      .access-role {
        font-size: 12px;
        color: var(--color-text-tertiary);
      }
      .access-chip {
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--color-cream);
        color: var(--color-text-secondary);
        font-size: 11px;
        font-weight: 700;
      }
      .access-chip-on {
        background: #7bc4a433;
        color: #3e8868;
      }
      .access-retry {
        height: 30px;
        padding: 0 12px;
        background: var(--color-latte);
        color: var(--color-espresso);
        border: 0;
        border-radius: 8px;
        font-family: var(--font-sans);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
    `,
  ],
})
export class StoreKitchenAccessComponent {
  readonly storeId = input.required<string>();
  /** The store's brand, whose kitchen tablets are listed here. */
  readonly brandId = input<string | null>(null);

  private readonly staff = inject(StaffService);
  private readonly translate = inject(TranslateService);

  private readonly roster = signal<StaffRoster[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  /** Only the roles the kitchen tablet lets in: menu editors never work the pass. */
  readonly people = computed(() => this.roster().filter((p) => p.role === 'STAFF' || p.role === 'STORE_MANAGER'));
  /** Who opens this store's tablet right now. */
  readonly withPin = computed(() => this.people().filter((p) => p.hasKdsPin && !p.blocked));

  /** Where the tablet signs in, spelled out so it can be typed on the tablet. */
  readonly pinUrl = `${location.host}/login/pin`;

  constructor() {
    effect(() => {
      this.storeId();
      untracked(() => this.load());
    });
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
}
