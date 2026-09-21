import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'tma.activeStoreId';

/**
 * The store the customer is currently shopping in.
 *
 * The TMA routes products (`/products/:slug`) and checkout without a store
 * segment, so those pages used to guess the store by taking the first entry
 * of `listStores()`. With more than one brand live that guess picks an
 * unrelated store: add-to-cart silently no-ops (product/store mismatch) and
 * checkout loads an empty cart, which reads to the customer as "ordering is
 * broken". The menu page records the store here when it opens, and the
 * product / checkout pages read it back.
 *
 * Persisted to localStorage because Telegram may reload the Mini App
 * webview between screens, which would otherwise drop the in-memory value.
 */
@Injectable({ providedIn: 'root' })
export class ActiveStoreService {
  private readonly storeId = signal<string | null>(readStored());

  readonly current = this.storeId.asReadonly();

  set(storeId: string): void {
    this.storeId.set(storeId);
    try {
      localStorage.setItem(STORAGE_KEY, storeId);
    } catch {
      // Private-mode / storage-disabled webviews — the signal still works
      // for the current session, so this is not worth surfacing.
    }
  }

  clear(): void {
    this.storeId.set(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // See set().
    }
  }
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
