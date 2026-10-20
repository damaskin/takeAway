import { Component, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { StoreListItem } from '@takeaway/shared-types';
import { LeafletMapComponent, type LatLng, type MapMarker } from '@takeaway/ui-kit';
import { of } from 'rxjs';

import { CatalogService } from '../../core/catalog/catalog.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { StoresListPage } from './stores-list.page';

/** Stands in for the Leaflet map: jsdom draws no tiles, and the page only needs its pin taps. */
@Component({ selector: 'lib-leaflet-map', standalone: true, template: '' })
class FakeMapComponent {
  readonly markers = input<MapMarker[]>([]);
  readonly userPosition = input<LatLng | null>(null);
  readonly markerClicked = output<string>();
}

const store = (id: string, name: string): StoreListItem => ({
  id,
  brandId: 'brand-1',
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
  busyMeter: 0,
  currentEtaSeconds: 300,
  acceptingOrders: true,
  openNow: true,
  asapBlockedReason: null,
  taxRateBps: 0,
  taxIncludedInPrice: true,
  currency: 'RUP',
  timezone: 'UTC',
  heroImageUrl: null,
  distanceMeters: null,
});

const STORES = [store('store-1', 'Центр'), store('store-2', 'Балка'), store('store-3', 'Кировский')];

describe('StoresListPage — a pin tapped on the map', () => {
  let scrolled: Array<{ id: string | null; options: ScrollIntoViewOptions | undefined }>;

  async function open() {
    scrolled = [];
    // jsdom does not lay out or scroll; record what the page asked for.
    Element.prototype.scrollIntoView = function (this: Element, options?: boolean | ScrollIntoViewOptions) {
      scrolled.push({
        id: this.getAttribute('data-store-id'),
        options: typeof options === 'object' ? options : undefined,
      });
    };
    TestBed.configureTestingModule({
      imports: [StoresListPage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: CatalogService, useValue: { listStores: jest.fn(() => of(STORES)) } },
        { provide: RealtimeService, useValue: { onStoreAvailabilityChanged: () => () => undefined } },
      ],
    });
    TestBed.overrideComponent(StoresListPage, {
      remove: { imports: [LeafletMapComponent] },
      add: { imports: [FakeMapComponent] },
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');

    const fixture = TestBed.createComponent(StoresListPage);
    fixture.detectChanges();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const map = fixture.debugElement.query((el) => el.componentInstance instanceof FakeMapComponent)
      .componentInstance as FakeMapComponent;
    return { fixture, root, map, page: fixture.componentInstance };
  }

  it('selects the store and brings its card into view', async () => {
    const { fixture, map, page, root } = await open();
    expect(scrolled).toEqual([]);

    map.markerClicked.emit('store-3');
    await fixture.whenStable();

    expect(page.selectedId()).toBe('store-3');
    expect(scrolled).toEqual([{ id: 'store-3', options: { behavior: 'smooth', block: 'nearest' } }]);
    const card = root.querySelector('[data-store-id="store-3"]') as HTMLElement;
    expect(card.textContent).toContain('Заказать отсюда');
  });

  it('does not scroll when a card is selected by hovering it', async () => {
    const { fixture, page, root } = await open();
    root.querySelector('[data-store-id="store-2"]')?.dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();

    expect(page.selectedId()).toBe('store-2');
    expect(scrolled).toEqual([]);
  });
});
