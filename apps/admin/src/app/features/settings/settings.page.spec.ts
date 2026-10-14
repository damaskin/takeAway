import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { OnboardingFlowService } from '../../core/onboarding/onboarding-flow.service';
import { type MyBrand, SettingsService } from '../../core/settings/settings.service';
import { AdminSettingsPage } from './settings.page';

const brand: MyBrand = {
  id: 'b1',
  slug: 'romashka',
  name: 'Ромашка',
  logoUrl: null,
  currency: 'MDL',
  locale: 'RU',
  moderationStatus: 'APPROVED',
  moderationNote: null,
  contactPhone: '+37369123456',
};

describe('AdminSettingsPage — the contact phone', () => {
  let updateMyBrand: jest.Mock;

  async function render(current: MyBrand) {
    updateMyBrand = jest.fn().mockReturnValue(of(current));
    TestBed.configureTestingModule({
      imports: [AdminSettingsPage],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: SettingsService, useValue: { getMyBrand: () => of(current), updateMyBrand } },
        {
          provide: ActiveBrandService,
          useValue: { loaded: signal(true), activeId: signal('b1'), refresh: jest.fn() },
        },
        { provide: AuthStore, useValue: { user: signal({ role: 'BRAND_ADMIN' }) } },
        {
          provide: OnboardingFlowService,
          useValue: {
            afterSave: jest.fn(),
            refreshProgress: jest.fn(),
            progress: signal(null),
            forOwner: signal(true),
            hint: signal(null),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(AdminSettingsPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('cannot be emptied: the form refuses to save without a number', async () => {
    const fixture = await render(brand);
    const page = fixture.componentInstance;

    page.form.controls.contactPhone.setValue('');

    expect(page.form.controls.contactPhone.hasError('required')).toBe(true);
    page.save();
    expect(updateMyBrand).not.toHaveBeenCalled();
  });

  it('asks a brand that has no number yet for one, and keeps it from saving until then', async () => {
    const fixture = await render({ ...brand, contactPhone: null });
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="phone-missing"]')?.textContent).toContain(
      'admin.settings.contactPhoneMissing',
    );
    expect(fixture.componentInstance.form.invalid).toBe(true);
  });

  it('always sends the number with the rest of the settings', async () => {
    const fixture = await render(brand);
    const page = fixture.componentInstance;

    page.form.controls.contactPhone.setValue('069 765 432');
    page.save();

    expect(updateMyBrand).toHaveBeenCalledWith(expect.objectContaining({ contactPhone: '069 765 432' }));
  });
});
