import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { canonicalTimeZone, IsIanaTimeZone, isIanaTimeZone, isLocalTimeZone, prevailingTimeZone } from './time-zone';

describe('isIanaTimeZone', () => {
  it('accepts zone names Intl knows', () => {
    expect(isIanaTimeZone('Europe/Chisinau')).toBe(true);
    expect(isIanaTimeZone('europe/chisinau')).toBe(true);
    expect(isIanaTimeZone('UTC')).toBe(true);
  });

  it('refuses typos, offsets and non-strings', () => {
    expect(isIanaTimeZone('Europe/Kishinev')).toBe(false);
    expect(isIanaTimeZone('Moldova')).toBe(false);
    expect(isIanaTimeZone('+02:00')).toBe(false);
    expect(isIanaTimeZone('')).toBe(false);
    expect(isIanaTimeZone(null)).toBe(false);
    expect(isIanaTimeZone(3)).toBe(false);
  });
});

describe('canonicalTimeZone', () => {
  it('normalises case and UTC aliases', () => {
    expect(canonicalTimeZone('europe/chisinau')).toBe('Europe/Chisinau');
    expect(canonicalTimeZone('Etc/UTC')).toBe('UTC');
  });
});

describe('isLocalTimeZone', () => {
  it('treats UTC as not chosen yet', () => {
    expect(isLocalTimeZone('UTC')).toBe(false);
    expect(isLocalTimeZone('Etc/UTC')).toBe(false);
    expect(isLocalTimeZone('Europe/Chisinau')).toBe(true);
    expect(isLocalTimeZone('nonsense')).toBe(false);
  });
});

describe('prevailingTimeZone', () => {
  it("picks the zone most of the brand's stores use", () => {
    expect(prevailingTimeZone(['Europe/Chisinau', 'UTC', 'Europe/Chisinau', 'Europe/Kiev'])).toBe('Europe/Chisinau');
  });

  it('has no answer when no store has a real zone', () => {
    expect(prevailingTimeZone([])).toBeNull();
    expect(prevailingTimeZone(['UTC', 'bogus'])).toBeNull();
  });
});

describe('@IsIanaTimeZone', () => {
  class Probe {
    @IsIanaTimeZone()
    timezone!: string;
  }

  it('reports the field in words a person can act on', async () => {
    const errors = await validate(plainToInstance(Probe, { timezone: 'Europe/Kishinev' }));
    expect(errors[0]?.constraints).toEqual({
      isIanaTimeZone: 'timezone must be an IANA time zone such as Europe/Chisinau',
    });
    await expect(validate(plainToInstance(Probe, { timezone: 'Europe/Chisinau' }))).resolves.toEqual([]);
  });
});
