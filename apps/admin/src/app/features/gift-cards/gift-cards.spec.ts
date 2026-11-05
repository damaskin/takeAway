import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';

import { API_CONFIG } from '../../core/api/api.config';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { GiftCardFormPage } from './gift-card-form.page';
import type { GiftCardRow } from './gift-card.types';
import { AdminGiftCardsPage } from './gift-cards.page';

const card: GiftCardRow = {
  id: 'gc1',
  code: 'ABCDEFGH',
  brandId: 'b2',
  initialAmountCents: 50_000,
  balanceCents: 50_000,
  currency: 'RUP',
  status: 'ACTIVE',
  recipientEmail: null,
  recipientName: null,
  message: null,
  expiresAt: null,
  createdAt: '2026-11-05T10:00:00Z',
};

describe('Gift cards in the brand cabinet', () => {
  let http: HttpTestingController;
  const activeId = signal<string | null>('b2');

  beforeEach(() => {
    activeId.set('b2');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService(),
        { provide: API_CONFIG, useValue: { baseUrl: '/api' } },
        {
          provide: ActiveBrandService,
          useValue: { activeId, loaded: signal(true), loadError: signal(null), refresh: jest.fn() },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('the list', () => {
    let fixture: ComponentFixture<AdminGiftCardsPage>;

    beforeEach(() => {
      fixture = TestBed.createComponent(AdminGiftCardsPage);
      fixture.detectChanges();
    });

    it('lists the cards of the brand picked in the top bar, and again when it changes', () => {
      http.expectOne({ method: 'GET', url: '/api/admin/gift-cards?brandId=b2' }).flush([card]);
      expect(fixture.componentInstance.rows()).toEqual([card]);

      activeId.set('b1');
      fixture.detectChanges();
      expect(fixture.componentInstance.rows()).toEqual([]);
      http.expectOne({ method: 'GET', url: '/api/admin/gift-cards?brandId=b1' }).flush([]);
    });

    it('asks for a brand instead of listing when none is picked', () => {
      http.expectOne('/api/admin/gift-cards?brandId=b2').flush([]);
      activeId.set(null);
      fixture.detectChanges();

      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('[data-testid="gift-cards-no-brand"]')).not.toBeNull();
      expect(root.querySelector('a[href="/promotions/gift-cards/new"]')).toBeNull();
    });
  });

  describe('issuing a card', () => {
    let fixture: ComponentFixture<GiftCardFormPage>;

    beforeEach(() => {
      fixture = TestBed.createComponent(GiftCardFormPage);
      fixture.detectChanges();
    });

    it('shows RUP as the only currency, with nothing to choose', () => {
      const root = fixture.nativeElement as HTMLElement;
      const currency = root.querySelector<HTMLInputElement>('[data-testid="gift-card-currency"]');
      expect(currency?.value).toBe('RUP');
      expect(currency?.readOnly).toBe(true);
      expect(root.querySelector('select')).toBeNull();
    });

    it('issues in RUP for the brand picked in the top bar', () => {
      const page = fixture.componentInstance;
      page.form.controls.amount.setValue(500);
      page.issue();

      const req = http.expectOne({ method: 'POST', url: '/api/admin/gift-cards?brandId=b2' });
      expect(req.request.body).toEqual({ amountCents: 50_000, currency: 'RUP' });
      req.flush(card);
      expect(page.issued()).toEqual(card);
    });

    it('issues nothing until a brand is picked', () => {
      activeId.set(null);
      fixture.detectChanges();
      const page = fixture.componentInstance;
      page.form.controls.amount.setValue(500);
      page.issue();

      http.expectNone({ method: 'POST' });
      expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')).not.toBeNull();
    });
  });
});
