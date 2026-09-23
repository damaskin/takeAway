import { Component, computed, forwardRef, signal } from '@angular/core';
import { type ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

interface ZoneOption {
  id: string;
  label: string;
  /** Lower-case text the search box matches against. */
  haystack: string;
}

/**
 * Names people type for the zones of the markets we open in. IANA ids are
 * English and city-based, so «Тирасполь» would otherwise find nothing.
 */
const LOCAL_NAMES: Record<string, string> = {
  'Europe/Chisinau': 'кишинёв кишинев тирасполь бендеры бельцы молдова пмр приднестровье tiraspol moldova',
  'Europe/Kiev': 'киев одесса украина kyiv odesa ukraine',
  'Europe/Kyiv': 'киев одесса украина kyiv odesa ukraine',
  'Europe/Bucharest': 'бухарест румыния romania',
  'Europe/Moscow': 'москва россия russia',
  'Europe/London': 'лондон великобритания uk',
  'Europe/Lisbon': 'лиссабон португалия portugal',
  'Asia/Dubai': 'дубай оаэ uae',
  'Asia/Bangkok': 'бангкок таиланд thailand',
  'Asia/Makassar': 'бали индонезия bali indonesia',
};

/** The browser's own zone, unless it is the UTC a server or VM reports. */
export function defaultStoreTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && zone !== 'UTC' && zone !== 'Etc/UTC') return zone;
  } catch {
    // Fall through: an engine without time-zone support.
  }
  return 'Europe/Chisinau';
}

let cached: ZoneOption[] | null = null;

/** Every zone the browser knows, labelled with its current UTC offset. Built once. */
function allZones(): ZoneOption[] {
  if (!cached) {
    const now = new Date();
    cached = Intl.supportedValuesOf('timeZone').map((id) => zoneOption(id, now));
  }
  return cached;
}

function zoneOption(id: string, now = new Date()): ZoneOption {
  let offset = '';
  try {
    offset =
      new Intl.DateTimeFormat('en-US', { timeZone: id, timeZoneName: 'shortOffset' })
        .formatToParts(now)
        .find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    // An id this browser cannot format (a stored legacy value) is still listed.
  }
  const label = offset ? `${id.replace(/_/g, ' ')} (${offset})` : id.replace(/_/g, ' ');
  return { id, label, haystack: `${id} ${label} ${LOCAL_NAMES[id] ?? ''}`.toLowerCase().replace(/_/g, ' ') };
}

/**
 * A searchable list of IANA time zones for a reactive form. A free-text
 * field used to accept anything, and the API read an unknown zone as UTC.
 */
@Component({
  selector: 'app-timezone-select',
  standalone: true,
  imports: [TranslatePipe],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => TimezoneSelectComponent), multi: true }],
  // Block and shrinkable, so a 40-character zone name can't widen the form row.
  host: { style: 'display: block; min-width: 0' },
  template: `
    <div style="display: flex; flex-direction: column; gap: 6px">
      <input
        type="search"
        [value]="query()"
        (input)="query.set(asValue($event))"
        [disabled]="disabled()"
        [placeholder]="'admin.stores.timezone.search' | translate"
        [attr.aria-label]="'admin.stores.timezone.search' | translate"
        style="width: 100%; height: 32px; padding: 0 10px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-sans); font-size: 13px; outline: none"
      />
      <select
        (change)="pick(asValue($event))"
        (blur)="onTouched()"
        [disabled]="disabled()"
        [attr.aria-label]="'admin.stores.fields.timezone' | translate"
        style="width: 100%; height: 36px; padding: 0 10px; background: var(--color-foam); border: 1px solid var(--color-border); border-radius: 8px; font-family: var(--font-sans); font-size: 14px; outline: none"
      >
        @if (!value()) {
          <option value="" disabled [selected]="true">{{ 'admin.stores.timezone.choose' | translate }}</option>
        }
        @for (zone of options(); track zone.id) {
          <option [value]="zone.id" [selected]="zone.id === value()">{{ zone.label }}</option>
        }
      </select>
      @if (query() && matches() === 0) {
        <span style="font-family: var(--font-sans); font-size: 12px; color: var(--color-text-tertiary)">{{
          'admin.stores.timezone.noMatch' | translate
        }}</span>
      }
    </div>
  `,
})
export class TimezoneSelectComponent implements ControlValueAccessor {
  readonly query = signal('');
  readonly value = signal('');
  readonly disabled = signal(false);

  private readonly filtered = computed(() => {
    const words = this.query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    const zones = allZones();
    return words.length ? zones.filter((z) => words.every((w) => z.haystack.includes(w))) : zones;
  });

  readonly matches = computed(() => this.filtered().length);

  /**
   * The chosen zone stays listed whatever the filter says: a select whose
   * value has no option shows the first one instead, which looks like a
   * different zone was picked.
   */
  readonly options = computed(() => {
    const current = this.value();
    const list = this.filtered();
    if (!current || list.some((z) => z.id === current)) return list;
    return [allZones().find((z) => z.id === current) ?? zoneOption(current), ...list];
  });

  private onChange: (value: string) => void = () => undefined;
  onTouched: () => void = () => undefined;

  pick(id: string): void {
    this.value.set(id);
    this.onChange(id);
  }

  asValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  writeValue(value: string | null): void {
    this.value.set(value ?? '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }
}
