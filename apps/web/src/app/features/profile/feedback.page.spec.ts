import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';

import { API_CONFIG } from '../../core/api/api.config';
import { ProfileFeedbackPage } from './feedback.page';

describe('ProfileFeedbackPage', () => {
  let fixture: ComponentFixture<ProfileFeedbackPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [ProfileFeedbackPage],
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
    fixture = TestBed.createComponent(ProfileFeedbackPage);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const submit = () => el().querySelector<HTMLButtonElement>('button[type="submit"]');
  const type = (selector: string, value: string) => {
    const field = el().querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    if (!field) throw new Error(`no ${selector}`);
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const button = (text: string) =>
    Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

  it('keeps Send disabled until there is something to send', () => {
    expect(submit()?.disabled).toBe(true);
    type('textarea', '   ');
    expect(submit()?.disabled).toBe(true);
    type('textarea', 'Добавьте овсяное молоко');
    expect(submit()?.disabled).toBe(false);
  });

  it('sends the chosen kind, the trimmed text and the contact, then thanks', async () => {
    button('Проблема').click();
    fixture.detectChanges();
    expect(el().querySelector('textarea')?.placeholder).toContain('Если это про заказ');
    type('textarea', '  Кофе был холодный  ');
    type('input[name="contact"]', ' @ivan ');

    submit()?.click();
    fixture.detectChanges();
    expect(submit()?.disabled).toBe(true);
    expect(submit()?.textContent?.trim()).toBe('Отправляем…');

    const req = http.expectOne('/api/feedback');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      kind: 'PROBLEM',
      message: 'Кофе был холодный',
      source: 'WEB',
      contact: '@ivan',
    });
    req.flush({ id: 'fb-1', createdAt: '2026-10-07T10:00:00.000Z' });
    await fixture.whenStable();

    expect(el().textContent).toContain('Спасибо!');
    expect(el().querySelector('form')).toBeNull();
  });

  it('leaves out a blank contact', () => {
    type('textarea', 'Спасибо');
    submit()?.click();
    const req = http.expectOne('/api/feedback');
    expect(req.request.body).toEqual({ kind: 'SUGGESTION', message: 'Спасибо', source: 'WEB' });
    req.flush({ id: 'fb-1', createdAt: '2026-10-07T10:00:00.000Z' });
  });

  it('explains the hourly limit and keeps the text', async () => {
    type('textarea', 'Ещё одно сообщение');
    submit()?.click();
    http
      .expectOne('/api/feedback')
      .flush(
        { statusCode: 429, code: 'FEEDBACK_TOO_MANY', message: 'Too many' },
        { status: 429, statusText: 'Too Many Requests' },
      );
    await fixture.whenStable();

    expect(el().querySelector('[role="alert"]')?.textContent).toContain('Слишком много сообщений подряд');
    expect(el().querySelector('textarea')?.value).toBe('Ещё одно сообщение');
    expect(submit()?.disabled).toBe(false);
  });

  it('says so when the server cannot be reached', async () => {
    type('textarea', 'Привет');
    submit()?.click();
    http.expectOne('/api/feedback').error(new ProgressEvent('error'), { status: 0 });
    await fixture.whenStable();
    expect(el().querySelector('[role="alert"]')?.textContent?.trim()).toBe('Нет связи с сервером');
  });
});
