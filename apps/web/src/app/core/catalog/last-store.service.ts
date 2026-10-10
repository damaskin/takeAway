import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'takeaway.web.lastStore';

/**
 * The store whose menu the customer opened last, by slug. The store chooser
 * offers «Продолжить в …» with it, so a regular is one tap from their menu
 * while «Меню» still opens the whole choice of places.
 *
 * Kept in localStorage: a convenience, so a browser that refuses storage
 * just goes without it.
 */
@Injectable({ providedIn: 'root' })
export class LastStoreService {
  private readonly current = signal<string | null>(read());

  readonly slug = this.current.asReadonly();

  remember(slug: string): void {
    if (this.current() === slug) return;
    this.current.set(slug);
    try {
      localStorage.setItem(STORAGE_KEY, slug);
    } catch {
      // Private mode or storage switched off: remembered for this visit only.
    }
  }
}

function read(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
