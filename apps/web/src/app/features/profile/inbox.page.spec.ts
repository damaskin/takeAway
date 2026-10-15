import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { InboxItem, InboxPage } from '@takeaway/shared-types';

import { API_CONFIG } from '../../core/api/api.config';
import { InboxService, inboxLinkRoute } from '../../core/inbox/inbox.service';
import { ProfileInboxPage } from './inbox.page';

function item(over: Partial<InboxItem> & Pick<InboxItem, 'id'>): InboxItem {
  return {
    kind: 'BRAND_CAMPAIGN',
    title: 'Скидка 20%',
    body: 'На капучино до пятницы',
    sender: { kind: 'BRAND', name: 'NoName Coffee', logoUrl: null, brandId: 'b1' },
    link: null,
    createdAt: '2026-10-14T10:00:00.000Z',
    readAt: null,
    ...over,
  };
}

const page = (items: InboxItem[], unreadCount: number, nextCursor: string | null = null): InboxPage => ({
  items,
  nextCursor,
  unreadCount,
});

describe('ProfileInboxPage', () => {
  let fixture: ComponentFixture<ProfileInboxPage>;
  let http: HttpTestingController;

  async function render(query: Record<string, string> = {}) {
    TestBed.configureTestingModule({
      imports: [ProfileInboxPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: API_CONFIG, useValue: { baseUrl: '/api' } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProfileInboxPage);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => http.verify());

  const el = () => fixture.nativeElement as HTMLElement;

  it('lists messages with their sender, and takeAway for a platform announcement', async () => {
    await render();
    http.expectOne('/api/inbox').flush(
      page(
        [
          item({ id: 'n1' }),
          item({
            id: 'n2',
            kind: 'PLATFORM_ANNOUNCEMENT',
            title: 'Новый партнёр',
            sender: { kind: 'PLATFORM', name: 'takeAway', logoUrl: null, brandId: null },
            readAt: '2026-10-14T11:00:00.000Z',
          }),
        ],
        1,
      ),
    );
    fixture.detectChanges();

    const text = el().textContent ?? '';
    expect(text).toContain('NoName Coffee');
    expect(text).toContain('takeAway');
    expect(el().querySelectorAll('.unread-dot')).toHaveLength(1);
    expect(TestBed.inject(InboxService).unreadCount()).toBe(1);
  });

  it('opening a message marks it read and offers the linked menu', async () => {
    await render();
    const linked = item({
      id: 'n1',
      link: { kind: 'STORE', storeId: 's1', storeSlug: 'noname-center', brandId: 'b1', name: 'NoName Центр' },
    });
    http.expectOne('/api/inbox').flush(page([linked], 1));
    fixture.detectChanges();

    el().querySelector<HTMLButtonElement>('.inbox-row')?.click();
    fixture.detectChanges();

    http.expectOne({ method: 'POST', url: '/api/inbox/n1/read' }).flush(null);
    expect(el().querySelectorAll('.unread-dot')).toHaveLength(0);
    expect(TestBed.inject(InboxService).unreadCount()).toBe(0);
    const cta = el().querySelector<HTMLAnchorElement>('.link-cta');
    expect(cta?.getAttribute('href')).toBe('/stores/noname-center');
  });

  it('opens the message a tapped push points at, fetching it when it is not on the first page', async () => {
    await render({ open: 'old' });
    http.expectOne('/api/inbox').flush(page([item({ id: 'n1' })], 2));
    http.expectOne('/api/inbox/old').flush(item({ id: 'old', title: 'Старая рассылка' }));
    http.expectOne({ method: 'POST', url: '/api/inbox/old/read' }).flush(null);
    fixture.detectChanges();

    expect(fixture.componentInstance.openId()).toBe('old');
    expect(fixture.componentInstance.items()[0]?.id).toBe('old');
  });

  it('marks everything read at once', async () => {
    await render();
    http.expectOne('/api/inbox').flush(page([item({ id: 'n1' }), item({ id: 'n2' })], 2));
    fixture.detectChanges();

    fixture.componentInstance.readAll();
    http.expectOne({ method: 'POST', url: '/api/inbox/read-all' }).flush(null);
    fixture.detectChanges();

    expect(el().querySelectorAll('.unread-dot')).toHaveLength(0);
    expect(TestBed.inject(InboxService).unreadCount()).toBe(0);
  });
});

describe('inboxLinkRoute', () => {
  it("opens a store's menu, or the list of places for a brand with several stores", () => {
    expect(inboxLinkRoute({ kind: 'STORE', storeId: 's1', storeSlug: 'one', brandId: 'b', name: 'x' })).toBe(
      '/stores/one',
    );
    expect(inboxLinkRoute({ kind: 'BRAND', storeId: 's2', storeSlug: 'solo', brandId: 'b', name: 'x' })).toBe(
      '/stores/solo',
    );
    expect(inboxLinkRoute({ kind: 'BRAND', storeId: null, storeSlug: null, brandId: 'b', name: 'x' })).toBe('/stores');
  });
});
