import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';

import { API_CONFIG } from '../../core/api/api.config';
import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import type { CampaignRow } from './campaign.types';
import { AdminCampaignsPage } from './campaigns.page';

function row(status: CampaignRow['status']): CampaignRow {
  return { id: 'c1', title: 'Скидка', status } as CampaignRow;
}

describe('AdminCampaignsPage', () => {
  let page: AdminCampaignsPage;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminCampaignsPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService(),
        { provide: API_CONFIG, useValue: { baseUrl: '/api' } },
        { provide: AuthStore, useValue: { user: signal({ role: 'BRAND_ADMIN' }) } },
        {
          provide: ActiveBrandService,
          useValue: { activeId: signal(null), loaded: signal(true), loadError: signal(null), refresh: jest.fn() },
        },
      ],
    });
    page = TestBed.createComponent(AdminCampaignsPage).componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  it('deletes a draft at once', () => {
    page.askRemove(row('DRAFT'));

    expect(page.removing()).toBeNull();
    http.expectOne({ method: 'DELETE', url: '/api/admin/campaigns/c1' }).flush(null);
  });

  it.each(['PENDING_REVIEW', 'APPROVED'] as const)('asks before deleting a %s campaign', (status) => {
    page.askRemove(row(status));

    expect(page.removing()).toEqual(expect.objectContaining({ status }));
    http.expectNone({ method: 'DELETE' });

    page.remove(row(status));
    http.expectOne({ method: 'DELETE', url: '/api/admin/campaigns/c1' }).flush(null);
    expect(page.removing()).toBeNull();
  });

  it('withdraws a campaign under review back to a draft', () => {
    page.rows.set([row('PENDING_REVIEW')]);

    page.withdraw(row('PENDING_REVIEW'));
    http.expectOne({ method: 'POST', url: '/api/admin/campaigns/c1/withdraw' }).flush(row('DRAFT'));

    expect(page.rows()[0]?.status).toBe('DRAFT');
    expect(page.notice()).toBe('admin.campaigns.moderation.withdrawn');
  });
});
