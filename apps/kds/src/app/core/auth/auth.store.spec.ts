import type { AuthSession } from '@takeaway/shared-types';

import { AuthStore } from './auth.store';

function session(): AuthSession {
  return {
    accessToken: 'a',
    refreshToken: 'r',
    accessTokenExpiresInSeconds: 900,
    refreshTokenExpiresInSeconds: 604800,
    user: { id: 'u', phone: '+10000000001', email: null, name: null, locale: 'EN', currency: 'USD', role: 'STAFF' },
  };
}

describe('kds AuthStore', () => {
  beforeEach(() => localStorage.clear());

  it('persists session to localStorage', () => {
    const store = new AuthStore();
    store.set(session());
    expect(store.user()?.role).toBe('STAFF');
  });

  it('hydrates a stored session', () => {
    new AuthStore().set(session());
    expect(new AuthStore().isAuthenticated()).toBe(true);
  });
});
