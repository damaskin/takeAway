import { TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import type { LatLng } from '@takeaway/ui-kit';
import { type Observable, Subject, of, throwError } from 'rxjs';

import {
  type AddressSuggestion,
  GeocodingApi,
  type GeocodeQuery,
  type GeocodeResult,
} from '../../core/geocoding/geocoding.api';
import { AddressLocator, LOCATE_DEBOUNCE_MS, geocodeQueryOf } from './address-locator';

const FOUND: GeocodeResult = {
  lat: 46.8354554,
  lng: 29.6098413,
  displayName: 'Покровская улица, 50, Тирасполь, Молдова',
  approximate: false,
};

describe('geocodeQueryOf', () => {
  it('waits for a few letters, trims, and keeps a country only when it is a two-letter code', () => {
    expect(geocodeQueryOf({ addressLine: 'ул', city: 'Тирасполь', country: 'MD' })).toBeNull();
    expect(geocodeQueryOf({ addressLine: ' ул.  25 Октября 50 ', city: ' Тирасполь ', country: 'md' })).toEqual({
      address: 'ул. 25 Октября 50',
      city: 'Тирасполь',
      country: 'MD',
    });
    expect(geocodeQueryOf({ addressLine: 'Marina Walk', city: '', country: 'U' })).toEqual({ address: 'Marina Walk' });
  });
});

describe('AddressLocator', () => {
  let locate: jest.Mock<Observable<GeocodeResult | null>, [GeocodeQuery]>;
  let reverse: jest.Mock<Observable<AddressSuggestion | null>, [number, number]>;
  let placed: LatLng[];
  let controls: { addressLine: FormControl<string>; city: FormControl<string>; country: FormControl<string> };

  function setUp(pinned = false, address = { addressLine: '', city: 'Тирасполь', country: 'MD' }): AddressLocator {
    jest.useFakeTimers();
    locate = jest.fn().mockReturnValue(of(FOUND));
    reverse = jest.fn().mockReturnValue(of(null));
    placed = [];
    controls = {
      addressLine: new FormControl(address.addressLine, { nonNullable: true }),
      city: new FormControl(address.city, { nonNullable: true }),
      country: new FormControl(address.country, { nonNullable: true }),
    };
    TestBed.configureTestingModule({
      providers: [AddressLocator, { provide: GeocodingApi, useValue: { locate, reverse } }],
    });
    const locator = TestBed.inject(AddressLocator);
    locator.connect(controls, { pinned, place: (p) => placed.push(p) });
    return locator;
  }

  afterEach(() => jest.useRealTimers());

  it('puts the pin on the typed address once the typing pauses, and says what it found', () => {
    const locator = setUp();
    controls.addressLine.setValue('ул. 25 Октя');
    jest.advanceTimersByTime(200);
    controls.addressLine.setValue('ул. 25 Октября 50');
    expect(locate).not.toHaveBeenCalled();

    jest.advanceTimersByTime(LOCATE_DEBOUNCE_MS);
    expect(locate).toHaveBeenCalledTimes(1);
    expect(locate).toHaveBeenCalledWith({ address: 'ул. 25 Октября 50', city: 'Тирасполь', country: 'MD' });
    expect(placed).toEqual([{ lat: FOUND.lat, lng: FOUND.lng }]);
    expect(locator.status()).toBe('found');
    expect(locator.foundName()).toBe(FOUND.displayName);
  });

  it('looks up at once when a field is left, and not again for the same address', () => {
    setUp();
    controls.addressLine.setValue('ул. 25 Октября 50');
    TestBed.inject(AddressLocator).flush();
    expect(locate).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(LOCATE_DEBOUNCE_MS);
    expect(locate).toHaveBeenCalledTimes(1);

    controls.city.setValue('Бендеры');
    jest.advanceTimersByTime(LOCATE_DEBOUNCE_MS);
    expect(locate).toHaveBeenCalledTimes(2);
  });

  it('opens the map on the city without placing the pin when only the city was found', () => {
    const locator = setUp();
    locate.mockReturnValue(of({ lat: 46.85, lng: 29.6, displayName: 'Тирасполь, Молдова', approximate: true }));
    controls.addressLine.setValue('ул. Несуществующая 1');
    jest.advanceTimersByTime(LOCATE_DEBOUNCE_MS);
    expect(placed).toEqual([]);
    expect(locator.area()).toEqual({ lat: 46.85, lng: 29.6 });
    expect(locator.status()).toBe('approximate');
  });

  it('asks for the pin by hand when nothing was found or the lookup failed', () => {
    const locator = setUp();
    locate.mockReturnValue(of(null));
    controls.addressLine.setValue('Nowhere 1');
    jest.advanceTimersByTime(LOCATE_DEBOUNCE_MS);
    expect(locator.status()).toBe('notFound');

    locate.mockReturnValue(throwError(() => ({ status: 503 })));
    controls.addressLine.setValue('Nowhere 2');
    jest.advanceTimersByTime(LOCATE_DEBOUNCE_MS);
    expect(locator.status()).toBe('unavailable');
    expect(placed).toEqual([]);
  });

  it('leaves a pin put by hand alone while the address is typed, until «Найти по адресу»', () => {
    const locator = setUp();
    locator.pinnedByHand({ lat: 46.84, lng: 29.61 });
    expect(locator.status()).toBe('manual');

    controls.addressLine.setValue('ул. 25 Октября 50');
    jest.advanceTimersByTime(LOCATE_DEBOUNCE_MS);
    expect(locate).not.toHaveBeenCalled();
    expect(locator.status()).toBe('addressChanged');

    locator.locateNow();
    expect(locate).toHaveBeenCalledTimes(1);
    expect(placed).toEqual([{ lat: FOUND.lat, lng: FOUND.lng }]);
    expect(locator.status()).toBe('found');
  });

  it('starts pinned for a store that already has a place: typing only offers to look it up', () => {
    const locator = setUp(true, { addressLine: 'ул. 25 Октября 1', city: 'Тирасполь', country: 'MD' });
    controls.addressLine.setValue('ул. 25 Октября 50');
    jest.advanceTimersByTime(LOCATE_DEBOUNCE_MS);
    expect(locate).not.toHaveBeenCalled();
    expect(locator.status()).toBe('addressChanged');
  });

  it('fills an empty address from a pin dropped on the map, and does not look that address up again', () => {
    const locator = setUp();
    reverse.mockReturnValue(
      of({ ...FOUND, addressLine: 'Покровская улица, 50', city: 'Тирасполь', country: 'MD' } as AddressSuggestion),
    );
    controls.city.setValue('');
    controls.country.setValue('');
    locator.pinnedByHand({ lat: 46.8354, lng: 29.6098 });

    expect(reverse).toHaveBeenCalledWith(46.8354, 29.6098);
    expect(controls.addressLine.value).toBe('Покровская улица, 50');
    expect(controls.city.value).toBe('Тирасполь');
    expect(controls.country.value).toBe('MD');
    expect(locator.suggested()).toBe(true);
    jest.advanceTimersByTime(LOCATE_DEBOUNCE_MS);
    expect(locate).not.toHaveBeenCalled();
    expect(locator.status()).toBe('manual');
  });

  it('does not touch an address the owner already typed when the pin moves', () => {
    const locator = setUp(false, { addressLine: 'ул. 25 Октября 50', city: 'Тирасполь', country: 'MD' });
    locator.pinnedByHand({ lat: 46.8354, lng: 29.6098 });
    expect(reverse).not.toHaveBeenCalled();
    expect(controls.addressLine.value).toBe('ул. 25 Октября 50');
  });

  it('ignores an answer that arrives after the owner put the pin by hand', () => {
    const locator = setUp();
    const pending = new Subject<GeocodeResult | null>();
    locate.mockReturnValue(pending);
    controls.addressLine.setValue('ул. 25 Октября 50');
    jest.advanceTimersByTime(LOCATE_DEBOUNCE_MS);
    expect(locator.status()).toBe('searching');
    locator.pinnedByHand({ lat: 1, lng: 2 });
    pending.next(FOUND);
    expect(placed).toEqual([]);
    expect(locator.status()).toBe('manual');
  });
});
