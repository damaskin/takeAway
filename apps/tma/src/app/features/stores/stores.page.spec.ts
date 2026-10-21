import { Component, input, output } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { StoreListItem } from '@takeaway/shared-types';
import { LeafletMapComponent, type LatLng, type MapMarker } from '@takeaway/ui-kit';
import { of } from 'rxjs';

import { CatalogService } from '../../core/catalog/catalog.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { type DeviceLocation, TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';
import { TmaStoresPage } from './stores.page';

/** The map without Leaflet: what it was given, and a pin the test can tap. */
// eslint-disable-next-line @angular-eslint/component-selector -- stands in for the ui-kit map
@Component({ selector: 'lib-leaflet-map', standalone: true, template: '' })
class FakeMapComponent {
  readonly markers = input<MapMarker[]>([]);
  readonly userPosition = input<LatLng | null>(null);
  readonly markerClicked = output<string>();
}

function store(id: string, name: string, addressLine: string, distanceMeters: number | null = null): StoreListItem {
  return {
    id,
    brandId: 'brand-1',
    slug: id,
    name,
    addressLine,
    city: 'Тирасполь',
    country: 'MD',
    latitude: 46.84,
    longitude: 29.62,
    status: 'OPEN',
    fulfillmentTypes: ['TAKEAWAY'],
    pickupPointType: 'COUNTER',
    busyMeter: 0,
    currentEtaSeconds: 300,
    acceptingOrders: true,
    openNow: true,
    asapBlockedReason: null,
    opensAt: null,
    closesAt: null,
    taxRateBps: 0,
    taxIncludedInPrice: true,
    currency: 'RUP',
    timezone: 'UTC',
    heroImageUrl: null,
    distanceMeters,
  };
}

const STORES = [store('centre', 'NoName Centre', 'ул. Ленина 1'), store('balka', 'NoName Балка', 'ул. Юности 5')];

describe('TmaStoresPage', () => {
  let fixture: ComponentFixture<TmaStoresPage>;
  let listStores: jest.Mock;
  let located: DeviceLocation;
  const openLocationSettings = jest.fn();

  beforeEach(async () => {
    located = { kind: 'ok', lat: 46.83, lng: 29.6 };
    listStores = jest.fn((query?: { lat?: number }) =>
      of(
        query?.lat
          ? [
              store('centre', 'NoName Centre', 'ул. Ленина 1', 2400),
              store('balka', 'NoName Балка', 'ул. Юности 5', 350),
            ]
          : STORES,
      ),
    );
    openLocationSettings.mockClear();
    TestBed.configureTestingModule({
      imports: [TmaStoresPage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: CatalogService, useValue: { listStores } },
        { provide: RealtimeService, useValue: { onStoreAvailabilityChanged: () => () => undefined } },
        {
          provide: TelegramBridgeService,
          useValue: {
            haptic: jest.fn(),
            requestLocation: () => Promise.resolve(located),
            openLocationSettings,
          },
        },
      ],
    });
    TestBed.overrideComponent(TmaStoresPage, {
      remove: { imports: [LeafletMapComponent] },
      add: { imports: [FakeMapComponent] },
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    fixture = TestBed.createComponent(TmaStoresPage);
    await fixture.whenStable();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const cards = () =>
    Array.from(el().querySelectorAll<HTMLElement>('[id^="tma-store-"]')).map((c) => ({
      id: c.id.replace('tma-store-', ''),
      selected: c.hasAttribute('data-selected'),
    }));
  const map = () =>
    fixture.debugElement.query((d) => d.componentInstance instanceof FakeMapComponent)
      .componentInstance as FakeMapComponent;

  it('narrows the list and the map to what was typed', async () => {
    const search = el().querySelector<HTMLInputElement>('[data-testid="store-search"]');
    if (!search) throw new Error('no search');
    search.value = 'юности';
    search.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(cards().map((c) => c.id)).toEqual(['balka']);
    expect(
      map()
        .markers()
        .map((m) => m.id),
    ).toEqual(['balka']);
  });

  // A tap on a pin used to do nothing; the first card was always the highlighted one.
  it('picks the store whose pin was tapped', async () => {
    expect(cards()).toEqual([
      { id: 'centre', selected: true },
      { id: 'balka', selected: false },
    ]);
    const scrollIntoView = jest.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    jest.useFakeTimers();
    map().markerClicked.emit('balka');
    jest.runAllTimers();
    jest.useRealTimers();
    Element.prototype.scrollIntoView = original;
    await fixture.whenStable();
    expect(cards()).toEqual([
      { id: 'centre', selected: false },
      { id: 'balka', selected: true },
    ]);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  });

  it('lists the stores from where the customer is, nearest first', async () => {
    el().querySelector<HTMLButtonElement>('[data-testid="near-me"]')?.click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(listStores).toHaveBeenLastCalledWith({ lat: 46.83, lng: 29.6 });
    expect(cards()).toEqual([
      { id: 'balka', selected: true },
      { id: 'centre', selected: false },
    ]);
    expect(map().userPosition()).toEqual({ lat: 46.83, lng: 29.6 });
    expect(el().textContent).toContain('350');
  });

  it('says a paused store is on a break and still takes orders for later', async () => {
    listStores.mockReturnValue(
      of([
        {
          ...store('centre', 'NoName Centre', 'ул. Ленина 1'),
          openNow: false,
          asapBlockedReason: 'PAUSED',
          pausedUntil: '2026-10-20T12:30:00Z',
          pauseReason: 'EQUIPMENT',
        },
      ]),
    );
    fixture = TestBed.createComponent(TmaStoresPage);
    await fixture.whenStable();
    expect(el().querySelector('[data-testid="store-hours"]')?.textContent?.trim()).toBe(
      '🕘 Технический перерыв до 12:30 · можно заказать ко времени',
    );
  });

  it('offers Telegram’s settings when location was refused there', async () => {
    located = { kind: 'denied', canOpenSettings: true };
    el().querySelector<HTMLButtonElement>('[data-testid="near-me"]')?.click();
    await fixture.whenStable();
    await fixture.whenStable();
    const note = el().querySelector('[data-testid="location-note"]');
    expect(note?.textContent).toContain('Разрешите его в настройках Telegram');
    note?.querySelector('button')?.click();
    expect(openLocationSettings).toHaveBeenCalled();
  });
});
