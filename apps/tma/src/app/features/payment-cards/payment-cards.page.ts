import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import {
  type BoundCard,
  type CardInstitute,
  PaymentCardsApi,
  PaymentCardsStore,
} from '../../core/payments/payment-cards.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';

type Step = 'list' | 'form' | 'code';

/**
 * Card management for the Agroprombank («Клевер») scheme.
 *
 * Binding is deliberately a two-screen flow: the customer never types a full
 * card number — only the last four digits and the phone the bank has on file —
 * and confirms with the one-time password the bank sends by SMS.
 */
@Component({
  selector: 'app-tma-payment-cards',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  template: `
    <section style="padding: 16px; padding-bottom: 100px; display: flex; flex-direction: column; gap: 20px">
      <h1
        style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-espresso); margin: 0"
      >
        {{ 'tma.cards.title' | translate }}
      </h1>

      @if (!enabled()) {
        <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
          {{ 'tma.cards.unavailable' | translate }}
        </p>
      } @else if (step() === 'list') {
        @if (loading()) {
          <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-tertiary); margin: 0">
            {{ 'tma.cards.loading' | translate }}
          </p>
        } @else if (cards().length === 0) {
          <div class="flex flex-col items-center" style="gap: 8px; padding: 24px 0">
            <span style="font-size: 34px">💳</span>
            <p
              class="text-center"
              style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0"
            >
              {{ 'tma.cards.empty' | translate }}
            </p>
          </div>
        } @else {
          <div
            class="flex flex-col"
            style="background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 16px; overflow: hidden"
          >
            @for (card of cards(); track card.id; let last = $last) {
              <div
                class="flex items-center"
                [style.borderBottom]="last ? 'none' : '1px solid var(--color-border-light)'"
                style="padding: 12px 16px; gap: 12px"
              >
                <span style="font-size: 20px">💳</span>
                <button type="button" class="flex-1 text-left" (click)="makeDefault(card)" style="min-width: 0">
                  <span
                    class="block"
                    style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
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
                    style="height: 22px; padding: 0 10px; background: var(--color-caramel); color: white; border-radius: 9999px; font-family: var(--font-sans); font-size: 11px; font-weight: 700"
                    >{{ 'tma.cards.default' | translate }}</span
                  >
                }
                <button
                  type="button"
                  (click)="remove(card)"
                  [disabled]="busy()"
                  style="color: var(--color-berry); font-family: var(--font-sans); font-size: 13px; font-weight: 600"
                >
                  {{ 'tma.cards.remove' | translate }}
                </button>
              </div>
            }
          </div>
        }

        <button
          type="button"
          (click)="openForm()"
          class="flex items-center justify-center"
          style="height: 48px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600"
        >
          {{ 'tma.cards.add' | translate }}
        </button>
      } @else if (step() === 'form') {
        <div class="flex flex-col" style="gap: 14px">
          <label class="flex flex-col" style="gap: 6px">
            <span style="font-family: var(--font-sans); font-size: 13px; font-weight: 600">{{
              'tma.cards.issuer' | translate
            }}</span>
            <select
              [ngModel]="institute()"
              (ngModelChange)="institute.set($event)"
              name="institute"
              style="height: 48px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-input); padding: 0 12px; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)"
            >
              @for (bank of institutes(); track bank.code) {
                <option [value]="bank.code">{{ bank.name }}</option>
              }
            </select>
          </label>

          <label class="flex flex-col" style="gap: 6px">
            <span style="font-family: var(--font-sans); font-size: 13px; font-weight: 600">{{
              'tma.cards.lastDigits' | translate
            }}</span>
            <input
              [ngModel]="lastDigits()"
              (ngModelChange)="lastDigits.set($event)"
              name="lastDigits"
              inputmode="numeric"
              maxlength="4"
              placeholder="0578"
              style="height: 48px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-input); padding: 0 12px; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)"
            />
          </label>

          <label class="flex flex-col" style="gap: 6px">
            <span style="font-family: var(--font-sans); font-size: 13px; font-weight: 600">{{
              'tma.cards.phone' | translate
            }}</span>
            <input
              [ngModel]="phone()"
              (ngModelChange)="phone.set($event)"
              name="phone"
              inputmode="numeric"
              maxlength="12"
              placeholder="77712345"
              style="height: 48px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-input); padding: 0 12px; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-primary)"
            />
          </label>

          <p style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary); margin: 0">
            {{ 'tma.cards.privacyHint' | translate }}
          </p>

          <button
            type="button"
            (click)="submitForm()"
            [disabled]="busy() || !formValid()"
            class="flex items-center justify-center"
            [style.opacity]="busy() || !formValid() ? '0.5' : '1'"
            style="height: 48px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600"
          >
            {{ 'tma.cards.sendCode' | translate }}
          </button>
          <button
            type="button"
            (click)="step.set('list')"
            style="height: 44px; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)"
          >
            {{ 'tma.cards.cancel' | translate }}
          </button>
        </div>
      } @else {
        <div class="flex flex-col" style="gap: 14px">
          <p style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary); margin: 0">
            {{ 'tma.cards.codeSent' | translate: { phone: phone() } }}
          </p>
          <input
            [ngModel]="code()"
            (ngModelChange)="code.set($event)"
            name="code"
            inputmode="numeric"
            maxlength="8"
            placeholder="047805"
            style="height: 52px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: var(--radius-input); padding: 0 14px; font-family: var(--font-sans); font-size: 20px; letter-spacing: 4px; text-align: center; color: var(--color-text-primary)"
          />
          <button
            type="button"
            (click)="submitCode()"
            [disabled]="busy() || code().trim().length < 4"
            class="flex items-center justify-center"
            [style.opacity]="busy() || code().trim().length < 4 ? '0.5' : '1'"
            style="height: 48px; background: var(--color-caramel); color: white; border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600"
          >
            {{ 'tma.cards.confirm' | translate }}
          </button>
          <button
            type="button"
            (click)="openForm()"
            style="height: 44px; font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)"
          >
            {{ 'tma.cards.startOver' | translate }}
          </button>
        </div>
      }

      @if (error()) {
        <p
          class="text-center"
          style="font-family: var(--font-sans); font-size: 13px; color: var(--color-berry); margin: 0"
        >
          {{ error() }}
        </p>
      }
    </section>
  `,
})
export class TmaPaymentCardsPage implements OnInit, OnDestroy {
  private readonly api = inject(PaymentCardsApi);
  private readonly store = inject(PaymentCardsStore);
  private readonly flags = inject(FeatureFlagsStore);
  private readonly tg = inject(TelegramBridgeService);
  private readonly router = inject(Router);
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

  private detachBack: (() => void) | null = null;

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

    this.detachBack = this.tg.setBackButton(() => {
      if (this.step() !== 'list') {
        this.step.set('list');
        return;
      }
      void this.router.navigate(['/profile']);
    });
  }

  ngOnDestroy(): void {
    this.detachBack?.();
  }

  formValid(): boolean {
    return /^\d{4}$/.test(this.lastDigits().trim()) && /^\d{6,12}$/.test(this.phone().replace(/\D/g, ''));
  }

  cardTitle(card: BoundCard): string {
    return card.label || card.maskedPan || this.translate.instant('tma.cards.fallbackTitle');
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
    this.tg.haptic('light');
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
    this.tg.haptic('medium');
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
    this.error.set(message || this.translate.instant('tma.cards.genericError'));
  }
}
