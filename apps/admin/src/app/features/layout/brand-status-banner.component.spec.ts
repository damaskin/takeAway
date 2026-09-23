import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import type { BrandDto } from '../../core/catalog/admin-catalog.service';
import { FeatureFlagsStore } from '../../core/config/feature-flags.store';
import { OnboardingApi } from '../../core/onboarding/onboarding.service';
import { BrandStatusBannerComponent } from './brand-status-banner.component';

function brand(moderationStatus: BrandDto['moderationStatus'], moderationNote: string | null = null): BrandDto {
  return {
    id: 'b1',
    slug: 'b1',
    name: 'Ромашка',
    currency: 'MDL',
    locale: 'RU',
    logoUrl: null,
    moderationStatus,
    moderationNote,
  };
}

describe('BrandStatusBannerComponent', () => {
  let resubmit: jest.Mock;
  let refresh: jest.Mock;

  function make(role: string, active: BrandDto): BrandStatusBannerComponent {
    resubmit = jest.fn().mockReturnValue(of({}));
    refresh = jest.fn();
    TestBed.configureTestingModule({
      imports: [BrandStatusBannerComponent],
      providers: [
        provideTranslateService(),
        { provide: AuthStore, useValue: { user: signal({ role }) } },
        { provide: ActiveBrandService, useValue: { active: signal(active), refresh } },
        { provide: FeatureFlagsStore, useValue: { support: signal(null) } },
        { provide: OnboardingApi, useValue: { resubmit } },
      ],
    });
    return TestBed.createComponent(BrandStatusBannerComponent).componentInstance;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it("speaks to the owner while the brand is waiting or rejected, and stays quiet once it's live", () => {
    expect(make('BRAND_ADMIN', brand('PENDING')).brand()?.id).toBe('b1');
    TestBed.resetTestingModule();
    expect(make('BRAND_ADMIN', brand('REJECTED', 'Нет фото')).brand()?.moderationNote).toBe('Нет фото');
    TestBed.resetTestingModule();
    expect(make('BRAND_ADMIN', brand('APPROVED')).brand()).toBeNull();
  });

  it('is not shown to platform admins, who moderate on the brands page', () => {
    expect(make('SUPER_ADMIN', brand('PENDING')).brand()).toBeNull();
  });

  it('sends the brand in view back for review and reloads its status', () => {
    const banner = make('BRAND_ADMIN', brand('REJECTED', 'Нет фото'));
    banner.confirming.set(true);

    banner.resubmit();

    expect(resubmit).toHaveBeenCalledWith('b1');
    expect(refresh).toHaveBeenCalled();
    expect(banner.confirming()).toBe(false);
    expect(banner.error()).toBeNull();
  });

  it('treats "already under review" as done, not as a failure', () => {
    const banner = make('BRAND_ADMIN', brand('REJECTED'));
    resubmit.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'NOT_REJECTED' } })));

    banner.resubmit();

    expect(refresh).toHaveBeenCalled();
    expect(banner.error()).toBeNull();
  });

  it('keeps the owner on the banner with a message when the request fails', () => {
    const banner = make('BRAND_ADMIN', brand('REJECTED'));
    resubmit.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

    banner.resubmit();

    expect(refresh).not.toHaveBeenCalled();
    expect(banner.error()).toBe('common.genericError');
    expect(banner.sending()).toBe(false);
  });
});
