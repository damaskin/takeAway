import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';

import { API_CONFIG } from '../../core/api/api.config';
import type { AnnouncementRow } from './announcement.types';
import { AdminAnnouncementsPage } from './announcements.page';

function row(status: AnnouncementRow['status'], over: Partial<AnnouncementRow> = {}): AnnouncementRow {
  return {
    id: 'a1',
    title: 'Новый партнёр',
    status,
    scheduledAt: null,
    via: {},
    errors: [],
    ...over,
  } as AnnouncementRow;
}

describe('AdminAnnouncementsPage', () => {
  let page: AdminAnnouncementsPage;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminAnnouncementsPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService(),
        { provide: API_CONFIG, useValue: { baseUrl: '/api' } },
      ],
    });
    page = TestBed.createComponent(AdminAnnouncementsPage).componentInstance;
    http = TestBed.inject(HttpTestingController);
    page.ngOnInit();
    http.expectOne({ method: 'GET', url: '/api/admin/announcements' }).flush([row('DRAFT')]);
  });

  afterEach(() => http.verify());

  it('asks before sending to every customer, then sends', () => {
    page.send(row('DRAFT'));
    http.expectNone({ method: 'POST' });
    expect(page.confirming()).toEqual({ action: 'send', row: expect.objectContaining({ id: 'a1' }) });

    page.confirm({ action: 'send', row: row('DRAFT') });
    http.expectOne({ method: 'POST', url: '/api/admin/announcements/a1/send' }).flush(row('SENT'));

    expect(page.rows()[0]?.status).toBe('SENT');
    expect(page.confirming()).toBeNull();
    expect(page.notice()).toBe('admin.announcements.sendingNotice');
  });

  it('says when a send only scheduled it', () => {
    page.confirm({ action: 'send', row: row('DRAFT', { scheduledAt: '2026-10-15T09:00:00.000Z' }) });
    http
      .expectOne({ method: 'POST', url: '/api/admin/announcements/a1/send' })
      .flush(row('SCHEDULED', { scheduledAt: '2026-10-15T09:00:00.000Z' }));
    expect(page.notice()).toBe('admin.announcements.scheduledNotice');
  });

  it('cancels a schedule back to a draft', () => {
    page.cancel(row('SCHEDULED'));
    http.expectOne({ method: 'POST', url: '/api/admin/announcements/a1/cancel' }).flush(row('DRAFT'));
    expect(page.rows()[0]?.status).toBe('DRAFT');
  });

  it('deletes after the confirmation', () => {
    page.askRemove(row('DRAFT'));
    http.expectNone({ method: 'DELETE' });
    page.confirm({ action: 'delete', row: row('DRAFT') });
    http.expectOne({ method: 'DELETE', url: '/api/admin/announcements/a1' }).flush(null);
    expect(page.rows()).toEqual([]);
  });

  it('words the API refusal', () => {
    page.retry(row('SENT'));
    http
      .expectOne({ method: 'POST', url: '/api/admin/announcements/a1/send' })
      .flush({ code: 'ANNOUNCEMENT_NOT_SENDABLE' }, { status: 409, statusText: 'Conflict' });
    expect(page.error()).toBe('admin.announcements.errors.notSendable');
  });
});
