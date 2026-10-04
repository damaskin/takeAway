import { DOCUMENT, DestroyRef, inject } from '@angular/core';

import { RealtimeService, type StoreAvailabilityEvent } from '../realtime/realtime.service';

/** How often a store list or menu on screen re-asks whether its stores are open. */
export const STORE_REFRESH_INTERVAL_MS = 60_000;

/**
 * Keeps a screen's idea of which stores are open current. `refresh` runs:
 * - on `store.availabilityChanged` from the socket (signed-in customers),
 *   with the event, so a screen can skip stores it is not showing;
 * - when the tab comes back into view — a tab left in the background for
 *   hours would otherwise show the morning's state;
 * - every {@link STORE_REFRESH_INTERVAL_MS} while it is in view, for guests
 *   and for a socket that dropped. One cheap GET.
 *
 * Call from an injection context (a constructor or field initializer);
 * everything stops when the screen is destroyed.
 */
export function refreshStoresWhileVisible(refresh: (event?: StoreAvailabilityEvent) => void): void {
  const doc = inject(DOCUMENT);
  const realtime = inject(RealtimeService);
  const destroyRef = inject(DestroyRef);
  const win = doc.defaultView;
  if (!win) return;

  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = (): void => {
    if (timer !== null) win.clearInterval(timer);
    timer = null;
  };
  const start = (): void => {
    stop();
    timer = win.setInterval(() => refresh(), STORE_REFRESH_INTERVAL_MS);
  };
  const onVisibility = (): void => {
    if (doc.visibilityState === 'hidden') {
      stop();
      return;
    }
    refresh();
    start();
  };

  doc.addEventListener('visibilitychange', onVisibility);
  if (doc.visibilityState !== 'hidden') start();
  const unsubscribe = realtime.onStoreAvailabilityChanged((event) => refresh(event));

  destroyRef.onDestroy(() => {
    stop();
    doc.removeEventListener('visibilitychange', onVisibility);
    unsubscribe();
  });
}
