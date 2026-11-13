import { Injectable, signal } from '@angular/core';
import { type CheckoutPaymentMethod, readCheckoutPaymentMethod } from '@takeaway/utils';

const STORAGE_KEY = 'takeaway.web.paymentMethod';

/**
 * «Картой» or «Оплата мобильным платежом» — what the customer paid with last time on this
 * device, picked again at the next checkout where both are offered.
 *
 * Kept in localStorage: a convenience, so a browser that refuses storage
 * just starts from the card each time.
 */
@Injectable({ providedIn: 'root' })
export class PaymentMethodChoice {
  private readonly current = signal<CheckoutPaymentMethod | null>(read());

  readonly remembered = this.current.asReadonly();

  remember(method: CheckoutPaymentMethod): void {
    this.current.set(method);
    try {
      localStorage.setItem(STORAGE_KEY, method);
    } catch {
      // Private mode or storage switched off: remembered for this visit only.
    }
  }
}

function read(): CheckoutPaymentMethod | null {
  try {
    return typeof localStorage === 'undefined' ? null : readCheckoutPaymentMethod(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}
