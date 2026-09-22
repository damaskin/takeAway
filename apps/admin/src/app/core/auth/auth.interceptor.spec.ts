import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import type { AuthSession } from '@takeaway/shared-types';

import { API_CONFIG, DEFAULT_API_CONFIG } from '../api/api.config';
import { authInterceptor } from './auth.interceptor';
import { AuthStore } from './auth.store';

function session(accessToken = 'old-access'): AuthSession {
  return {
    accessToken,
    refreshToken: 'refresh-1',
    accessTokenExpiresInSeconds: 900,
    refreshTokenExpiresInSeconds: 604800,
    user: {
      id: 'u1',
      phone: null,
      email: 'admin@example.com',
      name: 'Admin',
      locale: 'EN',
      currency: 'USD',
      role: 'SUPER_ADMIN',
    },
  };
}

/**
 * The silent refresh only fires on a 401. It never ran in production while
 * the API rendered every error — 401 included — as a 500, so the panel went
 * on failing every request until the operator signed in by hand. These cover
 * the path that was dead, so a regression on either side shows up here.
 */
describe('authInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let store: AuthStore;
  let navigate: jest.Mock;

  beforeEach(() => {
    localStorage.clear();
    navigate = jest.fn();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: API_CONFIG, useValue: DEFAULT_API_CONFIG },
        { provide: Router, useValue: { navigate } },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AuthStore);
  });

  afterEach(() => {
    backend.verify();
  });

  it('attaches the access token', () => {
    store.set(session());
    http.get('/api/admin/brands/mine').subscribe();

    const req = backend.expectOne('/api/admin/brands/mine');
    expect(req.request.headers.get('Authorization')).toBe('Bearer old-access');
    req.flush([]);
  });

  it('refreshes on 401 and replays the request with the new token', () => {
    store.set(session());
    const seen = jest.fn();
    http.get('/api/admin/analytics/stores').subscribe(seen);

    backend.expectOne('/api/admin/analytics/stores').flush(null, { status: 401, statusText: 'Unauthorized' });

    const refresh = backend.expectOne('/api/auth/refresh');
    expect(refresh.request.body).toEqual({ refreshToken: 'refresh-1' });
    refresh.flush({
      accessToken: 'new-access',
      refreshToken: 'refresh-2',
      accessTokenExpiresInSeconds: 900,
      refreshTokenExpiresInSeconds: 604800,
    });

    const replay = backend.expectOne('/api/admin/analytics/stores');
    expect(replay.request.headers.get('Authorization')).toBe('Bearer new-access');
    replay.flush({ ok: true });

    expect(seen).toHaveBeenCalledWith({ ok: true });
    expect(store.accessToken()).toBe('new-access');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('runs a single refresh for requests that 401 together', () => {
    store.set(session());
    http.get('/api/a').subscribe();
    http.get('/api/b').subscribe();

    backend.expectOne('/api/a').flush(null, { status: 401, statusText: 'Unauthorized' });
    backend.expectOne('/api/b').flush(null, { status: 401, statusText: 'Unauthorized' });

    backend.expectOne('/api/auth/refresh').flush({
      accessToken: 'new-access',
      refreshToken: 'refresh-2',
      accessTokenExpiresInSeconds: 900,
      refreshTokenExpiresInSeconds: 604800,
    });

    backend.expectOne('/api/a').flush({});
    backend.expectOne('/api/b').flush({});
  });

  it('signs the operator out when the refresh itself is rejected', () => {
    store.set(session());
    const failed = jest.fn();
    http.get('/api/admin/stores').subscribe({ error: failed });

    backend.expectOne('/api/admin/stores').flush(null, { status: 401, statusText: 'Unauthorized' });
    backend.expectOne('/api/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(store.session()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login']);
    expect(failed).toHaveBeenCalled();
  });

  it('leaves a non-401 failure alone — no refresh, no sign-out', () => {
    store.set(session());
    const failed = jest.fn();
    http.get('/api/admin/analytics/stores').subscribe({ error: failed });

    backend
      .expectOne('/api/admin/analytics/stores')
      .flush({ message: 'boom' }, { status: 500, statusText: 'Internal Server Error' });

    expect(failed).toHaveBeenCalled();
    expect(store.session()).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not try to refresh when there is no session to refresh', () => {
    const failed = jest.fn();
    http.get('/api/admin/brands/mine').subscribe({ error: failed });

    const req = backend.expectOne('/api/admin/brands/mine');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(failed).toHaveBeenCalled();
  });
});
