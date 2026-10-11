import { CanActivate, ExecutionContext, ForbiddenException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { KDS_SESSION_KEY, type KdsSessionStoreSource } from '../decorators/kds-session.decorator';
import type { AuthenticatedUser } from '../strategies/jwt.strategy';

interface GuardedRequest {
  user?: AuthenticatedUser;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
  body?: unknown;
}

/**
 * Keeps a kitchen PIN session on the kitchen. A PIN is short and typed on a
 * shared tablet in reach of the queue; it used to open everything its
 * owner's role could — a manager's PIN reached the menu, staff, PINs and
 * refunds. A PIN session now reaches only routes marked
 * `@KdsSessionAllowed()` (the board, shifts, the stop-list, the brand and
 * store it needs to draw them), and on those only its own store.
 *
 * Sessions opened with email and password carry no `kdsStoreId` and pass
 * untouched; so do public routes, which never authenticate.
 */
@Injectable()
export class KdsSessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const storeId = request.user?.kdsStoreId;
    if (!storeId) return true;

    const allowed = this.reflector.getAllAndOverride<KdsSessionStoreSource | undefined>(KDS_SESSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed) {
      throw forbidden('KDS_SESSION_LIMITED', 'A kitchen PIN session only opens the kitchen board');
    }
    const requested = storeFrom(request, allowed);
    if (requested !== null && requested !== storeId) {
      throw forbidden('KDS_SESSION_STORE', 'A kitchen PIN session only opens the kitchen of its own store');
    }
    return true;
  }
}

function storeFrom(request: GuardedRequest, source: KdsSessionStoreSource): string | null {
  if (source.from === 'none') return null;
  const bag =
    source.from === 'query'
      ? request.query
      : source.from === 'param'
        ? request.params
        : (request.body as object | null);
  const value = bag && typeof bag === 'object' ? (bag as Record<string, unknown>)[source.key] : undefined;
  // A route that requires the store rejects a missing one on its own; an
  // empty value here cannot reach another store.
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function forbidden(code: string, message: string): ForbiddenException {
  return new ForbiddenException({ statusCode: HttpStatus.FORBIDDEN, error: 'Forbidden', code, message });
}
