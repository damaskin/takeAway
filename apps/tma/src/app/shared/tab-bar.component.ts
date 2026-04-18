import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/**
 * TMA bottom tab bar — pencil tmaTabBar (kaqJQ/vtZXk/05LjB/Do3R7).
 *
 * 56px foam bar with 4 tabs (Home · Stores · Orders · Profile).
 * Active tab uses caramel icon + label, inactive uses text-tertiary.
 */
@Component({
  selector: 'app-tma-tab-bar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
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
        <span style="font-family: var(--font-sans); font-size: 10px; font-weight: 600">Home</span>
      </a>
      <a
        routerLink="/stores"
        routerLinkActive="tma-tab-active"
        class="flex flex-col items-center justify-center tma-tab"
        style="gap: 2px"
      >
        <span style="font-size: 18px">📍</span>
        <span style="font-family: var(--font-sans); font-size: 10px; font-weight: 600">Stores</span>
      </a>
      <a
        routerLink="/orders"
        routerLinkActive="tma-tab-active"
        class="flex flex-col items-center justify-center tma-tab"
        style="gap: 2px"
      >
        <span style="font-size: 18px">🧾</span>
        <span style="font-family: var(--font-sans); font-size: 10px; font-weight: 600">Orders</span>
      </a>
      <a
        routerLink="/profile"
        routerLinkActive="tma-tab-active"
        class="flex flex-col items-center justify-center tma-tab"
        style="gap: 2px"
      >
        <span style="font-size: 18px">👤</span>
        <span style="font-family: var(--font-sans); font-size: 10px; font-weight: 600">Profile</span>
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
