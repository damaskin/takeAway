import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { TakeawayDebtReport } from '@takeaway/shared-types';
import { of } from 'rxjs';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { TakeawayPromosApi } from '../../core/takeaway-promos/takeaway-promos.service';
import { TakeawayDebtPage } from './takeaway-debt.page';

const DEBT: TakeawayDebtReport = {
  rows: [
    {
      brandId: 'b1',
      brandName: 'NoName Coffee',
      currency: 'RUP',
      accruedCents: 16_000,
      inPayoutCents: 1_500,
      repaidCents: 4_500,
      debtCents: 11_500,
    },
    {
      brandId: 'b2',
      brandName: 'Качели',
      currency: 'RUP',
      accruedCents: 1_000,
      inPayoutCents: 0,
      repaidCents: 0,
      debtCents: 1_000,
    },
  ],
  totals: [{ currency: 'RUP', accruedCents: 17_000, repaidCents: 4_500, inPayoutCents: 1_500, debtCents: 12_500 }],
};

describe('TakeawayDebtPage', () => {
  let fixture: ComponentFixture<TakeawayDebtPage>;
  let select: jest.Mock;
  let navigate: jest.SpyInstance;

  async function render(data: TakeawayDebtReport = DEBT) {
    select = jest.fn();
    TestBed.configureTestingModule({
      imports: [TakeawayDebtPage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: TakeawayPromosApi, useValue: { debt: jest.fn().mockReturnValue(of(data)) } },
        { provide: ActiveBrandService, useValue: { select } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(TakeawayDebtPage);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => TestBed.resetTestingModule());

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (node: Element | null | undefined) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it("shows takeAway's debt to every brand and the total per currency", async () => {
    await render();

    const totals = text(el().querySelector('[data-testid="takeaway-debt-totals"]'));
    expect(totals).toContain('Долг takeAway · RUP');
    expect(totals).toContain('125 руб.');
    expect(totals).toContain('начислено 170 руб.');
    expect(totals).toContain('погашено 45 руб.');

    const rows = [...el().querySelectorAll('[data-testid="takeaway-debt-table"] tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => text(td)),
    );
    expect(rows[0]).toEqual(['NoName Coffee', 'RUP', '160 руб.', '15 руб.', '45 руб.', '115 руб.', 'Расчёты']);
    const foot = text(el().querySelector('[data-testid="takeaway-debt-table"] tfoot'));
    expect(foot).toContain('Итого · RUP');
    expect(foot).toContain('125 руб.');
  });

  it("opens a brand's settlements with that brand in the header", async () => {
    await render();
    const open = el().querySelector<HTMLButtonElement>('button[aria-label="Открыть расчёты бренда Качели"]');
    open?.click();
    expect(select).toHaveBeenCalledWith('b2');
    expect(navigate).toHaveBeenCalledWith(['/settlements']);
  });

  it('says there is no debt before the first promo order', async () => {
    await render({ rows: [], totals: [] });
    expect(text(el())).toContain('Заказов по акциям takeAway ещё не было — долга нет.');
    expect(el().querySelector('[data-testid="takeaway-debt-totals"]')).toBeNull();
  });
});
