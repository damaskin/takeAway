import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';

import { TmaAuthService } from './tma-auth.service';

/**
 * Keeps trying to establish the Mini App session in the background as the
 * customer moves around.
 *
 * The session normally lands in the app initializer, before anything
 * renders. This covers the one case that misses: the API was unreachable at
 * launch. Rather than stranding the customer on a screen that says "sign
 * in" — a step the Mini App does not have — each navigation quietly has
 * another go, and the screens light up as soon as one succeeds.
 *
 * Deliberately never blocks: the catalogue is public, so browsing must not
 * wait on a retry, and `ensureSession` is a no-op once a session exists.
 */
export const tmaSessionGuard: CanActivateFn = () => {
  inject(TmaAuthService).ensureSession().subscribe();
  return true;
};
