import { Injectable, effect, signal } from '@angular/core';

const TABLET_KEY = 'takeaway.admin.kitchenTablet';
/** The store the kitchen board opens on — shared with the PIN screen. */
export const KITCHEN_STORE_KEY = 'takeaway.admin.kitchenStoreId';

/**
 * "Tablet mode" for the kitchen board: the cabinet's sidebar and top bar
 * give way to a dark, full-screen board, the way the standalone kitchen
 * app looked on the pass. A PIN sign-in turns it on; the device remembers
 * it until someone turns it off.
 */
@Injectable({ providedIn: 'root' })
export class KitchenModeService {
  readonly tablet = signal(read(TABLET_KEY) === 'on');

  constructor() {
    effect(() => write(TABLET_KEY, this.tablet() ? 'on' : null));
  }

  enter(): void {
    this.tablet.set(true);
    try {
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
    } catch {
      // Not every tablet browser allows it; the board works in a window too.
    }
  }

  leave(): void {
    this.tablet.set(false);
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    } catch {
      // Nothing to undo.
    }
  }
}

export function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage-disabled browsers just forget.
  }
}
