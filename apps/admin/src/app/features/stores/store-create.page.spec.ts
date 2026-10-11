import { Component, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { LeafletMapComponent, type LatLng, type MapMarker } from '@takeaway/ui-kit';
import { of, throwError } from 'rxjs';

import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi, type BrandDto } from '../../core/catalog/admin-catalog.service';
import { GeocodingApi } from '../../core/geocoding/geocoding.api';
import { StoreCreatePage } from './store-create.page';

/** Leaflet needs a real layout; the page only needs the map's inputs and outputs. */
// eslint-disable-next-line @angular-eslint/component-selector -- stands in for the ui-kit map, so it takes its selector
@Component({ selector: 'lib-leaflet-map', standalone: true, template: '' })
class FakeMapComponent {
  readonly markers = input<MapMarker[]>([]);
  readonly center = input<LatLng | null>(null);
  readonly zoom = input(15);
  readonly pickable = input(false);
  readonly markerMoved = output<LatLng>();
}

const BRAND: BrandDto = { id: 'b1', slug: 'noname', name: 'NoName', currency: 'MDL', locale: 'RU', logoUrl: null };

describe('StoreCreatePage', () => {
  let createStore: jest.Mock;
  let uploadStoreImage: jest.Mock;
  let navigate: jest.SpyInstance;

  function make(): StoreCreatePage {
    createStore = jest.fn().mockReturnValue(of({ id: 'store-new' }));
    uploadStoreImage = jest.fn().mockReturnValue(of({ heroImageUrl: 'https://cdn/x.jpg', galleryUrls: [] }));
    TestBed.configureTestingModule({
      imports: [StoreCreatePage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: AdminCatalogApi, useValue: { createStore, uploadStoreImage } },
        { provide: GeocodingApi, useValue: { locate: () => of(null), reverse: () => of(null) } },
        {
          provide: ActiveBrandService,
          useValue: { active: signal(BRAND), loadError: signal(null), refresh: jest.fn() },
        },
      ],
    });
    TestBed.overrideComponent(StoreCreatePage, {
      remove: { imports: [LeafletMapComponent] },
      add: { imports: [FakeMapComponent] },
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(StoreCreatePage);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  function fill(page: StoreCreatePage): void {
    page.form.patchValue({
      name: 'Центр',
      addressLine: 'ул. 25 Октября 50',
      city: 'Тирасполь',
      country: 'MD',
      timezone: 'Europe/Chisinau',
      latitude: 46.835455,
      longitude: 29.609841,
    });
  }

  function file(name: string, type: string, size: number): File {
    const f = new File(['x'], name, { type });
    Object.defineProperty(f, 'size', { value: size });
    return f;
  }

  function pick(page: StoreCreatePage, f: File): void {
    page.onPhotoPicked({ target: { files: [f], value: 'C:\\fakepath' } } as unknown as Event);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    URL.createObjectURL = jest.fn(() => 'blob:preview');
    URL.revokeObjectURL = jest.fn();
  });

  it('creates a coffee shop by default, and a store that sells both when both are ticked', () => {
    const page = make();
    fill(page);
    page.submit();
    expect(createStore).toHaveBeenLastCalledWith(expect.objectContaining({ kinds: ['COFFEE'] }));

    page.form.controls.kinds.controls.FOOD.setValue(true);
    page.submit();
    expect(createStore).toHaveBeenLastCalledWith(expect.objectContaining({ kinds: ['COFFEE', 'FOOD'] }));
  });

  it('does not create a store that sells nothing', () => {
    const page = make();
    fill(page);
    page.form.controls.kinds.setValue({ COFFEE: false, FOOD: false });
    page.submit();
    expect(createStore).not.toHaveBeenCalled();
    expect(page.createError()).toBeTruthy();
  });

  it('uploads the picked photo as the cover right after creating the store', () => {
    const page = make();
    fill(page);
    const photo = file('cafe.jpg', 'image/jpeg', 2 * 1024 * 1024);
    pick(page, photo);
    expect(page.photoPreview()).toBe('blob:preview');

    page.submit();
    expect(uploadStoreImage).toHaveBeenCalledWith('store-new', 'hero', photo);
    expect(navigate).toHaveBeenCalledWith(['/stores', 'store-new']);
  });

  it('refuses a photo that is too big or not a picture before anything is created', () => {
    const page = make();
    pick(page, file('huge.jpg', 'image/jpeg', 6 * 1024 * 1024));
    expect(page.photo()).toBeNull();
    expect(page.photoError()).toContain('5 МБ');

    pick(page, file('menu.pdf', 'application/pdf', 1000));
    expect(page.photo()).toBeNull();
    expect(page.photoError()).toContain('JPG, PNG или WebP');
  });

  it('opens the new store on its photos tab with the reason when the photo fails', () => {
    const page = make();
    fill(page);
    uploadStoreImage.mockReturnValue(throwError(() => ({ status: 503, error: { message: 'down' } })));
    pick(page, file('cafe.png', 'image/png', 1000));
    page.submit();
    expect(navigate).toHaveBeenCalledWith(
      ['/stores', 'store-new'],
      expect.objectContaining({
        queryParams: { tab: 'photos' },
        state: { photoError: expect.stringContaining('Точка создана, но фото не загрузилось') },
      }),
    );
  });
});
