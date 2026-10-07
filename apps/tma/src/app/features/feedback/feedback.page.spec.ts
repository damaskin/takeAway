import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';

import { API_CONFIG } from '../../core/api/api.config';
import { TelegramBridgeService } from '../../core/telegram/telegram-bridge.service';
import { TmaFeedbackPage } from './feedback.page';

describe('TmaFeedbackPage', () => {
  let fixture: ComponentFixture<TmaFeedbackPage>;
  let http: HttpTestingController;
  let back: (() => void) | null;
  const detach = jest.fn();

  beforeEach(async () => {
    back = null;
    TestBed.configureTestingModule({
      imports: [TmaFeedbackPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: API_CONFIG, useValue: { baseUrl: '/api' } },
        {
          provide: TelegramBridgeService,
          useValue: {
            haptic: jest.fn(),
            setBackButton: (handler: () => void) => {
              back = handler;
              return detach;
            },
          },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TmaFeedbackPage);
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
  const type = (selector: string, value: string) => {
    const field = el().querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    if (!field) throw new Error(`no ${selector}`);
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  it('sends a review from the Mini App and thanks the customer', async () => {
    expect(button('Отправить').disabled).toBe(true);
    button('Отзыв').click();
    type('textarea', ' Лучший раф в городе ');

    button('Отправить').click();
    const req = http.expectOne('/api/feedback');
    expect(req.request.body).toEqual({ kind: 'REVIEW', message: 'Лучший раф в городе', source: 'TMA' });
    req.flush({ id: 'fb-1', createdAt: '2026-10-07T10:00:00.000Z' });
    await fixture.whenStable();

    expect(el().textContent).toContain('Спасибо!');
  });

  it('asks to sign in when the session is gone', async () => {
    type('textarea', 'Привет');
    button('Отправить').click();
    http.expectOne('/api/feedback').flush({ statusCode: 401 }, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    expect(el().querySelector('[role="alert"]')?.textContent?.trim()).toBe('Войдите, чтобы отправить сообщение.');
  });

  it('goes back to the profile with Telegram’s back button and lets it go on leaving', () => {
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    back?.();
    expect(navigate).toHaveBeenCalledWith(['/profile']);
    fixture.destroy();
    expect(detach).toHaveBeenCalled();
  });
});
