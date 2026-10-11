import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { FormControl } from '@angular/forms';
import type { LatLng } from '@takeaway/ui-kit';
import { Subject, catchError, debounceTime, map, merge, of, switchMap } from 'rxjs';

import { type AddressSuggestion, GeocodingApi, type GeocodeQuery } from '../../core/geocoding/geocoding.api';

/** Long enough to let a word be finished, short enough to feel like it follows the typing. */
export const LOCATE_DEBOUNCE_MS = 700;

/**
 * Where the lookup stands, for the line under the map:
 *  - `idle` — nothing asked yet;
 *  - `searching` — waiting for the answer;
 *  - `found` — the pin was put on the address;
 *  - `approximate` — only the city was found; the map opened there, no pin;
 *  - `notFound` / `unavailable` — place the pin by hand;
 *  - `manual` — the owner put the pin themselves; typing no longer moves it;
 *  - `addressChanged` — …and has since changed the address: offer to look it up.
 */
export type LocatorStatus =
  | 'idle'
  | 'searching'
  | 'found'
  | 'approximate'
  | 'notFound'
  | 'unavailable'
  | 'manual'
  | 'addressChanged';

export interface AddressControls {
  addressLine: FormControl<string>;
  city: FormControl<string>;
  country: FormControl<string>;
}

export interface LocatorOptions {
  /** Put the store pin here — the form's latitude and longitude. */
  place(point: LatLng): void;
  /** The store already has a pin: the address typed from now on does not move it. */
  pinned: boolean;
}

/** The lookup for the address fields as they are now; null while there is too little to look up. */
export function geocodeQueryOf(values: { addressLine: string; city: string; country: string }): GeocodeQuery | null {
  const address = values.addressLine.replace(/\s+/g, ' ').trim();
  if (address.length < 3) return null;
  const city = values.city.replace(/\s+/g, ' ').trim();
  const country = values.country.trim().toUpperCase();
  return {
    address,
    ...(city ? { city } : {}),
    ...(/^[A-Z]{2}$/.test(country) ? { country } : {}),
  };
}

/** Same address, same key — case and spacing do not count. */
function keyOf(query: GeocodeQuery | null): string {
  return query ? [query.address, query.city ?? '', query.country ?? ''].join('|').toLowerCase() : '';
}

/**
 * Makes the store form's map follow the typed address.
 *
 * Owners used to type the address and then hunt for the same street on the
 * map. Now the address, city and country are looked up as they are typed
 * (debounced, and at once when a field is left) and the pin goes there. The
 * pin stays draggable; once the owner has moved it, typing leaves it alone
 * until they press «Найти по адресу». A pin dropped before any address is
 * typed fills the empty address fields from the map instead.
 *
 * Provided per form component.
 */
@Injectable()
export class AddressLocator {
  private readonly api = inject(GeocodingApi);
  private readonly destroyRef = inject(DestroyRef);

  readonly status = signal<LocatorStatus>('idle');
  /** What the last lookup found, for «Нашли: …». */
  readonly foundName = signal<string | null>(null);
  /** Where to open the map when only the city was found. */
  readonly area = signal<LatLng | null>(null);
  /** The address fields were filled from the pin — worth a "check it" note. */
  readonly suggested = signal(false);

  private controls: AddressControls | null = null;
  private place: (point: LatLng) => void = () => undefined;
  private pinned = false;
  /** The address the pin stands for: no second lookup of the same one. */
  private lastKey = '';
  private readonly lookups = new Subject<GeocodeQuery>();
  private readonly reverseLookups = new Subject<LatLng>();

  connect(controls: AddressControls, options: LocatorOptions): void {
    this.controls = controls;
    this.place = options.place;
    this.reset(options.pinned);

    merge(controls.addressLine.valueChanges, controls.city.valueChanges, controls.country.valueChanges)
      .pipe(debounceTime(LOCATE_DEBOUNCE_MS), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.follow());

    this.lookups
      .pipe(
        switchMap((query) =>
          this.api.locate(query).pipe(
            map((result) => ({ ok: true as const, result })),
            catchError(() => of({ ok: false as const, result: null })),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ ok, result }) => {
        // The owner put the pin by hand while we were asking: theirs wins.
        if (this.pinned) return;
        if (!ok) {
          this.status.set('unavailable');
          return;
        }
        if (!result) {
          this.status.set('notFound');
          this.foundName.set(null);
          return;
        }
        this.foundName.set(result.displayName);
        if (result.approximate) {
          this.area.set({ lat: result.lat, lng: result.lng });
          this.status.set('approximate');
          return;
        }
        this.area.set(null);
        this.place({ lat: result.lat, lng: result.lng });
        this.status.set('found');
      });

    this.reverseLookups
      .pipe(
        switchMap((point) => this.api.reverse(point.lat, point.lng).pipe(catchError(() => of(null)))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((suggestion) => this.fillFrom(suggestion));
  }

  /**
   * Start over after the form was (re)loaded: `pinned` when the store
   * already has a location. The address as loaded counts as looked up.
   */
  reset(pinned: boolean): void {
    this.pinned = pinned;
    this.lastKey = keyOf(this.query());
    this.status.set('idle');
    this.foundName.set(null);
    this.area.set(null);
    this.suggested.set(false);
  }

  /** An address field was left: look it up now rather than after the pause. */
  flush(): void {
    this.follow();
  }

  /** «Найти по адресу»: look the address up and move the pin, even one put by hand. */
  locateNow(): void {
    this.pinned = false;
    this.lookup(true);
  }

  /**
   * The owner moved the pin (dragged it, clicked the map or typed the
   * coordinates). With no address typed yet, the map suggests one.
   */
  pinnedByHand(point: LatLng | null): void {
    this.pinned = true;
    this.status.set('manual');
    this.foundName.set(null);
    this.area.set(null);
    if (point && this.controls && !this.controls.addressLine.value.trim()) this.reverseLookups.next(point);
  }

  /** There is something to look up. */
  canLocate(): boolean {
    return this.query() !== null;
  }

  private follow(): void {
    if (this.pinned) {
      // The pin stays; just say that it no longer matches what was typed.
      if (this.query() && keyOf(this.query()) !== this.lastKey) this.status.set('addressChanged');
      return;
    }
    this.lookup(false);
  }

  private lookup(force: boolean): void {
    const query = this.query();
    const key = keyOf(query);
    if (!query) {
      this.lastKey = '';
      this.status.set('idle');
      this.foundName.set(null);
      return;
    }
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    this.status.set('searching');
    this.lookups.next(query);
  }

  private fillFrom(suggestion: AddressSuggestion | null): void {
    const controls = this.controls;
    if (!controls || !suggestion?.addressLine || controls.addressLine.value.trim()) return;
    controls.addressLine.setValue(suggestion.addressLine);
    controls.addressLine.markAsDirty();
    if (suggestion.city && !controls.city.value.trim()) {
      controls.city.setValue(suggestion.city);
      controls.city.markAsDirty();
    }
    if (suggestion.country && !controls.country.value.trim()) {
      controls.country.setValue(suggestion.country);
      controls.country.markAsDirty();
    }
    // The pin is where the owner put it; the filled-in address describes it.
    this.lastKey = keyOf(this.query());
    this.suggested.set(true);
  }

  private query(): GeocodeQuery | null {
    const c = this.controls;
    if (!c) return null;
    return geocodeQueryOf({ addressLine: c.addressLine.value, city: c.city.value, country: c.country.value });
  }
}
