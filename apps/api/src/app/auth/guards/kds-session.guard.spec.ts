import { ExecutionContext, ForbiddenException, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';

import { KdsController } from '../../kds/kds.controller';
import { AdminStaffController } from '../../admin/staff/admin-staff.controller';
import { KdsSessionAllowed } from '../decorators/kds-session.decorator';
import type { AuthenticatedUser } from '../strategies/jwt.strategy';
import { KdsSessionGuard } from './kds-session.guard';

class Fixture {
  @KdsSessionAllowed({ from: 'param', key: 'id' })
  stopList(): void {
    return undefined;
  }

  @KdsSessionAllowed()
  me(): void {
    return undefined;
  }

  refund(): void {
    return undefined;
  }
}

function contextFor(
  user: Partial<AuthenticatedUser> | undefined,
  target: { cls: object; handler: object },
  request: { query?: object; params?: object; body?: object } = {},
): ExecutionContext {
  return {
    getHandler: () => target.handler,
    getClass: () => target.cls,
    switchToHttp: () => ({ getRequest: () => ({ user, ...request }) }),
  } as unknown as ExecutionContext;
}

const pinSession: Partial<AuthenticatedUser> = { id: 'barista', role: Role.STORE_MANAGER, kdsStoreId: 'store-1' };
const passwordSession: Partial<AuthenticatedUser> = { id: 'owner', role: Role.STORE_MANAGER };

function code(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (e) {
    return ((e as HttpException).getResponse() as { code?: string }).code;
  }
}

describe('KdsSessionGuard', () => {
  const guard = new KdsSessionGuard(new Reflector());
  const fixture = { cls: Fixture, handler: Fixture.prototype.refund };

  it('lets a password session through anywhere', () => {
    expect(guard.canActivate(contextFor(passwordSession, fixture))).toBe(true);
  });

  it('lets an anonymous request through — public routes never authenticate', () => {
    expect(guard.canActivate(contextFor(undefined, fixture))).toBe(true);
  });

  it('refuses a PIN session on a route that is not marked for the kitchen', () => {
    expect(() => guard.canActivate(contextFor(pinSession, fixture))).toThrow(ForbiddenException);
    expect(code(() => guard.canActivate(contextFor(pinSession, fixture)))).toBe('KDS_SESSION_LIMITED');
  });

  it('lets a PIN session reach a marked route for its own store only', () => {
    const stopList = { cls: Fixture, handler: Fixture.prototype.stopList };
    expect(guard.canActivate(contextFor(pinSession, stopList, { params: { id: 'store-1' } }))).toBe(true);
    expect(code(() => guard.canActivate(contextFor(pinSession, stopList, { params: { id: 'store-2' } })))).toBe(
      'KDS_SESSION_STORE',
    );
    expect(guard.canActivate(contextFor(pinSession, { cls: Fixture, handler: Fixture.prototype.me }))).toBe(true);
  });

  it('opens the kitchen board for the PIN store and refuses other stores', () => {
    const board = { cls: KdsController, handler: KdsController.prototype.list };
    expect(guard.canActivate(contextFor(pinSession, board, { query: { storeId: 'store-1' } }))).toBe(true);
    expect(code(() => guard.canActivate(contextFor(pinSession, board, { query: { storeId: 'store-9' } })))).toBe(
      'KDS_SESSION_STORE',
    );
  });

  it('keeps a manager’s PIN session away from staff and PIN management', () => {
    const setPin = { cls: AdminStaffController, handler: AdminStaffController.prototype.setKdsPin };
    expect(code(() => guard.canActivate(contextFor(pinSession, setPin, { params: { storeId: 'store-1' } })))).toBe(
      'KDS_SESSION_LIMITED',
    );
  });
});
