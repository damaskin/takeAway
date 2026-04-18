import { Component, inject } from '@angular/core';

import { AuthStore } from '../../core/auth/auth.store';

@Component({
  selector: 'app-profile',
  standalone: true,
  template: `
    @if (store.user(); as user) {
      <section class="max-w-md mx-auto px-4 py-12">
        <h1 class="text-4xl mb-8" style="font-family: var(--font-display)">Profile</h1>
        <dl
          class="p-6"
          style="background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft)"
        >
          <div class="flex justify-between py-2 border-b" style="border-color: var(--color-latte)">
            <dt style="opacity: 0.6">Name</dt>
            <dd>{{ user.name ?? '—' }}</dd>
          </div>
          <div class="flex justify-between py-2 border-b" style="border-color: var(--color-latte)">
            <dt style="opacity: 0.6">Phone</dt>
            <dd>{{ user.phone }}</dd>
          </div>
          <div class="flex justify-between py-2 border-b" style="border-color: var(--color-latte)">
            <dt style="opacity: 0.6">Role</dt>
            <dd>{{ user.role }}</dd>
          </div>
          <div class="flex justify-between py-2">
            <dt style="opacity: 0.6">Currency</dt>
            <dd>{{ user.currency }}</dd>
          </div>
        </dl>
        <p class="mt-6 text-sm text-center" style="opacity: 0.5">
          Orders history, loyalty and payment methods arrive with M2 and M3.
        </p>
      </section>
    }
  `,
})
export class ProfilePage {
  readonly store = inject(AuthStore);
}
