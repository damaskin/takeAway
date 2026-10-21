import type { AuthSession } from '@takeaway/shared-types';

import { AuthStore } from './auth.store';

function makeSession(): AuthSession {
  return {
    accessToken: 'access',
    refreshToken: 'refresh',
    accessTokenExpiresInSeconds: 900,
    refreshTokenExpiresInSeconds: 604800,
    user: {
      id: 'u1',
      phone: '+10000000001',
      email: null,
      name: 'Dev Admin',
      locale: 'EN',
      currency: 'USD',
      role: 'SUPER_ADMIN',
    },
  };
}

describe('AuthStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts unauthenticated when storage is empty', () => {
    const store = new AuthStore();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.user()).toBeNull();
  });

  it('persists and exposes a session', () => {
    const store = new AuthStore();
    store.set(makeSession());
    expect(store.isAuthenticated()).toBe(true);
    expect(store.accessToken()).toBe('access');
    expect(store.user()?.role).toBe('SUPER_ADMIN');
  });

  it('hydrates from localStorage', () => {
    const seed = new AuthStore();
    seed.set(makeSession());

    const store = new AuthStore();
    expect(store.isAuthenticated()).toBe(true);
    expect(store.user()?.phone).toBe('+10000000001');
  });

  it('clears the session on logout', () => {
    const store = new AuthStore();
    store.set(makeSession());
    store.clear();
    expect(store.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('takeaway.admin.session')).toBeNull();
  });

  it('knows a kitchen PIN session by its brand, and one saved before brand-wide PINs by its store', () => {
    const store = new AuthStore();
    store.set(makeSession());
    expect(store.kitchenSession()).toBe(false);

    store.set({ ...makeSession(), kdsBrandId: 'brand-1', kdsStoreId: 'store-1' });
    expect(store.kitchenSession()).toBe(true);
    expect(new AuthStore().kitchenSession()).toBe(true);

    localStorage.setItem('takeaway.admin.session', JSON.stringify({ ...makeSession(), kdsStoreId: 'store-1' }));
    expect(new AuthStore().kitchenSession()).toBe(true);
  });
});
