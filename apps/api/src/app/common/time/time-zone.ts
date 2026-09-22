import { buildMessage, ValidateBy, type ValidationOptions } from 'class-validator';

/**
 * IANA time zones for stores.
 *
 * Working hours are stored as local wall-clock minutes, so the zone decides
 * when a store actually opens. A zone Intl cannot resolve used to be saved
 * as typed and then read as UTC by the opening-hours check — two or three
 * hours off for a café in Chișinău.
 */

/**
 * A zone name Intl resolves ('Europe/Chisinau', 'UTC'). Bare offsets such as
 * '+02:00' are refused even though Intl accepts them: an offset knows
 * nothing about daylight saving, so a store on one would be an hour off for
 * half of the year.
 */
export function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The zone's own spelling: 'europe/chisinau' → 'Europe/Chisinau', 'Etc/UTC' → 'UTC'. */
export function canonicalTimeZone(zone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
}

/**
 * A real local zone rather than the UTC placeholder a store gets when nobody
 * chose one (the column default, POS imports). No café keeps UTC wall-clock
 * time, so UTC reads as "not chosen yet".
 */
export function isLocalTimeZone(zone: string): boolean {
  return isIanaTimeZone(zone) && canonicalTimeZone(zone) !== 'UTC';
}

/**
 * The zone most of `zones` — a brand's other stores — are in, or null when
 * none has a real one. A chain rarely straddles time zones, so this is the
 * best guess for a store whose zone nobody has told us.
 */
export function prevailingTimeZone(zones: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const zone of zones) {
    if (!isLocalTimeZone(zone)) continue;
    const canonical = canonicalTimeZone(zone);
    counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [zone, count] of counts) {
    if (count > bestCount) {
      best = zone;
      bestCount = count;
    }
  }
  return best;
}

/** Validates {@link isIanaTimeZone}. */
export function IsIanaTimeZone(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isIanaTimeZone',
      validator: {
        validate: (value: unknown) => isIanaTimeZone(value),
        defaultMessage: buildMessage(
          (each) => `${each}$property must be an IANA time zone such as Europe/Chisinau`,
          options,
        ),
      },
    },
    options,
  );
}
