import { EnvironmentInjector, createEnvironmentInjector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { RealtimeService, type StoreAvailabilityEvent } from '../realtime/realtime.service';
import { STORE_REFRESH_INTERVAL_MS, refreshStoresWhileVisible } from './live-store-refresh';

describe('refreshStoresWhileVisible', () => {
  let visibility: DocumentVisibilityState;
  let socketHandler: ((e: StoreAvailabilityEvent) => void) | null;
  const unsubscribe = jest.fn();

  const setVisibility = (state: DocumentVisibilityState): void => {
    visibility = state;
    document.dispatchEvent(new Event('visibilitychange'));
  };

  function start(refresh: jest.Mock): EnvironmentInjector {
    const injector = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));
    runInInjectionContext(injector, () => refreshStoresWhileVisible(refresh));
    return injector;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    visibility = 'visible';
    socketHandler = null;
    unsubscribe.mockReset();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: RealtimeService,
          useValue: {
            onStoreAvailabilityChanged: (handler: (e: StoreAvailabilityEvent) => void) => {
              socketHandler = handler;
              return unsubscribe;
            },
          },
        },
      ],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('polls every minute while the screen is in view', () => {
    const refresh = jest.fn();
    const injector = start(refresh);

    jest.advanceTimersByTime(STORE_REFRESH_INTERVAL_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(2);
    injector.destroy();
  });

  it('stops polling while hidden and refreshes at once on coming back', () => {
    const refresh = jest.fn();
    const injector = start(refresh);

    setVisibility('hidden');
    jest.advanceTimersByTime(STORE_REFRESH_INTERVAL_MS * 3);
    expect(refresh).not.toHaveBeenCalled();

    setVisibility('visible');
    expect(refresh).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(STORE_REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    injector.destroy();
  });

  it('passes the socket event on', () => {
    const refresh = jest.fn();
    const injector = start(refresh);

    const event = { storeId: 's-1', brandId: 'b-1', acceptingOrders: false };
    socketHandler?.(event);
    expect(refresh).toHaveBeenCalledWith(event);
    injector.destroy();
  });

  it('lets go of everything when the screen is destroyed', () => {
    const refresh = jest.fn();
    start(refresh).destroy();

    jest.advanceTimersByTime(STORE_REFRESH_INTERVAL_MS * 2);
    setVisibility('visible');
    expect(refresh).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
