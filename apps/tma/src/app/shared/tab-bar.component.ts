import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * TMA bottom tab bar — pencil tmaTabBar (kaqJQ/vtZXk/05LjB/Do3R7).
 *
 * 56px foam bar with 4 tabs ({{ 'nav.home' | translate }} · {{ 'nav.stores' | translate }} · {{ 'nav.orders' | translate }} · {{ 'nav.profile' | translate }}).
 * Active tab uses caramel icon + label, inactive uses text-tertiary.
 */
@Component({
  selector: 'app-tma-tab-bar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, TranslatePipe],
  template: `
    <nav
      class="fixed left-0 right-0 bottom-0 flex items-center justify-around"
      style="height: 56px; padding: 8px 24px; background: var(--color-foam); border-top: 1px solid var(--color-border-light); z-index: 20"
    >
      <a
        routerLink="/"
        routerLinkActive="tma-tab-active"
        [routerLinkActiveOptions]="{ exact: true }"
        class="flex flex-col items-center justify-center tma-tab"
        style="gap: 2px"
      >
        <span style="font-size: 18px">🏠</span>
        <span style="font-family: var(--font-sans); font-size: 10px; font-weight: 600">{{
          'nav.home' | translate
        }}</span>
      </a>
      <a
        routerLink="/stores"
        routerLinkActive="tma-tab-active"
        class="flex flex-col items-center justify-center tma-tab"
        style="gap: 2px"
      >
        <span style="font-size: 18px">📍</span>
        <span style="font-family: var(--font-sans); font-size: 10px; font-weight: 600">{{
          'nav.stores' | translate
        }}</span>
      </a>
      <a
        routerLink="/orders"
        routerLinkActive="tma-tab-active"
        class="flex flex-col items-center justify-center tma-tab"
        style="gap: 2px"
      >
        <span style="font-size: 18px">🧾</span>
        <span style="font-family: var(--font-sans); font-size: 10px; font-weight: 600">{{
          'nav.orders' | translate
        }}</span>
      </a>
      <a
        routerLink="/profile"
        routerLinkActive="tma-tab-active"
        class="flex flex-col items-center justify-center tma-tab"
        style="gap: 2px"
      >
        <span style="font-size: 18px">👤</span>
        <span style="font-family: var(--font-sans); font-size: 10px; font-weight: 600">{{
          'nav.profile' | translate
        }}</span>
      </a>
    </nav>
  `,
  styles: [
    `
      .tma-tab {
        color: var(--color-text-tertiary);
      }
      .tma-tab-active {
        color: var(--color-caramel);
      }
    `,
  ],
})
export class TmaTabBarComponent {}
