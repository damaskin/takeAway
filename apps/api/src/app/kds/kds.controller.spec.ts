import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import type { UserStoreScopeService } from '../auth/services/user-store-scope.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PauseStoreDto } from './dto/pause-store.dto';
import { KdsController } from './kds.controller';
import type { KdsService } from './kds.service';
import type { StoreShiftService } from './store-shift.service';

const staff = { id: 'staff-1', role: 'STAFF' } as AuthenticatedUser;

function harness() {
  const shifts = {
    pause: jest.fn().mockResolvedValue({ storeId: 'store-1' }),
    resume: jest.fn().mockResolvedValue({ storeId: 'store-1' }),
  };
  const scope = { getScope: jest.fn().mockResolvedValue(['store-1']) };
  const controller = new KdsController(
    {} as KdsService,
    shifts as unknown as StoreShiftService,
    scope as unknown as UserStoreScopeService,
  );
  return { controller, shifts };
}

describe('KdsController', () => {
  it('answers 409 SHIFT_FOLLOWS_SCHEDULE to «Начать / Закончить работу» from an old cabinet', async () => {
    const { controller } = harness();
    await expect(controller.manualShift(staff, 'store-1')).rejects.toMatchObject({
      status: 409,
      response: { code: 'SHIFT_FOLLOWS_SCHEDULE' },
    });
  });

  it('pauses and lifts the pause for a store in scope, and for no other', async () => {
    const { controller, shifts } = harness();
    const body = Object.assign(new PauseStoreDto(), { minutes: null, reason: 'EQUIPMENT' as const });

    await controller.pause(staff, 'store-1', body);
    expect(shifts.pause).toHaveBeenCalledWith('store-1', 'staff-1', body);
    await controller.resume(staff, 'store-1');
    expect(shifts.resume).toHaveBeenCalledWith('store-1', 'staff-1');

    await expect(controller.pause(staff, 'store-2', body)).rejects.toMatchObject({ status: 403 });
  });
});

describe('PauseStoreDto', () => {
  const errors = (body: Record<string, unknown>) =>
    validateSync(plainToInstance(PauseStoreDto, body)).map((e) => e.property);

  it('takes 15/30/60/120 minutes or null (until the closing), a reason and a short comment', () => {
    expect(errors({ minutes: 30, reason: 'NO_STAFF' })).toEqual([]);
    expect(errors({ minutes: null, reason: 'OTHER', comment: 'кофемашина' })).toEqual([]);
  });

  it('refuses other durations, a missing duration, an unknown reason and a long comment', () => {
    expect(errors({ minutes: 45, reason: 'EQUIPMENT' })).toEqual(['minutes']);
    expect(errors({ reason: 'EQUIPMENT' })).toEqual(['minutes']);
    expect(errors({ minutes: 15, reason: 'COFFEE_BREAK' })).toEqual(['reason']);
    expect(errors({ minutes: 15, reason: 'OTHER', comment: 'x'.repeat(121) })).toEqual(['comment']);
  });
});
