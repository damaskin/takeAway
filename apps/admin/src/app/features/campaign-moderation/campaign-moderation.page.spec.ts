import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import { of, throwError } from 'rxjs';

import { CampaignModerationApi } from '../../core/campaigns/campaign-moderation.service';
import type { ModerationCampaign } from '../campaigns/campaign.types';
import { CampaignModerationPage } from './campaign-moderation.page';

function campaign(id: string): ModerationCampaign {
  return {
    id,
    brandId: 'b1',
    title: 'Скидка',
    body: '−20% на капучино',
    channel: 'PUSH',
    audience: 'ALL',
    inactiveDays: null,
    storeId: null,
    status: 'PENDING_REVIEW',
    targetCount: 0,
    sentCount: 0,
    failedCount: 0,
    noChannelCount: 0,
    optedOutCount: 0,
    lastError: null,
    via: { apns: 0, fcm: 0, webpush: 0, telegram: 0, email: 0 },
    errors: [],
    sendable: false,
    editable: false,
    deletable: true,
    scheduledAt: null,
    submittedAt: '2026-10-10T09:00:00.000Z',
    reviewedAt: null,
    reviewNote: null,
    approvedAt: null,
    startedAt: null,
    sentAt: null,
    createdAt: '2026-10-10T08:00:00.000Z',
    brand: { id: 'b1', name: 'Кофейня Ромашка', slug: 'romashka', logoUrl: null },
    createdBy: null,
    reviewedBy: null,
    reach: null,
  };
}

describe('CampaignModerationPage', () => {
  let api: {
    list: jest.Mock;
    approve: jest.Mock;
    reject: jest.Mock;
    setPendingCount: jest.Mock;
    pendingCount: () => number;
  };

  async function make(): Promise<CampaignModerationPage> {
    api = {
      list: jest.fn().mockReturnValue(of([campaign('c1'), campaign('c2')])),
      approve: jest.fn().mockReturnValue(of({ ...campaign('c1'), status: 'APPROVED' })),
      reject: jest.fn().mockReturnValue(of({ ...campaign('c2'), status: 'REJECTED' })),
      setPendingCount: jest.fn(),
      pendingCount: () => 2,
    };
    TestBed.configureTestingModule({
      imports: [CampaignModerationPage],
      providers: [provideTranslateService({ fallbackLang: 'ru' }), { provide: CampaignModerationApi, useValue: api }],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(CampaignModerationPage);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('opens on the queue and keeps the sidebar badge in step', async () => {
    const page = await make();

    expect(api.list).toHaveBeenCalledWith('PENDING_REVIEW');
    expect(page.items().map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(api.setPendingCount).toHaveBeenLastCalledWith(2);
  });

  it('takes a decided campaign out of the queue', async () => {
    const page = await make();

    page.approve(page.items()[0] as ModerationCampaign);
    page.reject(page.items()[0] as ModerationCampaign, 'Уберите капс');

    expect(api.approve).toHaveBeenCalledWith('c1');
    expect(api.reject).toHaveBeenCalledWith('c2', 'Уберите капс');
    expect(page.items()).toEqual([]);
    expect(api.setPendingCount).toHaveBeenLastCalledWith(0);
  });

  it('says so when someone else decided first, and reloads the queue', async () => {
    const page = await make();
    api.approve.mockReturnValue(
      throwError(
        () => new HttpErrorResponse({ status: 409, error: { code: 'CAMPAIGN_NOT_PENDING', message: 'not pending' } }),
      ),
    );

    page.approve(page.items()[0] as ModerationCampaign);

    expect(page.error()).toBe(TRANSLATIONS_RU.admin.campaigns.errors.notPending);
    expect(api.list).toHaveBeenCalledTimes(2);
  });
});
