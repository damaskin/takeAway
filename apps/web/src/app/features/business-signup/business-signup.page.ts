import { Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { resolveAdminAppUrl } from '../../core/config/admin-url';

/**
 * "List your business" — the storefront's door into the admin panel.
 *
 * Registration itself happens in the admin app (/signup): it signs the new
 * owner straight into the panel, where the launch checklist takes over. The
 * storefront used to carry its own copy of the form, which stored the brand
 * owner's session in the customer login of this site and then sent them to
 * the admin to sign in all over again.
 */
@Component({
  selector: 'app-business-signup',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <section
      class="flex flex-col"
      style="min-height: calc(100vh - 72px); background: var(--color-cream); padding: 48px clamp(16px, 5vw, 24px)"
    >
      <div class="w-full" style="max-width: 540px; margin: 0 auto">
        <h1 style="font-family: var(--font-display); font-size: 32px; color: var(--color-espresso); margin: 0 0 8px">
          {{ 'web.business.title' | translate }}
        </h1>
        <p style="font-family: var(--font-sans); font-size: 15px; color: var(--color-text-secondary); margin: 0 0 24px">
          {{ 'web.business.subtitle' | translate }}
        </p>

        <div
          class="flex flex-col"
          style="gap: 16px; background: var(--color-foam); border-radius: var(--radius-card); padding: 24px; box-shadow: var(--shadow-soft)"
        >
          <h2
            style="font-family: var(--font-sans); font-size: 15px; font-weight: 600; color: var(--color-espresso); margin: 0"
          >
            {{ 'web.business.stepsTitle' | translate }}
          </h2>
          <ol class="flex flex-col" style="gap: 12px; margin: 0; padding: 0; list-style: none">
            @for (step of steps; track step; let i = $index) {
              <li class="flex items-start" style="gap: 12px">
                <span
                  class="flex items-center justify-center"
                  style="flex: 0 0 auto; width: 28px; height: 28px; border-radius: 9999px; background: var(--color-caramel-light); color: var(--color-caramel); font-family: var(--font-sans); font-size: 13px; font-weight: 700"
                  >{{ i + 1 }}</span
                >
                <span
                  style="font-family: var(--font-sans); font-size: 14px; line-height: 28px; color: var(--color-text-primary)"
                  >{{ step | translate }}</span
                >
              </li>
            }
          </ol>

          <a
            [href]="adminUrl + '/signup'"
            class="flex items-center justify-center"
            style="height: 52px; background: var(--color-caramel); color: white; border-radius: var(--radius-pill); font-family: var(--font-sans); font-size: 16px; font-weight: 600; text-decoration: none"
          >
            {{ 'web.business.cta' | translate }}
          </a>

          <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-text-secondary); margin: 0">
            {{ 'web.business.haveAccount' | translate }}
            <a [href]="adminUrl + '/login'" style="color: var(--color-caramel); font-weight: 600; margin-left: 4px">
              {{ 'web.business.signIn' | translate }}
            </a>
          </p>
        </div>
      </div>
    </section>
  `,
})
export class BusinessSignupPage {
  readonly adminUrl = resolveAdminAppUrl();
  readonly steps = ['web.business.step1', 'web.business.step2', 'web.business.step3'] as const;
}
