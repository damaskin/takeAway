import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { InboxController } from './inbox.controller';
import type { InboxService } from './inbox.service';

describe('InboxController', () => {
  const user = { id: 'ana', role: 'CUSTOMER' } as AuthenticatedUser;

  function setup() {
    const inbox = {
      list: jest.fn(() => Promise.resolve({ items: [], nextCursor: null, unreadCount: 0 })),
      get: jest.fn(() => Promise.resolve({ id: 'n1' })),
      unreadCount: jest.fn(() => Promise.resolve(3)),
      markRead: jest.fn(() => Promise.resolve()),
      markAllRead: jest.fn(() => Promise.resolve(2)),
    };
    return { controller: new InboxController(inbox as unknown as InboxService), inbox };
  }

  it("scopes every route to the signed-in customer's own messages", async () => {
    const { controller, inbox } = setup();

    await controller.list(user, { cursor: 'n9', limit: 10 });
    await controller.get(user, 'n1');
    await controller.read(user, 'n1');
    await controller.readAll(user);

    expect(inbox.list).toHaveBeenCalledWith('ana', { cursor: 'n9', limit: 10 });
    expect(inbox.get).toHaveBeenCalledWith('ana', 'n1');
    expect(inbox.markRead).toHaveBeenCalledWith('ana', 'n1');
    expect(inbox.markAllRead).toHaveBeenCalledWith('ana');
  });

  it('answers the badge count', async () => {
    const { controller } = setup();
    await expect(controller.unreadCount(user)).resolves.toEqual({ count: 3 });
  });
});
