import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import {
  type BoundCard,
  type CardInstitute,
  PaymentCardsApi,
  PaymentCardsStore,
} from '../../core/payments/payment-cards.service';

type Step = 'list' | 'form' | 'code';

/**
 * Card management on the desktop web, matching the mini app's flow.
 *
 * The customer never types a full card number: the bank already has the card,
 * so binding takes the last four digits and the phone on file, and the
 * one-time password the bank sends by SMS turns that into a stored token.
 */
@Component({
  selector: 'app-profile-payment-methods',
  standalone: true,
  imports: [RouterLink, FormsModule, TranslatePipe],
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
          {{ (enabled() ? 'web.profile.payment.subtitle' : 'web.profile.payment.unavailable') | translate }}
        </p>

        @if (enabled()) {
          @if (step() === 'list') {
            @if (loading()) {
              <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-tertiary)">
                {{ 'web.profile.payment.loading' | translate }}
              </p>
            } @else if (cards().length === 0) {
              <div
                style="background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft); padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center"
              >
                <span style="font-size: 36px">💳</span>
                <p
                  style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0"
                >
                  {{ 'web.profile.payment.empty' | translate }}
                </p>
              </div>
            } @else {
              <div
                style="background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft); overflow: hidden"
              >
                @for (card of cards(); track card.id; let last = $last) {
                  <div
                    class="flex items-center"
                    [style.borderBottom]="last ? 'none' : '1px solid var(--color-border-light)'"
                    style="padding: 14px 18px; gap: 12px"
                  >
                    <span style="font-size: 22px">💳</span>
                    <button type="button" class="flex-1 text-left" (click)="makeDefault(card)" style="min-width: 0">
                      <span
                        class="block"
                        style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-espresso)"
                        >{{ cardTitle(card) }}</span
                      >
                      <span
                        class="block"
                        style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)"
                        >{{ cardSubtitle(card) }}</span
                      >
                    </button>
                    @if (card.isDefault) {
                      <span
                        class="flex items-center"
                        style="height: 22px; padding: 0 10px; background: var(--color-caramel); color: var(--color-foam); border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 700"
                        >{{ 'web.profile.payment.default' | translate }}</span
                      >
                    }
                    <button
                      type="button"
                      (click)="remove(card)"
                      [disabled]="busy()"
                      style="color: var(--color-berry); font-family: var(--font-sans); font-size: 13px; font-weight: 600"
                    >
                      {{ 'web.profile.payment.remove' | translate }}
                    </button>
                  </div>
                }
              </div>
            }

            <button
              type="button"
              (click)="openForm()"
              class="flex items-center justify-center w-full"
              style="height: 48px; margin-top: 16px; background: var(--color-caramel); color: var(--color-foam); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600"
            >
              {{ 'web.profile.payment.add' | translate }}
            </button>
          } @else if (step() === 'form') {
            <div
              class="flex flex-col"
              style="background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft); padding: 20px; gap: 14px"
            >
              <label class="flex flex-col" style="gap: 6px">
                <span style="font-family: var(--font-sans); font-size: 13px; font-weight: 600">{{
                  'web.profile.payment.issuer' | translate
                }}</span>
                <select
                  [ngModel]="institute()"
                  (ngModelChange)="institute.set($event)"
                  name="institute"
                  style="height: 48px; background: var(--color-cream); border: 1px solid var(--color-border-light); border-radius: var(--radius-input); padding: 0 12px; font-family: var(--font-sans); font-size: 14px"
                >
                  @for (bank of institutes(); track bank.code) {
                    <option [value]="bank.code">{{ bank.name }}</option>
                  }
                </select>
              </label>

              <label class="flex flex-col" style="gap: 6px">
                <span style="font-family: var(--font-sans); font-size: 13px; font-weight: 600">{{
                  'web.profile.payment.lastDigits' | translate
                }}</span>
                <input
                  [ngModel]="lastDigits()"
                  (ngModelChange)="lastDigits.set($event)"
                  name="lastDigits"
                  inputmode="numeric"
                  maxlength="4"
                  placeholder="0578"
                  style="height: 48px; background: var(--color-cream); border: 1px solid var(--color-border-light); border-radius: var(--radius-input); padding: 0 12px; font-family: var(--font-sans); font-size: 14px"
                />
              </label>

              <label class="flex flex-col" style="gap: 6px">
                <span style="font-family: var(--font-sans); font-size: 13px; font-weight: 600">{{
                  'web.profile.payment.phone' | translate
                }}</span>
                <input
                  [ngModel]="phone()"
                  (ngModelChange)="phone.set($event)"
                  name="phone"
                  inputmode="numeric"
                  maxlength="12"
                  placeholder="77712345"
                  style="height: 48px; background: var(--color-cream); border: 1px solid var(--color-border-light); border-radius: var(--radius-input); padding: 0 12px; font-family: var(--font-sans); font-size: 14px"
                />
              </label>

              <p style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); margin: 0">
                {{ 'web.profile.payment.privacyHint' | translate }}
              </p>

              <button
                type="button"
                (click)="submitForm()"
                [disabled]="busy() || !formValid()"
                [style.opacity]="busy() || !formValid() ? '0.5' : '1'"
                class="flex items-center justify-center"
                style="height: 48px; background: var(--color-caramel); color: var(--color-foam); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600"
              >
                {{ 'web.profile.payment.sendCode' | translate }}
              </button>
              <button
                type="button"
                (click)="step.set('list')"
                style="height: 44px; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)"
              >
                {{ 'common.cancel' | translate }}
              </button>
            </div>
          } @else {
            <div
              class="flex flex-col"
              style="background: var(--color-foam); border-radius: var(--radius-card); box-shadow: var(--shadow-soft); padding: 20px; gap: 14px"
            >
              <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
                {{ 'web.profile.payment.codeSent' | translate: { phone: phone() } }}
              </p>
              <input
                [ngModel]="code()"
                (ngModelChange)="code.set($event)"
                name="code"
                inputmode="numeric"
                maxlength="8"
                placeholder="047805"
                style="height: 52px; background: var(--color-cream); border: 1px solid var(--color-border-light); border-radius: var(--radius-input); padding: 0 14px; font-family: var(--font-sans); font-size: 20px; letter-spacing: 4px; text-align: center"
              />
              <button
                type="button"
                (click)="submitCode()"
                [disabled]="busy() || code().trim().length < 4"
                [style.opacity]="busy() || code().trim().length < 4 ? '0.5' : '1'"
                class="flex items-center justify-center"
                style="height: 48px; background: var(--color-caramel); color: var(--color-foam); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600"
              >
                {{ 'web.profile.payment.confirm' | translate }}
              </button>
              <button
                type="button"
                (click)="openForm()"
                style="height: 44px; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)"
              >
                {{ 'web.profile.payment.startOver' | translate }}
              </button>
            </div>
          }
        }

        @if (error()) {
          <p style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 16px 0 0">
            {{ error() }}
          </p>
        }
      </div>
    </section>
  `,
})
export class PaymentMethodsPage implements OnInit {
  private readonly api = inject(PaymentCardsApi);
  private readonly store = inject(PaymentCardsStore);
  private readonly flags = inject(FeatureFlagsStore);
  private readonly translate = inject(TranslateService);

  readonly enabled = this.flags.cardPaymentsEnabled;
  readonly step = signal<Step>('list');
  readonly cards = signal<BoundCard[]>([]);
  readonly institutes = signal<CardInstitute[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly institute = signal('0001');
  readonly lastDigits = signal('');
  readonly phone = signal('');
  readonly code = signal('');
  private bindingId: string | null = null;

  ngOnInit(): void {
    this.flags.load();
    this.reload();
    this.api.institutes().subscribe({
      next: (list) => {
        this.institutes.set(list);
        if (list[0] && !list.some((i) => i.code === this.institute())) this.institute.set(list[0].code);
      },
      error: () => undefined,
    });
  }

  formValid(): boolean {
    return /^\d{4}$/.test(this.lastDigits().trim()) && /^\d{6,12}$/.test(this.phone().replace(/\D/g, ''));
  }

  cardTitle(card: BoundCard): string {
    return card.label || card.maskedPan || this.translate.instant('web.profile.payment.fallbackTitle');
  }

  cardSubtitle(card: BoundCard): string {
    return [card.instituteName, card.embossing].filter(Boolean).join(' · ');
  }

  openForm(): void {
    this.error.set(null);
    this.code.set('');
    this.bindingId = null;
    this.step.set('form');
  }

  submitForm(): void {
    if (!this.formValid() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api
      .startBinding({
        lastDigits: this.lastDigits().trim(),
        phone: this.phone().replace(/\D/g, ''),
        institute: this.institute(),
      })
      .subscribe({
        next: (res) => {
          this.busy.set(false);
          this.bindingId = res.bindingId;
          // Prepaid cards come back already bound — no one-time password step.
          if (res.completed) {
            this.finishBinding();
            return;
          }
          this.step.set('code');
        },
        error: (err) => this.fail(err),
      });
  }

  submitCode(): void {
    const bindingId = this.bindingId;
    if (!bindingId || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.confirmBinding(bindingId, this.code().trim()).subscribe({
      next: () => this.finishBinding(),
      error: (err) => this.fail(err),
    });
  }

  makeDefault(card: BoundCard): void {
    if (card.isDefault || this.busy()) return;
    this.busy.set(true);
    this.api.setDefault(card.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.store.invalidate();
        this.reload();
      },
      error: (err) => this.fail(err),
    });
  }

  remove(card: BoundCard): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.remove(card.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.store.invalidate();
        this.reload();
      },
      error: (err) => this.fail(err),
    });
  }

  private finishBinding(): void {
    this.busy.set(false);
    this.lastDigits.set('');
    this.phone.set('');
    this.code.set('');
    this.bindingId = null;
    this.store.invalidate();
    this.step.set('list');
    this.reload();
  }

  private reload(): void {
    this.loading.set(true);
    this.store.load(true).subscribe({
      next: (cards) => {
        this.cards.set(cards);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  private fail(err: unknown): void {
    this.busy.set(false);
    const maybe = err as { error?: { message?: string | string[] }; message?: string };
    const raw = maybe.error?.message ?? maybe.message;
    const message = Array.isArray(raw) ? raw.join(', ') : raw;
    this.error.set(message || this.translate.instant('web.profile.payment.genericError'));
  }
}
