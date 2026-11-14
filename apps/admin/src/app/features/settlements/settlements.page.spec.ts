import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type {
  BrandTakeawayPromoReport,
  CommissionRateHistory,
  SettlementPayout,
  SettlementPayoutPreview,
  SettlementReport,
  SettlementTotals,
} from '@takeaway/shared-types';
import { of, throwError } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { SettlementsApi } from '../../core/settlements/settlements.service';
import { SettlementsPage } from './settlements.page';

/** Text of an element with its pieces apart: «Сумма для бизнеса 100 MDL», not «…бизнеса100 MDL». */
function spaced(el: Element | null | undefined): string {
  if (!el) return '';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const piece = node.textContent?.trim();
    if (piece) parts.push(piece);
  }
  return parts.join(' ').replace(/\s+/g, ' ');
}

/**
 * A week of two orders at 15 %: a takeAway promo order (100 at the menu, 90
 * by card, takeAway compensates 10) and a points order (50 at the menu, 20 in
 * points, 30 by card). Commission on the full 150 is 22,50; compensation is
 * 30 — takeAway owes the brand 7,50.
 */
const totals: SettlementTotals = {
  orders: 2,
  cardOrders: 2,
  zeroTotalOrders: 0,
  unpaidOrders: 0,
  unpaidTotalCents: 0,
  salesCents: 15000,
  promoDiscountCents: 0,
  pointsDiscountCents: 2000,
  giftCardCents: 0,
  deliveryFeeCents: 0,
  capturedCents: 12000,
  refundedCents: 0,
  cardNetCents: 12000,
  takeawayCompensationCents: 1000,
  pointsCompensationCents: 2000,
  compensationCents: 3000,
  commissionBaseCents: 15000,
  commissionCents: 2250,
  netCents: -750,
};

function payout(overrides: Partial<SettlementPayout> = {}): SettlementPayout {
  return {
    id: 'p1',
    brandId: 'b1',
    currency: 'RUP',
    periodFrom: '2026-09-21',
    periodTo: '2026-09-27',
    timeZone: 'Europe/Chisinau',
    direction: 'BRAND_TO_TAKEAWAY',
    amountCents: 1500,
    cardNetCents: 20000,
    commissionCents: 3000,
    compensationCents: 1000,
    pointsCompensationCents: 500,
    status: 'PENDING',
    paidAt: null,
    confirmedAt: null,
    disputedAt: null,
    disputeComment: null,
    reference: null,
    comment: null,
    createdAt: '2026-09-28T09:00:00.000Z',
    ...overrides,
  };
}

const NEXT: SettlementPayoutPreview = {
  periodFrom: '2026-09-28',
  periodTo: '2026-10-04',
  direction: 'TAKEAWAY_TO_BRAND',
  amountCents: 750,
  netCents: -750,
  cardNetCents: 12000,
  commissionCents: 2250,
  compensationCents: 1000,
  pointsCompensationCents: 2000,
  blocked: null,
  lastSettledDay: '2026-09-27',
};

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
      openingCents: 1500,
      netCents: -750,
      settledCents: 0,
      openCents: 0,
      closingCents: 750,
      closingOpenCents: 1500,
    },
    nextPayout: NEXT,
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
  rates: [],
};

/** No takeAway promo orders: the block shows its empty state. */
const NO_PROMOS: BrandTakeawayPromoReport = {
  brandId: 'b1',
  currency: 'RUP',
  period: { from: '2026-09-28', to: '2026-10-04', timeZone: 'Europe/Chisinau' },
  orders: 0,
  menuTotalCents: 0,
  paidByGuestCents: 0,
  compensationAccruedCents: 0,
  compensationRepaidCents: 0,
  currentDebtCents: 0,
  items: [],
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
    confirm: jest.Mock;
    deletePayout: jest.Mock;
    takeawayPromos: jest.Mock;
  };

  async function render(role: 'SUPER_ADMIN' | 'BRAND_ADMIN', data: SettlementReport = report()) {
    TestBed.resetTestingModule();
    api = {
      report: jest.fn().mockReturnValue(of(data)),
      rates: jest.fn().mockReturnValue(of(HISTORY)),
      setRate: jest.fn().mockReturnValue(of(HISTORY)),
      deleteRate: jest.fn().mockReturnValue(of(HISTORY)),
      createPayout: jest
        .fn()
        .mockReturnValue(
          of(payout({ id: 'p2', direction: 'TAKEAWAY_TO_BRAND', amountCents: 750, periodFrom: '2026-09-28' })),
        ),
      markPaid: jest.fn().mockReturnValue(of(payout({ status: 'PAID' }))),
      confirm: jest.fn().mockReturnValue(of(payout({ status: 'CONFIRMED' }))),
      deletePayout: jest.fn().mockReturnValue(of(undefined)),
      takeawayPromos: jest.fn().mockReturnValue(of(NO_PROMOS)),
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

  afterEach(() => jest.restoreAllMocks());

  const el = () => fixture.nativeElement as HTMLElement;
  const squash = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
  const text = () => spaced(el());
  const byTestId = (id: string) => el().querySelector(`[data-testid="${id}"]`);
  const textOf = (id: string) => spaced(byTestId(id));
  const button = (label: string, scope: ParentNode = el()) =>
    Array.from(scope.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as
      | HTMLButtonElement
      | undefined;
  const click = (label: string, scope?: ParentNode) => {
    const found = button(label, scope);
    if (!found) throw new Error(`no button «${label}»`);
    found.click();
    fixture.detectChanges();
  };
  const type = (selector: string, value: string) => {
    const input = el().querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`no input ${selector}`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const row = () => el().querySelector('[data-testid="settlement-row"]') as HTMLElement;

  describe("Maxim's three figures and the result", () => {
    it('shows the platform admin card money, compensation by promos and by points, the commission and the net', async () => {
      await render('SUPER_ADMIN');

      const lastCall = api.report.mock.calls.at(-1)?.[0];
      expect(lastCall).toMatchObject({ brandId: 'b1', currency: null });
      expect(text()).toContain('Расчёты с брендами');

      expect(textOf('figure-card')).toContain('Всего оплачено картами 120 руб.');
      expect(textOf('figure-card')).toContain('эти деньги сразу приходят бренду');
      expect(textOf('figure-compensation')).toContain('Компенсация takeAway 30 руб.');
      expect(textOf('figure-compensation-promo')).toBe('по акциям 10 руб.');
      expect(textOf('figure-compensation-points')).toBe('по баллам 20 руб.');
      expect(textOf('figure-commission')).toContain('Комиссия takeAway · 15');
      expect(textOf('figure-commission')).toContain('22,50 руб.');
      expect(textOf('figure-commission')).toContain('с полной цены заказа — оплата картой + компенсация: с 150 руб.');
      expect(textOf('figure-net')).toContain('К взаиморасчёту');
      expect(textOf('figure-net')).toContain('takeAway должен бренду 7,50 руб.');
      expect(byTestId('figure-net')?.getAttribute('data-sign')).toBe('negative');
    });

    it('words the same figures for the brand owner', async () => {
      await render('BRAND_ADMIN');

      expect(text()).toContain('Расчёты');
      expect(text()).not.toContain('Расчёты с брендами');
      expect(textOf('figure-card')).toContain('эти деньги сразу приходят вам');
      expect(textOf('figure-net')).toContain('takeAway должен вам 7,50 руб.');
    });

    it('says who owes whom when the commission is larger, and «В расчёте» at zero', async () => {
      await render('BRAND_ADMIN', report({ totals: { ...totals, netCents: 1250 } }));
      expect(textOf('figure-net')).toContain('Вы должны takeAway 12,50 руб.');

      await render('SUPER_ADMIN', report({ totals: { ...totals, netCents: 1250 } }));
      expect(textOf('figure-net')).toContain('Бренд должен takeAway 12,50 руб.');

      await render('SUPER_ADMIN', report({ totals: { ...totals, netCents: 0 } }));
      expect(textOf('figure-net')).toContain('В расчёте');
    });

    it('keeps the breakdown of sales, brand promo codes, gift cards and points', async () => {
      await render('SUPER_ADMIN', report({ totals: { ...totals, promoDiscountCents: 500, giftCardCents: 1000 } }));
      expect(textOf('settlement-breakdown')).toBe(
        'Продажи 150 руб. · промокоды бренда −5 руб. · подарочные карты −10 руб. · баллы −20 руб.',
      );
      expect(text()).toContain('за счёт бренда');
    });

    it('leaves out what is zero', async () => {
      await render('SUPER_ADMIN');
      expect(textOf('settlement-breakdown')).toBe('Продажи 150 руб. · баллы −20 руб.');
      expect(text()).not.toContain('за счёт бренда');
    });

    it('explains orders paid at the counter and orders at 0', async () => {
      await render(
        'BRAND_ADMIN',
        report({ totals: { ...totals, zeroTotalOrders: 1, unpaidOrders: 2, unpaidTotalCents: 4000 } }),
      );
      expect(text()).toContain('Заказов на 0');
      expect(text()).toContain('Принятых заказов без оплаты картой: 2 на 40 руб.');
      expect(text()).toContain('Комиссия с них не берётся');
    });

    it('replaces «к выплате» with compensation and net columns in the daily table', async () => {
      await render('SUPER_ADMIN');
      const headers = Array.from(el().querySelectorAll('[data-testid="settlement-days"] thead th')).map((th) =>
        th.textContent?.trim(),
      );
      expect(headers).toEqual([
        'Дата',
        'Заказы',
        'Продажи',
        'Промокоды бренда',
        'Подарочные карты',
        'Доставка',
        'Оплачено картами',
        'Компенсация по акциям',
        'Компенсация по баллам',
        'Комиссия',
        'К взаиморасчёту',
      ]);
      const total = spaced(el().querySelector('[data-testid="settlement-days"] tfoot'));
      expect(total.endsWith('−7,50 руб.')).toBe(true);
      expect(text()).toContain('плюс — бренд должен takeAway, минус — takeAway должен бренду');
      expect(text()).not.toContain('К выплате');
    });
  });

  describe('balance', () => {
    it('words each signed figure: what is owed, what settled, what waits', async () => {
      await render(
        'BRAND_ADMIN',
        report({
          balance: {
            openingCents: 1500,
            netCents: -750,
            settledCents: 1500,
            openCents: -300,
            closingCents: -750,
            closingOpenCents: -300,
          },
        }),
      );
      expect(textOf('balance-opening')).toBe('Вы должны takeAway 15 руб.');
      expect(textOf('balance-net')).toBe('takeAway должен вам 7,50 руб.');
      expect(textOf('balance-settled')).toBe('Бренд → takeAway 15 руб.');
      expect(textOf('balance-open')).toBe('takeAway → бренду 3 руб.');
      expect(textOf('balance-closing')).toBe('takeAway должен вам 7,50 руб.');
      expect(textOf('balance-closing-open')).toContain('takeAway → бренду 3 руб.');
      expect(textOf('settlement-balance')).toContain('только когда получатель подтвердил «Получено»');
    });

    it('says «нет» for nothing settled', async () => {
      await render('SUPER_ADMIN', report({ balance: { ...report().balance, settledCents: 0, closingOpenCents: 0 } }));
      expect(textOf('balance-settled')).toBe('нет');
      expect(byTestId('balance-closing-open')).toBeNull();
    });
  });

  describe('«Взаиморасчёт» on offer', () => {
    it('lets the platform admin fix it, with its direction and breakdown', async () => {
      await render('SUPER_ADMIN');

      expect(textOf('payout-summary')).toBe('takeAway платит бренду 7,50 руб.');
      expect(textOf('payout-breakdown')).toBe(
        'комиссия 22,50 руб. − компенсация по акциям 10 руб. − компенсация по баллам 20 руб. = −7,50 руб.',
      );
      expect(textOf('settlement-payout')).toContain('Оплачено картами за эти дни: 120 руб. — эти деньги уже у бренда.');

      type('.st-payout-form input', 'ПП-15');
      click('Зафиксировать взаиморасчёт');

      expect(api.createPayout).toHaveBeenCalledWith({
        brandId: 'b1',
        currency: 'RUP',
        to: '2026-10-04',
        reference: 'ПП-15',
        comment: undefined,
      });
      expect(text()).toContain('Взаиморасчёт зафиксирован: takeAway платит бренду 7,50 руб.');
      expect(api.report).toHaveBeenCalledTimes(2);
    });

    it('shows what it carries over from earlier periods', async () => {
      await render('SUPER_ADMIN', report({ nextPayout: { ...NEXT, netCents: -550, amountCents: 550 } }));
      expect(textOf('payout-breakdown')).toContain('= −7,50 руб. · перенос из прошлых периодов +2 руб.');
    });

    it('shows the brand owner the same settlement read-only', async () => {
      await render('BRAND_ADMIN');

      expect(textOf('payout-summary')).toBe('takeAway платит вам 7,50 руб.');
      expect(byTestId('payout-breakdown')).not.toBeNull();
      expect(textOf('payout-owner-hint')).toContain('Взаиморасчёты фиксирует takeAway');
      expect(button('Зафиксировать взаиморасчёт')).toBeUndefined();
      expect(button('Сохранить ставку')).toBeUndefined();
    });

    it('says why it cannot be fixed instead of offering the button', async () => {
      await render('SUPER_ADMIN', report({ nextPayout: { ...NEXT, blocked: 'PERIOD_OPEN' } }));
      expect(textOf('payout-blocked')).toContain('Период ещё не закончился');
      expect(button('Зафиксировать взаиморасчёт')).toBeUndefined();
    });

    it('explains a period where commission and compensation cancel out', async () => {
      await render(
        'SUPER_ADMIN',
        report({
          nextPayout: {
            ...NEXT,
            direction: null,
            amountCents: 0,
            netCents: 0,
            commissionCents: 3000,
            blocked: 'NOTHING_DUE',
          },
        }),
      );
      expect(textOf('payout-blocked')).toContain('взаимно погасились — платить никому не нужно');
      expect(textOf('payout-breakdown')).toContain('= 0 руб.');
      expect(button('Зафиксировать взаиморасчёт')).toBeUndefined();
    });

    it('proposes the days up to yesterday when the report reaches today, and says so', async () => {
      await render(
        'SUPER_ADMIN',
        report({
          period: { from: '2026-10-01', to: '2026-10-14', days: 14, timeZone: 'Europe/Chisinau' },
          nextPayout: { ...NEXT, periodFrom: '2026-10-01', periodTo: '2026-10-13' },
        }),
      );
      expect(textOf('payout-closed-days')).toContain('Сегодняшний день ещё не закончился');
      click('Зафиксировать взаиморасчёт');
      expect(api.createPayout).toHaveBeenCalledWith(expect.objectContaining({ to: '2026-10-13' }));
    });

    it('does not ask for a later period when every closed day is settled already', async () => {
      await render(
        'SUPER_ADMIN',
        report({
          period: { from: '2026-10-01', to: '2026-10-14', days: 14, timeZone: 'Europe/Chisinau' },
          nextPayout: { ...NEXT, periodTo: '2026-10-13', blocked: 'OVERLAP', lastSettledDay: '2026-10-13' },
        }),
      );
      expect(textOf('payout-blocked')).toContain('Все закрытые дни уже во взаиморасчётах');
      expect(textOf('payout-blocked')).not.toContain('Выберите период');
    });
  });

  describe('«Взаиморасчёты»', () => {
    it('tells each side where settlements come from while there are none', async () => {
      await render('SUPER_ADMIN', report({ payouts: [] }));
      expect(textOf('payouts-empty')).toContain('Зафиксируйте взаиморасчёт в карточке «Взаиморасчёт» выше');

      await render('BRAND_ADMIN', report({ payouts: [] }));
      expect(textOf('payouts-empty')).toContain('Взаиморасчёты фиксирует takeAway');
    });

    it('lists the period, direction, amount, breakdown and status', async () => {
      await render('SUPER_ADMIN', report({ payouts: [payout({ reference: 'ПП-1', comment: 'за сентябрь' })] }));
      const cells = Array.from(row().querySelectorAll('td')).map((td) => spaced(td));
      expect(cells[1]).toBe('Бренд → takeAway');
      expect(cells[2]).toBe('15 руб.');
      expect(cells[3]).toBe('комиссия 30 руб. − акции 10 руб. − баллы 5 руб.');
      expect(cells[4]).toBe('Ждёт оплаты');
      expect(cells[5]).toBe('ПП-1 · за сентябрь');
    });

    it('asks the brand to pay what it owes and takes the transfer number', async () => {
      await render('BRAND_ADMIN');

      expect(textOf('settlement-waiting')).toContain(
        'Ждёт вашей оплаты: перечислите takeAway 15 руб. за 21 сент. – 27 сент.',
      );
      // The brand pays this one: it cannot confirm or remove it.
      expect(button('Получено', row())).toBeUndefined();
      expect(button('Удалить', row())).toBeUndefined();

      click('Отметить оплату', row());
      type('.st-inline input', 'ПП-77');
      click('Подтвердить', row());

      expect(api.markPaid).toHaveBeenCalledWith('p1', { reference: 'ПП-77' });
      expect(text()).toContain('Оплата отмечена');
    });

    it('lets the platform admin remove the latest pending settlement, or confirm the money early', async () => {
      await render('SUPER_ADMIN');
      expect(byTestId('settlement-waiting')).toBeNull();
      expect(button('Отметить оплату', row())).toBeUndefined();
      expect(button('Получено', row())).toBeDefined();
      // «Не получено» only once the payer said it went out.
      expect(button('Не получено', row())).toBeUndefined();

      jest.spyOn(window, 'confirm').mockReturnValue(true);
      click('Удалить', row());
      expect(api.deletePayout).toHaveBeenCalledWith('p1');
    });

    it('lets the platform admin mark paid what takeAway owes', async () => {
      await render('SUPER_ADMIN', report({ payouts: [payout({ direction: 'TAKEAWAY_TO_BRAND', amountCents: 750 })] }));
      expect(textOf('settlement-waiting')).toContain(
        'Ждёт вашей оплаты: перечислите бренду 7,50 руб. за 21 сент. – 27 сент.',
      );
      click('Отметить оплату', row());
      click('Подтвердить', row());
      expect(api.markPaid).toHaveBeenCalledWith('p1', { reference: undefined });
    });

    describe('the brand receiving a settlement takeAway paid', () => {
      const paid = () =>
        report({
          payouts: [
            payout({
              direction: 'TAKEAWAY_TO_BRAND',
              amountCents: 12000,
              status: 'PAID',
              paidAt: '2026-10-01T09:00:00.000Z',
              reference: 'ПП-9',
            }),
          ],
        });

      it('asks for confirmation and confirms «Получено»', async () => {
        await render('BRAND_ADMIN', paid());

        expect(textOf('settlement-waiting')).toContain(
          'Ждёт вашего подтверждения: takeAway перечислил 120 руб. за 21 сент. – 27 сент.',
        );
        expect(textOf('settlement-status')).toBe('Оплачено — ждёт подтверждения');
        expect(spaced(row())).toContain('оплачено 01.10');

        const ask = jest.spyOn(window, 'confirm').mockReturnValue(true);
        click('Получено', row());

        expect(ask.mock.calls[0]?.[0]).toContain('Это окончательно');
        expect(api.confirm).toHaveBeenCalledWith('p1', { received: true });
        expect(text()).toContain('Получение подтверждено');
      });

      it('does nothing when the owner thinks again', async () => {
        await render('BRAND_ADMIN', paid());
        jest.spyOn(window, 'confirm').mockReturnValue(false);
        click('Получено', row());
        expect(api.confirm).not.toHaveBeenCalled();
      });

      it('sends «Не получено» with a comment', async () => {
        await render('BRAND_ADMIN', paid());

        click('Не получено', row());
        const send = button('Отправить', row());
        expect(send?.disabled).toBe(true);
        type('.st-inline input', 'на счёт не пришло');
        click('Отправить', row());

        expect(api.confirm).toHaveBeenCalledWith('p1', { received: false, comment: 'на счёт не пришло' });
      });
    });

    it('shows the payer a disputed settlement with the comment and lets them pay again', async () => {
      await render(
        'SUPER_ADMIN',
        report({
          payouts: [
            payout({
              direction: 'TAKEAWAY_TO_BRAND',
              amountCents: 750,
              status: 'DISPUTED',
              disputedAt: '2026-10-02T09:00:00.000Z',
              disputeComment: 'на счёт не пришло',
              reference: 'ПП-9',
            }),
          ],
        }),
      );
      expect(textOf('settlement-status')).toBe('Не получено');
      expect(textOf('settlement-dispute')).toBe('“на счёт не пришло”');
      expect(textOf('settlement-waiting')).toContain(
        'Получатель ответил «Не получено» на 7,50 руб. за 21 сент. – 27 сент.: «на счёт не пришло» — проверьте перевод',
      );
      click('Отметить оплату', row());
      // The old transfer number is there to correct.
      expect(el().querySelector<HTMLInputElement>('.st-inline input')?.value).toBe('ПП-9');
    });

    it('closes a confirmed settlement with its date and no actions', async () => {
      await render(
        'BRAND_ADMIN',
        report({ payouts: [payout({ status: 'CONFIRMED', confirmedAt: '2026-10-05T09:00:00.000Z' })] }),
      );
      expect(textOf('settlement-status')).toBe('Получено 05.10');
      expect(row().querySelectorAll('button')).toHaveLength(0);
      expect(byTestId('settlement-waiting')).toBeNull();
    });

    it('words a refusal of the API', async () => {
      await render('BRAND_ADMIN');
      api.markPaid.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 403,
              error: { statusCode: 403, code: 'PAYOUT_NOT_YOUR_SIDE', message: 'The other side pays this settlement' },
            }),
        ),
      );
      click('Отметить оплату', row());
      click('Подтвердить', row());
      expect(squash(el().querySelector('[role="alert"]')?.textContent)).toBe(
        'Этот шаг делает другая сторона взаиморасчёта.',
      );
    });
  });

  it('reads the takeAway promos block for the same brand, currency and period', async () => {
    await render('BRAND_ADMIN');
    expect(api.takeawayPromos).toHaveBeenCalledWith({
      brandId: 'b1',
      currency: 'RUP',
      from: '2026-09-28',
      to: '2026-10-04',
    });
    expect(textOf('stp-empty')).toBe('За этот период заказов по акциям takeAway нет.');
  });
});
