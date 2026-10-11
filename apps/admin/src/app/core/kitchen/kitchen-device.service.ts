import { Injectable, inject, signal } from '@angular/core';
import type { KitchenDeviceBinding, KitchenDeviceStores } from '@takeaway/shared-types';
import { Observable, tap } from 'rxjs';

import { read, write } from './kitchen-mode.service';
import { KitchenApi } from './kitchen.api';

/** Where this browser keeps its kitchen-tablet token. */
export const KITCHEN_DEVICE_KEY = 'takeaway.admin.kitchenDevice';

/**
 * This browser as a kitchen tablet of one brand.
 *
 * The PIN screen lists only the stores of the brand the tablet is bound to,
 * and PIN sign-in works only from a bound tablet. The tablet is bound once
 * and keeps a long-lived token here:
 *  - when someone signed in opens the kitchen board on it ({@link ensureBound}) —
 *    which is also how tablets that were already signed in bind themselves;
 *  - or from a one-time link made on the Staff page ({@link pair}).
 */
@Injectable({ providedIn: 'root' })
export class KitchenDeviceService {
  private readonly api = inject(KitchenApi);
  private binding = false;

  /** The tablet token, null while this browser is not bound. */
  readonly token = signal<string | null>(read(KITCHEN_DEVICE_KEY));

  /**
   * Binds this browser to the brand of `storeId` with the signed-in session,
   * unless it is bound already. Quiet on failure: the board works without
   * it, and the next visit tries again.
   */
  ensureBound(storeId: string): void {
    if (this.token() || this.binding) return;
    this.binding = true;
    this.api.bindDevice(storeId).subscribe({
      next: (binding) => {
        this.binding = false;
        this.remember(binding);
      },
      error: () => (this.binding = false),
    });
  }

  /** Redeems the one-time code of a tablet link. */
  pair(code: string): Observable<KitchenDeviceBinding> {
    return this.api.pairDevice(code).pipe(tap((binding) => this.remember(binding)));
  }

  /** The bound brand and its stores with PIN holders. Call only with a token. */
  stores(): Observable<KitchenDeviceStores> {
    return this.api.deviceStores(this.token() ?? '');
  }

  /** Drops the token — the tablet was unbound, or someone chose to unbind it. */
  forget(): void {
    write(KITCHEN_DEVICE_KEY, null);
    this.token.set(null);
  }

  private remember(binding: KitchenDeviceBinding): void {
    write(KITCHEN_DEVICE_KEY, binding.deviceToken);
    this.token.set(binding.deviceToken);
  }
}
