import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { AgroprombankQrPaymentDto } from '@takeaway/shared-types';
import { type Observable, Subject, of, throwError } from 'rxjs';

import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { OrdersApi } from '../../core/orders/orders.service';
import { PaymentCardsApi, PaymentCardsStore } from '../../core/payments/payment-cards.service';
import { QrPaymentApi } from '../../core/payments/qr-payment.service';
import { WebPaymentApi } from '../../core/payments/web-payment.service';
import { QrPaymentPage } from './qr-payment.page';

@Component({ standalone: true, template: 'order page' })
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

const bankDown = () =>
  new HttpErrorResponse({
    status: 503,
    error: { statusCode: 503, code: 'QR_BANK_UNAVAILABLE', message: 'The bank could not be reached' },
  });

describe('web QrPaymentPage', () => {
  let qr: {
    start: jest.Mock;
    status: jest.Mock;
    cancel: jest.Mock;
    issued: jest.Mock;
  };
  let webPayments: { start: jest.Mock; redirectToBank: jest.Mock };
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

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function open(opts: {
    issued?: AgroprombankQrPaymentDto | null;
    start?: () => Observable<AgroprombankQrPaymentDto>;
    status?: () => Observable<AgroprombankQrPaymentDto>;
    flow?: 'token' | 'web' | 'none';
  }) {
    qr = {
      start: jest.fn(opts.start ?? (() => of(pending()))),
      status: jest.fn(opts.status ?? (() => of(pending()))),
      cancel: jest.fn(() => of(pending({ status: 'EXPIRED', qr: null }))),
      issued: jest.fn(() => opts.issued ?? null),
    };
    webPayments = { start: jest.fn(() => of({ page: null })), redirectToBank: jest.fn() };
    const flow = opts.flow ?? 'none';
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'orders/:id/qr', component: QrPaymentPage },
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
        { provide: WebPaymentApi, useValue: webPayments },
        { provide: PaymentCardsApi, useValue: { pay: jest.fn(() => of({})) } },
        { provide: PaymentCardsStore, useValue: { load: () => of([]) } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');

    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl('/orders/ord-1/qr', QrPaymentPage);
    harness.detectChanges();
    const root = (): HTMLElement => harness.routeNativeElement as HTMLElement;
    const byTestId = (id: string) => root().querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const text = (id: string) => byTestId(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    const router = TestBed.inject(Router);
    return { page, harness, byTestId, text, router, detect: () => harness.detectChanges() };
  }

  it('shows the invoice checkout issued: the code, the amount, the time left and the way into the bank app', async () => {
    const { byTestId, text } = await open({ issued: pending() });

    expect(qr.start).not.toHaveBeenCalled();
    expect(byTestId('qr-code')?.querySelector('svg path')).not.toBeNull();
    expect(text('qr-order')).toContain('4832');
    expect(text('qr-countdown')).toBe('Счёт действует ещё 10:00');
    expect(byTestId('qr-open-bank')?.getAttribute('href')).toBe('https://bank.example/pay?code=1');
    expect(text('qr-hint')).toBe('Отсканируйте код в приложении Агропромбанка (раздел «Оплата по QR»)');
    expect(byTestId('qr-other-device')).toBeNull();
  });

  it('asks every 3 seconds and opens the order once the money landed', async () => {
    const answers = [pending(), pending({ status: 'PAID', qr: null })];
    const { router } = await open({ issued: pending(), status: () => of(answers.shift() ?? pending()) });

    jest.advanceTimersByTime(2_999);
    expect(qr.status).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(qr.status).toHaveBeenCalledWith('pay-1');
    jest.advanceTimersByTime(3_000);
    expect(qr.status).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    await jest.runOnlyPendingTimersAsync();

    expect(router.url).toBe('/orders/ord-1');
    jest.advanceTimersByTime(30_000);
    expect(qr.status).toHaveBeenCalledTimes(2);
    expect(qr.cancel).not.toHaveBeenCalled();
  });

  // The customer leaves for the bank's app and comes back.
  it('stops asking while hidden, asks at once on coming back, and never cancels by itself', async () => {
    const { page, harness } = await open({});
    expect(qr.start).toHaveBeenCalledWith('ord-1');

    setVisibility('hidden');
    jest.advanceTimersByTime(60_000);
    expect(qr.status).not.toHaveBeenCalled();

    setVisibility('visible');
    expect(qr.status).toHaveBeenCalledTimes(1);

    // Leaving the screen does not call the invoice off either.
    page.ngOnDestroy();
    harness.fixture.destroy();
    expect(qr.cancel).not.toHaveBeenCalled();
  });

  it('says the invoice expired, offers a new code, and the card where cards are on', async () => {
    const { byTestId, text, detect } = await open({ issued: pending(), flow: 'web' });

    jest.advanceTimersByTime(10 * 60_000);
    detect();
    expect(text('qr-expired')).toContain('Счёт истёк');
    expect(byTestId('qr-code')).toBeNull();

    byTestId('qr-new-code')?.click();
    expect(qr.start).toHaveBeenCalledWith('ord-1');

    jest.advanceTimersByTime(10 * 60_000);
    detect();
    byTestId('qr-pay-card')?.click();
    expect(webPayments.start).toHaveBeenCalledWith('ord-1');
  });

  it('offers no card where cards are off', async () => {
    const { byTestId, detect } = await open({ issued: pending({ status: 'EXPIRED', qr: null }) });
    detect();
    expect(byTestId('qr-new-code')).not.toBeNull();
    expect(byTestId('qr-pay-card')).toBeNull();
  });

  it('says the bank is down and tries again on request', async () => {
    const answers: Array<() => Observable<AgroprombankQrPaymentDto>> = [
      () => throwError(bankDown),
      () => of(pending()),
    ];
    const { byTestId, text, detect } = await open({ start: () => (answers.shift() ?? (() => of(pending())))() });

    expect(text('qr-failed')).toContain('Банк сейчас не отвечает — попробуйте ещё раз через минуту');
    byTestId('qr-retry')?.click();
    detect();
    expect(qr.start).toHaveBeenCalledTimes(2);
    expect(byTestId('qr-code')).not.toBeNull();
  });

  it('opens the order when it can no longer be paid', async () => {
    const notPayable = new HttpErrorResponse({ status: 409, error: { statusCode: 409, code: 'ORDER_NOT_PAYABLE' } });
    const { router } = await open({ start: () => throwError(() => notPayable) });
    await jest.runOnlyPendingTimersAsync();
    expect(router.url).toBe('/orders/ord-1');
  });

  it('calls the invoice off on «Отменить» and goes back to the order', async () => {
    const { byTestId, router } = await open({ issued: pending() });

    byTestId('qr-cancel')?.click();
    expect(qr.cancel).toHaveBeenCalledWith('pay-1');
    await jest.runOnlyPendingTimersAsync();
    expect(router.url).toBe('/orders/ord-1');
  });

  it('says to scan from another device on a phone with no link into the bank app', async () => {
    jest
      .spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148');
    const expiresAt = new Date(NOW + 10 * 60_000).toISOString();
    const issued = pending({ qr: { code: 'QRT000000000000123:45.00:4200000017', appLink: null, expiresAt } });
    const { byTestId } = await open({ issued });

    expect(byTestId('qr-open-bank')).toBeNull();
    expect(byTestId('qr-other-device')).not.toBeNull();
  });

  it('keeps waiting quietly through a failed status read', async () => {
    const answers: Array<() => Observable<AgroprombankQrPaymentDto>> = [() => throwError(bankDown)];
    await open({ issued: pending(), status: () => (answers.shift() ?? (() => of(pending())))() });

    jest.advanceTimersByTime(3_000);
    jest.advanceTimersByTime(3_000);
    expect(qr.status).toHaveBeenCalledTimes(2);
  });

  it('waits while a slow status read is on its way', async () => {
    const slow = new Subject<AgroprombankQrPaymentDto>();
    await open({ issued: pending(), status: () => slow });

    jest.advanceTimersByTime(30_000);
    expect(qr.status).toHaveBeenCalledTimes(1);
  });
});
