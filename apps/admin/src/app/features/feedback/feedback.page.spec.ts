import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { AdminFeedback, AdminFeedbackPage } from '@takeaway/shared-types';

import { API_CONFIG } from '../../core/api/api.config';
import { FeedbackApi } from '../../core/feedback/feedback.service';
import { CustomerFeedbackPage } from './feedback.page';

function item(overrides: Partial<AdminFeedback> = {}): AdminFeedback {
  return {
    id: 'fb-1',
    kind: 'PROBLEM',
    message: 'Кофе был холодный',
    contact: '@ivan',
    source: 'IOS',
    appVersion: '1.2.0 (3)',
    status: 'NEW',
    createdAt: '2026-10-07T10:00:00.000Z',
    readAt: null,
    author: {
      id: 'u1',
      name: 'Иван',
      email: 'ivan@example.com',
      phone: null,
      telegramUserId: '777',
      deleted: false,
    },
    ...overrides,
  };
}

function pageOf(items: AdminFeedback[], newCount = 1): AdminFeedbackPage {
  return { items, total: items.length, page: 1, pageSize: 20, newCount };
}

describe('CustomerFeedbackPage', () => {
  let fixture: ComponentFixture<CustomerFeedbackPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [CustomerFeedbackPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: API_CONFIG, useValue: { baseUrl: '/api' } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CustomerFeedbackPage);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.trim().startsWith(text)) as
      | HTMLButtonElement
      | undefined;
  const expectList = (query: string) => {
    const req = http.expectOne((r) => r.url === '/api/admin/feedback');
    expect(req.request.params.toString()).toBe(query);
    return req;
  };

  it('opens on the inbox, newest first as the API sends it, with who wrote and how to reach them', async () => {
    expectList('page=1&pageSize=20').flush(pageOf([item(), item({ id: 'fb-2', kind: 'REVIEW', status: 'READ' })]));
    await fixture.whenStable();

    const cards = el().querySelectorAll('article');
    expect(cards).toHaveLength(2);
    const first = cards[0]?.textContent ?? '';
    expect(first).toContain('Проблема');
    expect(first).toContain('Новое');
    expect(first).toContain('Кофе был холодный');
    expect(first).toContain('Иван');
    expect(first).toContain('ivan@example.com · Telegram ID 777');
    expect(first).toContain('@ivan');
    expect(first).toContain('iOS 1.2.0 (3)');
    expect(button('Непрочитанные')?.textContent).toContain('· 1');
    expect(TestBed.inject(FeedbackApi).newCount()).toBe(1);
  });

  it('filters by tab and kind', async () => {
    expectList('page=1&pageSize=20').flush(pageOf([]));
    await fixture.whenStable();

    button('Архив')?.click();
    fixture.detectChanges();
    expectList('status=ARCHIVED&page=1&pageSize=20').flush(pageOf([]));
    await fixture.whenStable();

    const select = el().querySelector('select') as HTMLSelectElement;
    select.value = 'SUGGESTION';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expectList('status=ARCHIVED&kind=SUGGESTION&page=1&pageSize=20').flush(pageOf([]));
    await fixture.whenStable();
    expect(el().textContent).toContain('Здесь пока пусто.');
  });

  it('marks read in place and keeps the badge in step', async () => {
    expectList('page=1&pageSize=20').flush(pageOf([item()], 1));
    await fixture.whenStable();

    button('Прочитано')?.click();
    const req = http.expectOne('/api/admin/feedback/fb-1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'READ' });
    req.flush(item({ status: 'READ', readAt: '2026-10-07T11:00:00.000Z' }));
    await fixture.whenStable();

    expect(el().querySelectorAll('article')).toHaveLength(1);
    expect(button('Непрочитано')).toBeDefined();
    expect(TestBed.inject(FeedbackApi).newCount()).toBe(0);
  });

  it('drops an archived card from the inbox', async () => {
    expectList('page=1&pageSize=20').flush(pageOf([item({ status: 'READ' })], 0));
    await fixture.whenStable();

    button('В архив')?.click();
    http.expectOne('/api/admin/feedback/fb-1').flush(item({ status: 'ARCHIVED' }));
    await fixture.whenStable();

    expect(el().querySelectorAll('article')).toHaveLength(0);
    expect(el().textContent).toContain('Здесь пока пусто.');
  });

  it('names a deleted account and a feedback without one', async () => {
    expectList('page=1&pageSize=20').flush(
      pageOf([
        item({
          author: { id: 'u1', name: null, email: null, phone: null, telegramUserId: null, deleted: true },
          contact: null,
        }),
        item({ id: 'fb-2', author: null }),
      ]),
    );
    await fixture.whenStable();

    const cards = el().querySelectorAll('article');
    expect(cards[0]?.textContent).toContain('— (аккаунт удалён)');
    expect(cards[1]?.textContent).toContain('Без аккаунта');
  });
});
