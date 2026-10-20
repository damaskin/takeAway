import { TmaNotificationsPage } from './notifications.page';
import { openProfileScreen } from './testing';

describe('TmaNotificationsPage', () => {
  it('saves a switch at once, with no browser push in Telegram', async () => {
    const { http, el, fixture } = await openProfileScreen(TmaNotificationsPage);
    http.expectOne('/api/auth/me/notifications').flush({ notifyOrderUpdates: true, notifyPromotions: false });
    await fixture.whenStable();

    expect(el.textContent).toContain('Сообщения о заказах приходят от бота');
    expect(el.textContent).not.toContain('Уведомления в браузере');
    const promotions = el.querySelector<HTMLInputElement>('input[data-key="notifyPromotions"]');
    expect(promotions?.checked).toBe(false);

    promotions?.click();
    const req = http.expectOne('/api/auth/me/notifications');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ notifyPromotions: true });
    req.flush({ notifyOrderUpdates: true, notifyPromotions: true });
    await fixture.whenStable();
    expect(promotions?.checked).toBe(true);
    http.verify();
  });

  it('puts the switch back when the API refuses', async () => {
    const { http, el, fixture } = await openProfileScreen(TmaNotificationsPage);
    http.expectOne('/api/auth/me/notifications').flush({ notifyOrderUpdates: true, notifyPromotions: false });
    await fixture.whenStable();

    const orders = el.querySelector<HTMLInputElement>('input[data-key="notifyOrderUpdates"]');
    orders?.click();
    http
      .expectOne('/api/auth/me/notifications')
      .flush({ message: 'Нет связи' }, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    expect(orders?.checked).toBe(true);
    expect(el.querySelector('[role="alert"]')?.textContent?.trim()).toBe('Нет связи');
  });
});
