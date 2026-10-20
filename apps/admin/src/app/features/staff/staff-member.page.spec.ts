import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { StaffMember } from '@takeaway/shared-types';
import { of } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { AdminCatalogApi } from '../../core/catalog/admin-catalog.service';
import { StaffService } from '../../core/staff/staff.service';
import { StaffMemberPage } from './staff-member.page';

const member = (overrides: Partial<StaffMember> = {}): StaffMember => ({
  userId: 'u-2',
  email: 'ion@noname.md',
  login: null,
  phone: null,
  name: 'Ion',
  role: 'STAFF',
  blocked: false,
  addedAt: '2026-10-01T08:00:00.000Z',
  stores: [
    { id: 'store-1', name: 'Центр' },
    { id: 'store-2', name: 'Вокзал' },
  ],
  kdsPinStoreId: null,
  hasKdsPin: false,
  editable: true,
  ...overrides,
});

describe('StaffMemberPage', () => {
  let api: Record<string, jest.Mock>;

  function make(person: StaffMember, role = 'BRAND_ADMIN') {
    api = {
      getMember: jest.fn().mockReturnValue(of(person)),
      setMemberPin: jest.fn().mockReturnValue(of({ ...person, hasKdsPin: true, kdsPinStoreId: null })),
      clearMemberPin: jest.fn().mockReturnValue(of({ ...person, hasKdsPin: false, kdsPinStoreId: null })),
      addSignIn: jest.fn(),
      resetPassword: jest.fn(),
    };
    TestBed.configureTestingModule({
      imports: [StaffMemberPage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: StaffService, useValue: api },
        { provide: AdminCatalogApi, useValue: { listStores: () => of([]) } },
        { provide: ActiveBrandService, useValue: { activeId: signal('brand-1') } },
        { provide: AuthStore, useValue: { user: signal({ id: 'owner', role }) } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(StaffMemberPage);
    fixture.componentRef.setInput('userId', person.userId);
    fixture.detectChanges();
    return { page: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, fixture };
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('sets one PIN for all the person’s stores, with no store to pick', () => {
    const { page, el, fixture } = make(member());
    expect(el.querySelector('select[aria-label], .pin-row select')).toBeNull();

    page.pin.set('480317');
    page.setPin(new Event('submit'));
    fixture.detectChanges();

    expect(api['setMemberPin']).toHaveBeenCalledWith('u-2', '480317', 'brand-1');
    expect(el.querySelector('[data-testid="member-pin-state"]')?.textContent).toContain('во всех точках');
  });

  it('says an old PIN opens one store only and offers a new one', () => {
    const { el } = make(member({ hasKdsPin: true, kdsPinStoreId: 'store-2' }));
    expect(el.querySelector('[data-testid="member-pin-state"]')?.textContent).toContain('только точку «Вокзал»');
  });

  it('resets the PIN on the person', () => {
    const { page } = make(member({ hasKdsPin: true }));
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    page.clearPin();
    expect(api['clearMemberPin']).toHaveBeenCalledWith('u-2', 'brand-1');
    expect(page.member()?.hasKdsPin).toBe(false);
  });

  it('offers a way into the cabinet, not a password reset, for someone with a PIN only', () => {
    const pinOnly = member({ email: null, login: null, hasKdsPin: true });
    const { page, el, fixture } = make(pinOnly);
    expect(el.querySelector('[data-testid="member-sign-in"]')).not.toBeNull();
    expect(el.querySelector('#member-password')).toBeNull();

    api['addSignIn'].mockReturnValue(of({ ...pinOnly, login: 'ion.k', inviteEmail: 'NO_EMAIL', accountCreated: true }));
    page.signInId.set('Ion.K');
    page.signInPassword.set('Temp-pass-42');
    page.addSignIn(new Event('submit'));
    fixture.detectChanges();

    expect(api['addSignIn']).toHaveBeenCalledWith('u-2', { login: 'ion.k', tempPassword: 'Temp-pass-42' }, 'brand-1');
    expect(el.querySelector('[data-testid="sign-in-temp-password"]')?.textContent).toContain('Temp-pass-42');
  });

  it('keeps the password reset for someone with a login or an email', () => {
    const { el } = make(member());
    expect(el.querySelector('#member-password')).not.toBeNull();
    expect(el.querySelector('[data-testid="member-sign-in"]')).toBeNull();
  });
});
