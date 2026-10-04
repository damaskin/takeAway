import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { TelegramBridgeService } from './telegram-bridge.service';

/**
 * Follows the Mini App's launch link on the first navigation: after paying on
 * the bank's page the customer comes back through
 * `t.me/<bot>/<app>?startapp=order_<id>`, and should land on that order, not
 * on the home screen. Every later navigation passes straight through.
 */
export const startParamGuard: CanActivateFn = () => {
  const orderId = inject(TelegramBridgeService).takeStartOrderId();
  return orderId ? inject(Router).createUrlTree(['/orders', orderId]) : true;
};
