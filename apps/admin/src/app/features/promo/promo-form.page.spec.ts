import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { Promo } from '@takeaway/shared-types';
import { of } from 'rxjs';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi } from '../../core/catalog/admin-catalog.service';
import { AdminPromoApi } from '../../core/promo/promo.service';
import { PromoFormPage } from './promo-form.page';

const DAY = 24 * 60 * 60_000;
const promo = (over: Partial<Promo>): Promo => ({
  id: 'p1',
  brandId: 'b1',
  code: 'WINTER5',
  label: 'Зимние',
  type: 'PERCENT',
  value: 10,
  minSubtotalCents: null,
  maxRedemptions: 0,
  perUserLimit: 0,
  startsAt: new Date(Date.now() + DAY).toISOString(),
  endsAt: new Date(Date.now() + 7 * DAY).toISOString(),
  status: 'DRAFT',
  currency: 'RUP',
  redemptionsCount: 0,
  inactiveDays: null,
  segmentStoreId: null,
  ...over,
});

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('PromoFormPage', () => {
  let api: { get: jest.Mock; create: jest.Mock; update: jest.Mock };

  async function render(promoId?: string, existing?: Promo): Promise<ComponentFixture<PromoFormPage>> {
    api = {
      get: jest.fn(() => of(existing)),
      create: jest.fn((input: Partial<Promo>) => of(promo({ ...input, id: 'new' }))),
      update: jest.fn((id: string, input: Partial<Promo>) => of(promo({ ...existing, ...input, id }))),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PromoFormPage],
      providers: [
        // Saving goes back to the list; any address will do here.
        provideRouter([{ path: '**', children: [] }]),
        provideTranslateService(),
        { provide: AdminPromoApi, useValue: api },
        { provide: AdminCatalogApi, useValue: { listStores: jest.fn(() => of([])) } },
        {
          provide: ActiveBrandService,
          useValue: { activeId: signal('b1'), loaded: signal(true), refresh: jest.fn() },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(PromoFormPage);
    if (promoId) fixture.componentRef.setInput('promoId', promoId);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const root = (fixture: ComponentFixture<PromoFormPage>) => fixture.nativeElement as HTMLElement;

  it('is titled «Новый промокод» and offers no type to choose — a new code is percent off', async () => {
    const fixture = await render();

    expect(text(root(fixture).querySelector('h1'))).toBe('Новый промокод');
    expect(root(fixture).querySelector('[data-testid="promo-type"]')).toBeNull();
    const selects = [...root(fixture).querySelectorAll('select')].map((s) => s.getAttribute('formcontrolname'));
    expect(selects).not.toContain('type');
    expect(text(root(fixture).querySelector('[data-testid="promo-value"]')?.closest('label'))).toBe('Скидка, %');
  });

  it('creates the code as a percent off, within 1–100', async () => {
    const fixture = await render();
    const page = fixture.componentInstance;
    page.form.patchValue({ code: 'welcome10', label: 'Добро пожаловать', value: 120 });
    expect(page.form.invalid).toBe(true);

    page.form.patchValue({ value: 10 });
    page.submit();
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'WELCOME10', type: 'PERCENT', value: 10, brandId: 'b1' }),
    );
  });

  it('keeps an older non-percent code in its own type, shown but not chosen', async () => {
    const fixture = await render('p1', promo({ type: 'FIXED', value: 500 }));

    expect(text(root(fixture).querySelector('h1'))).toBe('Промокод WINTER5');
    const type = root(fixture).querySelector<HTMLInputElement>('[data-testid="promo-type"]');
    expect(type?.value).toBe('Фиксированная скидка (центы)');
    expect(type?.readOnly).toBe(true);

    fixture.componentInstance.submit();
    expect(api.update).toHaveBeenCalledWith('p1', expect.objectContaining({ type: 'FIXED', value: 500 }));
  });
});
