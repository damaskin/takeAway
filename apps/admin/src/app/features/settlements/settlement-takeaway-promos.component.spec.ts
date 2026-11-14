import { HttpErrorResponse } from '@angular/common/http';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { BrandTakeawayPromoReport, SettlementReport } from '@takeaway/shared-types';
import { of, throwError } from 'rxjs';

import { SettlementsApi } from '../../core/settlements/settlements.service';
import { SettlementTakeawayPromosComponent } from './settlement-takeaway-promos.component';

/** Only what the block reads of the page's report: brand, currency, period. */
function settlement(from = '2026-10-26', to = '2026-11-01'): SettlementReport {
  return {
    brand: { id: 'b1', name: 'NoName Coffee', plan: 'PRO', currentBps: 1500, planBps: 1500 },
    currency: 'RUP',
    currencies: ['RUP'],
    period: { from, to, days: 7, timeZone: 'Europe/Chisinau' },
  } as SettlementReport;
}

/** The spec's example: 100 at −10 % accrued, 15 in a settlement, 45 repaid — the brand confirmed it on 27.10. */
const PROMOS: BrandTakeawayPromoReport = {
  brandId: 'b1',
  currency: 'RUP',
  period: { from: '2026-10-26', to: '2026-11-01', timeZone: 'Europe/Chisinau' },
  orders: 3,
  menuTotalCents: 16000,
  paidByGuestCents: 14400,
  compensationAccruedCents: 1600,
  compensationRepaidCents: 450,
  currentDebtCents: 2150,
  items: [
    {
      orderId: 'o3',
      orderCode: '1048',
      storeId: 's1',
      storeName: 'Центр',
      settledAt: '2026-10-30T10:04:00.000Z',
      promoName: 'Приветственный',
      percent: 10,
      menuTotalCents: 10000,
      paidByGuestCents: 9000,
      compensationCents: 1000,
      status: 'ACCRUED',
      payoutId: null,
      repaidAt: null,
    },
    {
      orderId: 'o2',
      orderCode: '1030',
      storeId: 's1',
      storeName: 'Центр',
      settledAt: '2026-10-27T08:00:00.000Z',
      promoName: 'Приветственный',
      percent: 10,
      menuTotalCents: 1500,
      paidByGuestCents: 1350,
      compensationCents: 150,
      status: 'IN_PAYOUT',
      payoutId: 'p2',
      repaidAt: null,
    },
    {
      orderId: 'o1',
      orderCode: '1012',
      storeId: 's1',
      storeName: 'Центр',
      settledAt: '2026-10-21T07:15:00.000Z',
      promoName: 'Приветственный',
      percent: 10,
      menuTotalCents: 4500,
      paidByGuestCents: 4050,
      compensationCents: 450,
      status: 'REPAID',
      payoutId: 'p1',
      repaidAt: '2026-10-27T12:00:00.000Z',
    },
  ],
};

describe('SettlementTakeawayPromosComponent', () => {
  let fixture: ComponentFixture<SettlementTakeawayPromosComponent>;
  let takeawayPromos: jest.Mock;

  async function render(answer = of(PROMOS)) {
    takeawayPromos = jest.fn().mockReturnValue(answer);
    TestBed.configureTestingModule({
      imports: [SettlementTakeawayPromosComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: SettlementsApi, useValue: { takeawayPromos } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    fixture = TestBed.createComponent(SettlementTakeawayPromosComponent);
    fixture.componentRef.setInput('report', settlement());
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => TestBed.resetTestingModule());

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (node: Element | null | undefined) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it("asks for the page's brand, currency and period", async () => {
    await render();
    expect(takeawayPromos).toHaveBeenCalledWith({
      brandId: 'b1',
      currency: 'RUP',
      from: '2026-10-26',
      to: '2026-11-01',
    });
  });

  it('sums up the promo orders and what takeAway owes now', async () => {
    await render();
    const figures = [...el().querySelectorAll('.stp-summary > div')].map(
      (d) => `${text(d.querySelector('dt'))}: ${text(d.querySelector('dd'))}`,
    );
    expect(figures).toEqual([
      'Заказов по акциям: 3',
      'Продажи по ценам меню: 160 руб.',
      'Оплачено гостями: 144 руб.',
      'Компенсация начислена: 16 руб.',
      'Компенсация погашена: 4,50 руб.',
      'Долг takeAway по акциям: 21,50 руб.',
    ]);
    expect(text(el().querySelector('.stp-debt span'))).toBe(
      'на сейчас, за всё время; гасится подтверждённым взаиморасчётом',
    );
    // Guests pay the brand directly now: no word of payouts.
    expect(text(el())).toContain('takeAway компенсирует бренду во взаиморасчёте');
    expect(text(el())).not.toMatch(/выплат/i);
  });

  it('lists each promo order with its date on the brand clock and where its compensation stands', async () => {
    await render();
    const rows = [...el().querySelectorAll('[data-testid="stp-orders-table"] tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => text(td)),
    );
    expect(rows[0]).toEqual([
      '30.10 12:04',
      '1048',
      'Приветственный −10%',
      '100 руб.',
      '90 руб.',
      '10 руб.',
      'начислена',
    ]);
    expect(rows[1]?.[6]).toBe('во взаиморасчёте');
    expect(rows[2]?.slice(3)).toEqual(['45 руб.', '40,50 руб.', '4,50 руб.', 'погашена 27.10']);
  });

  it('re-reads when the page loads a new report', async () => {
    await render();
    fixture.componentRef.setInput('report', settlement('2026-10-01', '2026-10-31'));
    fixture.detectChanges();
    expect(takeawayPromos).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-10-01', to: '2026-10-31' }));
  });

  it('says it could not load instead of breaking the page', async () => {
    await render(throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'boom' } })));
    expect(text(el())).toContain('Не удалось загрузить акции takeAway.');
  });
});
