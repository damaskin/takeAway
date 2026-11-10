import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { AgroprombankQrPaymentDto } from '@takeaway/shared-types';
import { type Observable, of, throwError } from 'rxjs';

import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { OrdersApi } from '../../core/orders/orders.service';
import { PaymentCardsApi, PaymentCardsStore } from '../../core/payments/payment-cards.service';
import { QrPaymentApi } from '../../core/payments/qr-payment.service';
import { WebPaymentApi } from '../../core/payments/web-payment.service';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';
import { TmaQrPaymentPage } from './qr-payment.page';

@Component({ standalone: true, template: 'order screen' })
class OrderStub {}

const NOW = Date.parse('2026-11-10T12:00:00Z');

function pending(over: Partial<AgroprombankQrPaymentDto> = {}): AgroprombankQrPaymentDto {
  return {
    paymentId: 'pay-1',
    orderId: 'ord-1',
    status: 'PENDING',
    amountCents: 4500,
    currency: 'RUP',
    qr: {
      code: 'QRT000000000000123:45.00:4200000017',
      appLink: 'https://bank.example/pay?code=1',
      expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
    },
    ...over,
  };
}

describe('TmaQrPaymentPage', () => {
  let qr: { start: jest.Mock; status: jest.Mock; cancel: jest.Mock; issued: jest.Mock };
  let tg: { onPhone: boolean; setBackButton: jest.Mock; haptic: jest.Mock; openLink: jest.Mock };
  let cardsApi: { pay: jest.Mock };
  let back: (() => void) | null;
  let visibility: DocumentVisibilityState;

  const setVisibility = (state: DocumentVisibilityState): void => {
    visibility = state;
    document.dispatchEvent(new Event('visibilitychange'));
  };

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['queueMicrotask', 'nextTick'] });
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  });

  afterEach(() => jest.useRealTimers());

  async function open(opts: {
    issued?: AgroprombankQrPaymentDto | null;
    start?: () => Observable<AgroprombankQrPaymentDto>;
    status?: () => Observable<AgroprombankQrPaymentDto>;
    onPhone?: boolean;
    flow?: 'token' | 'web' | 'none';
  }) {
    qr = {
      start: jest.fn(opts.start ?? (() => of(pending()))),
      status: jest.fn(opts.status ?? (() => of(pending()))),
      cancel: jest.fn(() => of(pending({ status: 'EXPIRED', qr: null }))),
      issued: jest.fn(() => opts.issued ?? null),
    };
    back = null;
    tg = {
      onPhone: opts.onPhone ?? true,
      setBackButton: jest.fn((handler: () => void) => {
        back = handler;
        return () => (back = null);
      }),
      haptic: jest.fn(),
      openLink: jest.fn(),
    };
    cardsApi = { pay: jest.fn(() => of({})) };
    const flow = opts.flow ?? 'none';
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'orders/:id/qr', component: TmaQrPaymentPage },
          { path: 'orders/:id', component: OrderStub },
        ]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: QrPaymentApi, useValue: qr },
        { provide: OrdersApi, useValue: { get: jest.fn(() => of({ id: 'ord-1', orderCode: '4832' })) } },
        {
          provide: FeatureFlagsStore,
          useValue: {
            load: jest.fn(),
            webPaymentsEnabled: signal(flow === 'web'),
            boundCardsEnabled: signal(flow === 'token'),
          },
        },
        { provide: WebPaymentApi, useValue: { start: jest.fn(() => of({ page: null })) } },
        { provide: PaymentCardsApi, useValue: cardsApi },
        {
          provide: PaymentCardsStore,
          useValue: {
            load: () =>
              of([
                {
                  id: 'card-1',
                  maskedPan: '•••• 1234',
                  isDefault: true,
                },
              ]),
          },
        },
        { provide: TelegramBridgeService, useValue: tg },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');

    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl('/orders/ord-1/qr', TmaQrPaymentPage);
    harness.detectChanges();
    const root = (): HTMLElement => harness.routeNativeElement as HTMLElement;
    const byTestId = (id: string) => root().querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const text = (id: string) => byTestId(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    return { page, harness, byTestId, text, router: TestBed.inject(Router), detect: () => harness.detectChanges() };
  }

  it('opens the bank app through Telegram from a tap, with the code and the time left under it', async () => {
    const { byTestId, text } = await open({ issued: pending() });

    expect(qr.start).not.toHaveBeenCalled();
    expect(text('qr-amount')).toContain('45');
    expect(text('qr-countdown')).toBe('Счёт действует ещё 10:00');
    expect(byTestId('qr-code')?.querySelector('svg path')).not.toBeNull();

    byTestId('qr-open-bank')?.click();
    expect(tg.openLink).toHaveBeenCalledWith('https://bank.example/pay?code=1');
  });

  it('says to scan from another device when there is no link into the bank app', async () => {
    const expiresAt = new Date(NOW + 10 * 60_000).toISOString();
    const issued = pending({ qr: { code: 'QRT000000000000123:45.00:4200000017', appLink: null, expiresAt } });
    const { byTestId, text } = await open({ issued });

    expect(byTestId('qr-open-bank')).toBeNull();
    expect(text('qr-other-device')).toContain('с другого устройства');
  });

  it('asks every 3 seconds, at once on coming back to Telegram, and opens the order once paid', async () => {
    const answers = [pending(), pending({ status: 'PAID', qr: null })];
    const { router } = await open({ issued: pending(), status: () => of(answers.shift() ?? pending()) });

    setVisibility('hidden');
    jest.advanceTimersByTime(60_000);
    expect(qr.status).not.toHaveBeenCalled();

    setVisibility('visible');
    expect(qr.status).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(3_000);
    expect(qr.status).toHaveBeenCalledTimes(2);
    await jest.runOnlyPendingTimersAsync();

    expect(router.url).toBe('/orders/ord-1');
    expect(tg.haptic).toHaveBeenCalledWith('medium');
    expect(qr.cancel).not.toHaveBeenCalled();
  });

  it('goes back to the order with Telegram’s back button, leaving the invoice open', async () => {
    const { router } = await open({ issued: pending() });
    back?.();
    await jest.runOnlyPendingTimersAsync();
    expect(router.url).toBe('/orders/ord-1');
    expect(qr.cancel).not.toHaveBeenCalled();
  });

  it('calls the invoice off on «Отменить»', async () => {
    const { byTestId, router } = await open({ issued: pending() });
    byTestId('qr-cancel')?.click();
    expect(qr.cancel).toHaveBeenCalledWith('pay-1');
    await jest.runOnlyPendingTimersAsync();
    expect(router.url).toBe('/orders/ord-1');
  });

  it('offers a new code once the invoice lapsed, and the default bound card', async () => {
    const { byTestId, text, detect } = await open({ issued: pending(), flow: 'token' });

    jest.advanceTimersByTime(10 * 60_000);
    detect();
    expect(text('qr-expired')).toContain('Счёт истёк');
    expect(text('qr-pay-card')).toBe('Оплатить картой · •••• 1234');

    byTestId('qr-pay-card')?.click();
    expect(cardsApi.pay).toHaveBeenCalledWith({ orderId: 'ord-1', cardId: 'card-1' });
  });

  it('says the bank is down, with a retry', async () => {
    const down = new HttpErrorResponse({ status: 503, error: { statusCode: 503, code: 'QR_BANK_UNAVAILABLE' } });
    const answers: Array<() => Observable<AgroprombankQrPaymentDto>> = [() => throwError(() => down)];
    const { byTestId, text, detect } = await open({ start: () => (answers.shift() ?? (() => of(pending())))() });

    expect(text('qr-failed')).toContain('Банк сейчас не отвечает');
    byTestId('qr-retry')?.click();
    detect();
    expect(qr.start).toHaveBeenCalledTimes(2);
    expect(byTestId('qr-code')).not.toBeNull();
  });

  it('has no retry where the QR payment is off for the store', async () => {
    const off = new HttpErrorResponse({ status: 409, error: { statusCode: 409, code: 'QR_CURRENCY_UNSUPPORTED' } });
    const { byTestId, text } = await open({ start: () => throwError(() => off) });
    expect(text('qr-failed')).toContain('В этом заведении оплата по QR недоступна');
    expect(byTestId('qr-retry')).toBeNull();
  });
});
