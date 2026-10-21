import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { TmaPersonalInfoPage } from './personal-info.page';
import { TEST_USER, openProfileScreen } from './testing';

describe('TmaPersonalInfoPage', () => {
  async function open() {
    const screen = await openProfileScreen(TmaPersonalInfoPage);
    const type = (name: string, value: string) => {
      const field = screen.el.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (!field) throw new Error(`no ${name}`);
      field.value = value;
      field.dispatchEvent(new Event('input'));
    };
    const save = async () => {
      Array.from(screen.el.querySelectorAll('button'))
        .find((b) => b.textContent?.trim() === 'Сохранить')
        ?.click();
      await screen.fixture.whenStable();
    };
    return { ...screen, type, save };
  }

  it('saves the phone as the API takes it and keeps the session in step', async () => {
    const { http, el, type, save, user, fixture } = await open();
    expect(el.querySelector('[data-testid="name"]')?.textContent?.trim()).toBe('Максим Петров');
    expect(el.textContent).toContain('Имя берётся из Telegram');

    type('phone', '069 123 456');
    type('dateOfBirth', '1990-05-17');
    await save();

    const req = http.expectOne('/api/auth/me');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ email: 'max@example.com', phone: '+37369123456', dateOfBirth: '1990-05-17' });
    req.flush({ ...TEST_USER, phone: '+37369123456' });
    await fixture.whenStable();

    expect(user()?.phone).toBe('+37369123456');
    expect(el.querySelector('[role="status"]')?.textContent?.trim()).toBe('Сохранено.');
    http.verify();
  });

  it('says what is wrong with a number before sending it', async () => {
    const { http, el, type, save } = await open();
    type('phone', '12345');
    await save();
    http.expectNone('/api/auth/me');
    expect(el.querySelector('[role="alert"]')?.textContent?.trim()).toBe('Проверьте номер: например, +373 69 123 456');
  });

  it('goes back to the profile with Telegram’s back button', async () => {
    const { back, fixture, detached } = await open();
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    back();
    expect(navigate).toHaveBeenCalledWith(['/profile']);
    fixture.destroy();
    expect(detached()).toBe(true);
  });
});
