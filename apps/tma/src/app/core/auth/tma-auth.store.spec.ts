import type { AuthSession } from '@takeaway/shared-types';

import { TmaAuthStore } from './tma-auth.store';

function session(): AuthSession {
  return {
    accessToken: 'a',
    refreshToken: 'r',
    accessTokenExpiresInSeconds: 900,
    refreshTokenExpiresInSeconds: 604800,
    user: {
      id: 'u',
      phone: null,
      email: null,
      name: 'Alex',
      locale: 'EN',
      currency: 'USD',
      role: 'CUSTOMER',
    },
  };
}

describe('TmaAuthStore', () => {
  beforeEach(() => localStorage.clear());

  it('hydrates from localStorage', () => {
    new TmaAuthStore().set(session());
    expect(new TmaAuthStore().isAuthenticated()).toBe(true);
  });

  it('clear removes persisted session', () => {
    const store = new TmaAuthStore();
    store.set(session());
    store.clear();
    expect(localStorage.getItem('takeaway.tma.session')).toBeNull();
  });
});
