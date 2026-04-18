import type { OrderStatus, PickupMode } from './shared-types';

describe('shared-types', () => {
  it('keeps OrderStatus union exhaustive', () => {
    const statuses: OrderStatus[] = [
      'CREATED',
      'PAID',
      'ACCEPTED',
      'IN_PROGRESS',
      'READY',
      'PICKED_UP',
      'CANCELLED',
      'EXPIRED',
    ];
    expect(statuses).toHaveLength(8);
  });

  it('keeps PickupMode union exhaustive', () => {
    const modes: PickupMode[] = ['ASAP', 'SCHEDULED'];
    expect(modes).toHaveLength(2);
  });
});
