import { missingChecks, storeReadiness, type ReadinessFacts } from './store-readiness';

const ready: ReadinessFacts = {
  latitude: 46.8403,
  longitude: 29.6433,
  timezone: 'Europe/Chisinau',
  workingHours: [{ isClosed: false }],
  visibleProducts: 4,
  brandStatus: 'APPROVED',
};

describe('storeReadiness', () => {
  it('passes a store with a place, a zone, hours and a menu', () => {
    const r = storeReadiness(ready);
    expect(r.ready).toBe(true);
    expect(missingChecks(r)).toEqual([]);
  });

  it('lists what a freshly created or imported store still lacks', () => {
    const r = storeReadiness({
      latitude: 0,
      longitude: 0,
      timezone: 'UTC',
      workingHours: [],
      visibleProducts: 0,
      brandStatus: 'APPROVED',
    });
    expect(r.ready).toBe(false);
    expect(missingChecks(r)).toEqual(['coordinates', 'timezone', 'hours', 'menu']);
  });

  it('does not count a week of days off as working hours', () => {
    const r = storeReadiness({ ...ready, workingHours: [{ isClosed: true }, { isClosed: true }] });
    expect(missingChecks(r)).toEqual(['hours']);
  });

  it('shows moderation without letting it block opening', () => {
    const r = storeReadiness({ ...ready, brandStatus: 'PENDING' });
    expect(r.ready).toBe(true);
    expect(r.items.find((i) => i.check === 'brandApproved')).toEqual({
      check: 'brandApproved',
      ok: false,
      required: false,
    });
  });
});
