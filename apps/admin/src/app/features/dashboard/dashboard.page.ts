import { Component, inject } from '@angular/core';

import { AuthStore } from '../../core/auth/auth.store';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  template: `
    <h1 class="text-3xl mb-2" style="font-family: var(--font-display)">
      Welcome back{{ name() ? ', ' + name() : '' }}.
    </h1>
    <p class="mb-8" style="opacity: 0.6">
      You're signed in as <strong>{{ role() }}</strong
      >. Pick a section on the left to get started.
    </p>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl">
      @for (card of cards; track card.title) {
        <article
          class="p-6"
          style="background: var(--color-cream); border-radius: var(--radius-card); box-shadow: var(--shadow-soft)"
        >
          <h2 class="text-lg mb-1" style="font-family: var(--font-display)">{{ card.title }}</h2>
          <p class="text-sm" style="opacity: 0.6">{{ card.body }}</p>
        </article>
      }
    </div>
  `,
})
export class DashboardPage {
  private readonly store = inject(AuthStore);

  readonly cards = [
    { title: 'Menu', body: 'Add categories and products, toggle visibility, keep the menu fresh.' },
    { title: 'Stores', body: 'Manage store details, working hours, and stop-lists.' },
    { title: 'Analytics', body: 'Revenue, pickup performance, ETA accuracy — arriving with M5.' },
  ];

  name(): string {
    return this.store.user()?.name ?? '';
  }

  role(): string {
    return this.store.user()?.role ?? '';
  }
}
