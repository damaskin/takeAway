import { Component, input, output, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { LeafletMapComponent, type LatLng, type MapMarker } from '@takeaway/ui-kit';
import { of } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { AdminCatalogApi, type StoreAdminDto } from '../../core/catalog/admin-catalog.service';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { GeocodingApi } from '../../core/geocoding/geocoding.api';
import { StaffService } from '../../core/staff/staff.service';
import { StoreEditorComponent } from './store-editor.component';

/** Leaflet needs a real layout; the editor only needs the map's inputs and outputs. */
// eslint-disable-next-line @angular-eslint/component-selector -- stands in for the ui-kit map, so it takes its selector
@Component({ selector: 'lib-leaflet-map', standalone: true, template: '' })
class FakeMapComponent {
  readonly markers = input<MapMarker[]>([]);
  readonly center = input<LatLng | null>(null);
  readonly zoom = input(15);
  readonly pickable = input(false);
  readonly markerMoved = output<LatLng>();
}

/** A store as the API sends it: the whole row, the retired `slotCapacity` column included. */
const STORE = {
  id: 'store-1',
  brandId: 'brand-1',
  slug: 'noname-tsentr',
  name: 'Центр',
  addressLine: 'ул. 25 Октября, 1',
  city: 'Тирасполь',
  country: 'MD',
  latitude: 46.8403,
  longitude: 29.6433,
  status: 'OPEN',
  currency: 'MDL',
  timezone: 'Europe/Chisinau',
  workingHours: [],
  fulfillmentTypes: ['TAKEAWAY'],
  pickupPointType: 'COUNTER',
  kinds: ['COFFEE'],
  baseEtaSeconds: 600,
  kitchenParallelism: 3,
  slotCapacity: 8,
  taxRateBps: 0,
  taxIncludedInPrice: true,
  galleryUrls: [],
} as StoreAdminDto;

describe('StoreEditorComponent — «Заказов на 15 минут» is gone (list 5.0, item 6)', () => {
  let fixture: ComponentFixture<StoreEditorComponent>;
  let updateStore: jest.Mock;

  beforeEach(async () => {
    updateStore = jest.fn(() => of(STORE));
    TestBed.configureTestingModule({
      imports: [StoreEditorComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: AdminCatalogApi, useValue: { getStore: () => of(STORE), updateStore } },
        { provide: GeocodingApi, useValue: { locate: () => of(null), reverse: () => of(null) } },
        { provide: AuthStore, useValue: { user: signal({ role: 'BRAND_ADMIN' }) } },
        { provide: FeatureFlagsStore, useValue: { deliveryEnabled: signal(false) } },
        { provide: StaffService, useValue: {} },
      ],
    });
    TestBed.overrideComponent(StoreEditorComponent, {
      remove: { imports: [LeafletMapComponent] },
      add: { imports: [FakeMapComponent] },
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    fixture = TestBed.createComponent(StoreEditorComponent);
    fixture.componentRef.setInput('storeId', 'store-1');
    fixture.detectChanges();
    await fixture.whenStable();
  });

  const root = () => fixture.nativeElement as HTMLElement;

  it('shows no such field, and sums up the slot by kitchen work only', () => {
    expect(root().querySelector('[formcontrolname="slotCapacity"]')).toBeNull();
    expect(root().textContent).not.toContain('Заказов на 15 минут');
    expect(root().querySelector('[data-testid="store-capacity-summary"]')?.textContent?.trim()).toBe(
      'За 15 минут кухня успевает 45 мин работы (например, 15 напитков по 3 мин). Окно, где на новый заказ не ' +
        'хватает этого времени, клиент видит занятым — сколько бы заказов в нём ни было.',
    );
  });

  it('never sends slotCapacity when the store is saved', async () => {
    const editor = fixture.componentInstance;
    editor.detailsForm.controls.kitchenParallelism.setValue(4);
    editor.detailsForm.markAsDirty();

    await editor.save();

    expect(updateStore).toHaveBeenCalledTimes(1);
    const [, payload] = updateStore.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload['kitchenParallelism']).toBe(4);
    expect(payload).not.toHaveProperty('slotCapacity');
  });
});
