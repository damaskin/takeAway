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
      phone: '+14155551234',
      email: null,
      name: 'Alex',
      locale: 'EN',
      currency: 'USD',
      role: 'CUSTOMER',
    },
  };
}

describe('web AuthStore', () => {
  beforeEach(() => localStorage.clear());

  it('hydrates from localStorage across instances', () => {
    new AuthStore().set(makeSession());
    const fresh = new AuthStore();
    expect(fresh.isAuthenticated()).toBe(true);
    expect(fresh.user()?.currency).toBe('USD');
  });

  it('clear removes the persisted session', () => {
    const store = new AuthStore();
    store.set(makeSession());
    store.clear();
    expect(store.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('takeaway.web.session')).toBeNull();
  });
});
