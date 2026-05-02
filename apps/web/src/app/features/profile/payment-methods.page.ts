import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-profile-payment-methods',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <section style="min-height: calc(100vh - 72px); background: var(--color-cream); padding: 32px 16px">
      <div style="max-width: 540px; margin: 0 auto">
        <a
          routerLink="/profile"
          style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); text-decoration: none"
          >← {{ 'common.back' | translate }}</a
        >
        <h1 style="font-family: var(--font-display); font-size: 28px; color: var(--color-espresso); margin: 12px 0 8px">
          {{ 'web.profile.payment.title' | translate }}
        </h1>
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0 0 24px">
          {{ 'web.profile.payment.subtitle' | translate }}
        </p>

        <div
          style="background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft); padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center"
        >
          <span style="font-size: 36px">💳</span>
          <span
            style="display: inline-block; padding: 4px 12px; border-radius: 999px; background: var(--color-caramel-light); color: var(--color-caramel); font-family: var(--font-sans); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px"
            >{{ 'web.profile.payment.comingSoon' | translate }}</span
          >
        </div>
      </div>
    </section>
  `,
})
export class PaymentMethodsPage {}
