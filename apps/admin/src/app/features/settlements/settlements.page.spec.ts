import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type {
  CommissionRateHistory,
  SettlementPayout,
  SettlementReport,
  SettlementTotals,
} from '@takeaway/shared-types';
import { of } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { SettlementsApi } from '../../core/settlements/settlements.service';
import { SettlementsPage } from './settlements.page';

const totals: SettlementTotals = {
  orders: 5,
  cardOrders: 4,
  zeroTotalOrders: 1,
  unpaidOrders: 0,
  unpaidTotalCents: 0,
  salesCents: 32833,
  promoDiscountCents: 4000,
  pointsDiscountCents: 1000,
  giftCardCents: 5000,
  deliveryFeeCents: 0,
  capturedCents: 22833,
  refundedCents: 1000,
  commissionBaseCents: 21833,
  commissionCents: 3275,
  payableCents: 18558,
};

function payout(overrides: Partial<SettlementPayout> = {}): SettlementPayout {
  return {
    id: 'p1',
    brandId: 'b1',
    currency: 'RUP',
    periodFrom: '2026-09-21',
    periodTo: '2026-09-27',
    timeZone: 'Europe/Chisinau',
    amountCents: 10000,
    cardNetCents: 11765,
    commissionCents: 1765,
    status: 'PENDING',
    paidAt: null,
    reference: null,
    comment: null,
    createdAt: '2026-09-28T09:00:00.000Z',
    ...overrides,
  };
}

function report(overrides: Partial<SettlementReport> = {}): SettlementReport {
  return {
    brand: { id: 'b1', name: 'NoName Coffee', plan: 'PRO', currentBps: 1500, planBps: 1500 },
    currency: 'RUP',
    currencies: ['RUP'],
    period: { from: '2026-09-28', to: '2026-10-04', days: 7, timeZone: 'Europe/Chisinau' },
    totals,
    days: [{ date: '2026-09-28', ...totals }],
    rates: [{ bps: 1500, source: 'PLAN', from: '2026-09-28', to: '2026-10-04' }],
    balance: {
      openingCents: 10000,
      payableCents: 18558,
      paidCents: 0,
      pendingCents: 0,
      closingCents: 28558,
      closingPendingCents: 10000,
    },
    nextPayout: {
      periodFrom: '2026-09-28',
      periodTo: '2026-10-04',
      amountCents: 18558,
      cardNetCents: 21833,
      commissionCents: 3275,
      blocked: null,
      lastSettledDay: '2026-09-27',
    },
    payouts: [payout()],
    ...overrides,
  };
}

const HISTORY: CommissionRateHistory = {
  brandId: 'b1',
  plan: 'PRO',
  planBps: 1500,
  currentBps: 1500,
  timeZone: 'Europe/Chisinau',
  rates: [
    {
      id: 'r1',
      bps: 1500,
      source: 'PLAN',
      effectiveFrom: '2026-09-01T00:00:00.000Z',
      effectiveTo: null,
      note: null,
      createdAt: '2026-10-10T00:00:00.000Z',
    },
  ],
};

describe('SettlementsPage', () => {
  let fixture: ComponentFixture<SettlementsPage>;
  let api: {
    report: jest.Mock;
    rates: jest.Mock;
    setRate: jest.Mock;
    deleteRate: jest.Mock;
    createPayout: jest.Mock;
    markPaid: jest.Mock;
    deletePayout: jest.Mock;
  };

  async function render(role: 'SUPER_ADMIN' | 'BRAND_ADMIN', data: SettlementReport = report()) {
    api = {
      report: jest.fn().mockReturnValue(of(data)),
      rates: jest.fn().mockReturnValue(of(HISTORY)),
      setRate: jest.fn().mockReturnValue(of(HISTORY)),
      deleteRate: jest.fn().mockReturnValue(of(HISTORY)),
      createPayout: jest.fn().mockReturnValue(of(payout({ id: 'p2', amountCents: 18558 }))),
      markPaid: jest.fn().mockReturnValue(of(payout({ status: 'PAID' }))),
      deletePayout: jest.fn().mockReturnValue(of(undefined)),
    };
    TestBed.configureTestingModule({
      imports: [SettlementsPage],
      providers: [
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: SettlementsApi, useValue: api },
        { provide: AuthStore, useValue: { user: signal({ role }) } },
        {
          provide: ActiveBrandService,
          useValue: {
            activeId: signal('b1'),
            brands: signal([{ id: 'b1', name: 'NoName Coffee' }]),
            select: jest.fn(),
          },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    fixture = TestBed.createComponent(SettlementsPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => (el().textContent ?? '').replace(/\s+/g, ' ');
  const button = (label: string) =>
    Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as
      | HTMLButtonElement
      | undefined;
  const click = (label: string) => {
    const found = button(label);
    if (!found) throw new Error(`no button «${label}»`);
    found.click();
  };
  const type = (selector: string, value: string) => {
    const input = el().querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`no input ${selector}`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  it("shows a platform admin the brand's card money, commission, what is owed and what is left", async () => {
    await render('SUPER_ADMIN');

    const lastCall = api.report.mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({ brandId: 'b1', currency: null });
    expect(lastCall.from <= lastCall.to).toBe(true);

    expect(text()).toContain('Расчёты с брендами');
    const kpis = Array.from(el().querySelectorAll('app-kpi-card')).map((k) =>
      (k.textContent ?? '').replace(/\s+/g, ' '),
    );
    expect(kpis).toHaveLength(5);
    expect(kpis[0]).toContain('Всего оплачено картами');
    expect(kpis[0]).toContain('228,33');
    expect(kpis[1]).toContain('Комиссия takeAway · 15');
    expect(kpis[1]).toContain('32,75');
    expect(kpis[2]).toContain('К выплате бренду');
    expect(kpis[2]).toContain('185,58');
    expect(kpis[4]).toContain('Остаток');
    expect(kpis[4]).toContain('285,58');
    // The promo order the customer paid nothing for is explained, not hidden.
    expect(text()).toContain('Заказов на 0');
  });

  it('fixes the payout the API proposes', async () => {
    await render('SUPER_ADMIN');
    expect(text()).toContain('185,58');

    type('.st-payout-form input', 'ПП-15');
    click('Зафиксировать выплату');

    expect(api.createPayout).toHaveBeenCalledWith({
      brandId: 'b1',
      currency: 'RUP',
      to: '2026-10-04',
      reference: 'ПП-15',
      comment: undefined,
    });
  });

  it('says why a payout cannot be fixed instead of offering the button', async () => {
    await render(
      'SUPER_ADMIN',
      report({ nextPayout: { ...report().nextPayout, blocked: 'PERIOD_OPEN', amountCents: 0 } }),
    );
    expect(text()).toContain('Период ещё не закончился');
    expect(button('Зафиксировать выплату')).toBeUndefined();
  });

  it('marks a payout paid with the transfer number', async () => {
    await render('SUPER_ADMIN');
    click('Отметить выплаченной');
    fixture.detectChanges();

    type('.st-inline input', 'ПП-77');
    click('Подтвердить');

    expect(api.markPaid).toHaveBeenCalledWith('p1', { reference: 'ПП-77' });
  });

  it('shows a brand owner the same figures, read-only', async () => {
    await render('BRAND_ADMIN');

    expect(text()).toContain('Расчёты');
    expect(text()).not.toContain('Расчёты с брендами');
    expect(text()).toContain('К выплате вам');
    expect(text()).toContain('185,58');
    expect(button('Зафиксировать выплату')).toBeUndefined();
    expect(button('Отметить выплаченной')).toBeUndefined();
    expect(button('Сохранить ставку')).toBeUndefined();
    expect(text()).toContain('Ждёт перевода');
  });
});
