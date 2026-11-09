import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { StoreListItem } from '@takeaway/shared-types';
import { of } from 'rxjs';

import { CatalogService } from '../../core/catalog/catalog.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { TmaHomePage } from './home.page';

const store = (id: string, name: string, extra: Partial<StoreListItem> = {}): StoreListItem => ({
  id,
  brandId: `brand-${id}`,
  slug: id,
  name,
  addressLine: 'Ленина 1',
  city: 'Тирасполь',
  country: 'MD',
  latitude: 46.84,
  longitude: 29.62,
  status: 'OPEN',
  fulfillmentTypes: ['TAKEAWAY'],
  pickupPointType: 'COUNTER',
  busyMeter: 80,
  currentEtaSeconds: 420,
  acceptingOrders: true,
  openNow: true,
  asapBlockedReason: null,
  taxRateBps: 0,
  taxIncludedInPrice: true,
  currency: 'RUP',
  timezone: 'UTC',
  heroImageUrl: null,
  distanceMeters: null,
  ...extra,
});

describe('TmaHomePage — nearby stores', () => {
  async function open(stores: StoreListItem[]) {
    TestBed.configureTestingModule({
      imports: [TmaHomePage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: CatalogService, useValue: { listStores: jest.fn(() => of(stores)) } },
        { provide: RealtimeService, useValue: { onStoreAvailabilityChanged: () => () => undefined } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');

    const fixture = TestBed.createComponent(TmaHomePage);
    fixture.detectChanges();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const card = (name: string): string => {
      const found = Array.from(root.querySelectorAll<HTMLElement>('a')).find((a) => a.textContent?.includes(name));
      if (!found) throw new Error(`no card for ${name}`);
      return found.textContent ?? '';
    };
    return { card };
  }

  it('shows no wait in minutes on a store card, busy or not', async () => {
    const { card } = await open([store('centre', 'Центр', { busyMeter: 10 }), store('balka', 'Балка')]);

    for (const name of ['Центр', 'Балка']) {
      expect(card(name)).not.toMatch(/\d+\s*мин/);
      expect(card(name)).not.toContain('⏱');
    }
    expect(card('Центр')).toContain('Ленина 1');
  });

  it('still says a store is closed or takes pre-orders only', async () => {
    const { card } = await open([
      store('night', 'Ночная', { openNow: false, asapBlockedReason: 'OUTSIDE_HOURS' }),
      store('off', 'Выключена', { status: 'CLOSED', acceptingOrders: false }),
    ]);

    expect(card('Ночная')).toContain('Заказ ко времени');
    expect(card('Выключена')).toContain('Закрыто');
  });
});
