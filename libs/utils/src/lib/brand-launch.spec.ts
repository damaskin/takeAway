import { BRAND_LAUNCH_STEPS, brandLaunch } from './brand-launch';

const none = { store: false, menu: false, approved: false, hasOrders: false };

describe('brandLaunch', () => {
  it('counts payments as done from the start: a fresh brand is 1 of 4', () => {
    expect(BRAND_LAUNCH_STEPS).toEqual(['store', 'menu', 'payments', 'approved']);
    expect(brandLaunch(none)).toEqual({ done: 1, total: 4, complete: false });
  });

  it('is launched once a store, a menu and the approval are there — no logo or photo needed', () => {
    expect(brandLaunch({ ...none, store: true, menu: true })).toEqual({ done: 3, total: 4, complete: false });
    expect(brandLaunch({ store: true, menu: true, approved: true, hasOrders: false })).toEqual({
      done: 4,
      total: 4,
      complete: true,
    });
  });

  it('is launched by its first sale, whatever the checklist says', () => {
    expect(brandLaunch({ ...none, store: true, hasOrders: true })).toEqual({ done: 2, total: 4, complete: true });
  });
});
