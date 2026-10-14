import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { TRANSLATIONS_EN } from '@takeaway/i18n/en';
import type { StaffInviteResult } from '@takeaway/shared-types';
import { of, throwError } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi } from '../../core/catalog/admin-catalog.service';
import { StaffService } from '../../core/staff/staff.service';
import { StaffFormPage } from './staff-form.page';

const invited = (overrides: Partial<StaffInviteResult> = {}): StaffInviteResult => ({
  userId: 'u-new',
  email: 'anna@noname.md',
  login: null,
  phone: null,
  name: 'Анна',
  role: 'STAFF',
  blocked: false,
  addedAt: '2026-10-10T08:00:00.000Z',
  stores: [{ id: 'store-1', name: 'Центр' }],
  kdsPinStoreId: null,
  hasKdsPin: false,
  editable: true,
  inviteEmail: 'SENT',
  accountCreated: true,
  ...overrides,
});

describe('StaffFormPage', () => {
  let invite: jest.Mock;

  function make(role = 'BRAND_ADMIN'): { page: StaffFormPage; element: HTMLElement; detect: () => void } {
    invite = jest.fn().mockReturnValue(of(invited()));
    TestBed.configureTestingModule({
      imports: [StaffFormPage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: StaffService, useValue: { invite } },
        {
          provide: AdminCatalogApi,
          useValue: { listStores: () => of([{ id: 'store-1', name: 'Центр' }]) },
        },
        { provide: ActiveBrandService, useValue: { activeId: signal('brand-1') } },
        { provide: AuthStore, useValue: { user: signal({ role }) } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.setTranslation('en', TRANSLATIONS_EN as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(StaffFormPage);
    fixture.detectChanges();
    return {
      page: fixture.componentInstance,
      element: fixture.nativeElement as HTMLElement,
      detect: () => fixture.detectChanges(),
    };
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('picks Кухня by default and explains every role under the select', () => {
    const { page, element } = make();
    expect(page.form.controls.role.value).toBe('STAFF');
    const roles = element.querySelector('[data-testid="role-descriptions"]')?.textContent ?? '';
    expect(roles).toContain('Менеджер');
    expect(roles).toContain('Кухня');
    expect(roles).toContain('Редактор меню');
    expect(roles).toContain('только меню');
  });

  it('shows the API’s password rule and turns it red for a short password', () => {
    const { page, element, detect } = make();
    const rule = () => element.querySelector('[data-testid="password-rule"]') as HTMLElement;
    expect(rule().textContent).toContain('8');
    expect(rule().textContent).toContain('128');

    page.form.controls.tempPassword.setValue('short');
    detect();
    expect(page.form.controls.tempPassword.valid).toBe(false);
    expect(rule().classList).toContain('rule-bad');
  });

  it('generates a valid temporary password into the field', () => {
    const { page } = make();
    page.generate();
    expect(page.form.controls.tempPassword.value).toHaveLength(12);
    expect(page.form.controls.tempPassword.valid).toBe(true);
  });

  it('tells the owner to hand the password over when no email went out', () => {
    const { page, element, detect } = make();
    invite.mockReturnValue(of(invited({ inviteEmail: 'NOT_CONFIGURED' })));
    page.form.patchValue({ identifier: 'Anna@NoName.md', tempPassword: 'Temp-pass-42' });
    page.submit();
    detect();

    expect(invite).toHaveBeenCalledWith(
      { email: 'anna@noname.md', role: 'STAFF', tempPassword: 'Temp-pass-42', storeIds: ['store-1'] },
      'brand-1',
    );
    const text = element.querySelector('[data-testid="invite-result"]')?.textContent ?? '';
    expect(text).toContain('Письмо не отправлено');
    expect(text).toContain('Temp-pass-42');
    expect(text).toContain('anna@noname.md');
  });

  it('confirms the email when it went out', () => {
    const { page, element, detect } = make();
    page.form.patchValue({ identifier: 'anna@noname.md', tempPassword: 'Temp-pass-42' });
    page.submit();
    detect();
    expect(element.querySelector('[data-testid="invite-sent"]')?.textContent).toContain('anna@noname.md');
  });

  it('invites someone without an email by a login and shows what to hand over', () => {
    const { page, element, detect } = make();
    invite.mockReturnValue(of(invited({ email: null, login: 'anna.k', inviteEmail: 'NO_EMAIL' })));
    page.form.patchValue({ identifier: ' Anna.K ', tempPassword: 'Temp-pass-42' });
    detect();
    expect(page.byLogin()).toBe(true);
    expect(element.querySelector('[data-testid="temp-password-hint"]')?.textContent).toContain('лично');

    page.submit();
    detect();

    expect(invite).toHaveBeenCalledWith(
      { login: 'anna.k', role: 'STAFF', tempPassword: 'Temp-pass-42', storeIds: ['store-1'] },
      'brand-1',
    );
    expect(element.querySelector('[data-testid="invite-no-email"]')?.textContent).toContain('Почты у сотрудника нет');
    expect(element.querySelector('[data-testid="invite-not-sent"]')).toBeNull();
    expect(element.querySelector('[data-testid="invite-login"]')?.textContent).toContain('anna.k');
    expect(element.querySelector('[data-testid="invite-result"]')?.textContent).toContain('Temp-pass-42');
  });

  it('takes an email or a login, and nothing else', () => {
    const { page, element, detect } = make();
    const rule = () => element.querySelector('[data-testid="identifier-rule"]') as HTMLElement;
    for (const value of ['anna@noname.md', 'anna.k', 'ANNA_K-2']) {
      page.form.controls.identifier.setValue(value);
      expect(page.form.controls.identifier.valid).toBe(true);
    }
    for (const value of ['an', 'anna k', 'анна', 'anna@', 'a'.repeat(33)]) {
      page.form.controls.identifier.setValue(value);
      detect();
      expect(page.form.controls.identifier.valid).toBe(false);
      expect(rule().classList).toContain('rule-bad');
    }
  });

  it('says so when the login is taken', () => {
    const { page, element, detect } = make();
    invite.mockReturnValue(
      throwError(() => ({ status: 409, error: { statusCode: 409, code: 'LOGIN_IN_USE', field: 'login' } })),
    );
    page.form.patchValue({ identifier: 'anna.k', tempPassword: 'Temp-pass-42' });
    page.submit();
    detect();
    expect(page.error()).toBe('Этот логин уже занят. Придумайте другой.');
    expect(element.querySelector('[data-testid="invite-result"]')).toBeNull();
  });

  it('does not offer a store manager the manager role', () => {
    const { page } = make('STORE_MANAGER');
    expect(page.roleOptions()).toEqual(['STAFF', 'MENU_EDITOR']);
  });
});
