import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, type Translation, provideTranslateService } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';
import type { TelegramNotifyStatus } from '@takeaway/shared-types';
import { TELEGRAM_AUTH_CONFIG } from '@takeaway/ui-kit';
import { of, throwError } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { AuthStore } from '../../core/auth/auth.store';
import { TelegramNotifyService } from '../../core/telegram/telegram-notify.service';
import { LINK_POLL_MS, TelegramLinkPage } from './telegram-link.page';

const LINK = 'https://t.me/takaway_tgbot?start=link_AbCdEfGhIjKlMnOpQrStUv';

describe('TelegramLinkPage', () => {
  let api: { status: jest.Mock; issue: jest.Mock; unlink: jest.Mock };

  function make(opts: { status?: TelegramNotifyStatus; kitchen?: boolean; clientId?: string | null } = {}) {
    api = {
      status: jest.fn().mockReturnValue(of(opts.status ?? { linked: false, botLinkAvailable: true })),
      issue: jest.fn().mockReturnValue(of({ url: LINK, expiresAt: new Date(Date.now() + 600_000).toISOString() })),
      unlink: jest.fn().mockReturnValue(of({ linked: false, botLinkAvailable: true })),
    };
    TestBed.configureTestingModule({
      imports: [TelegramLinkPage],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'ru' }),
        { provide: TelegramNotifyService, useValue: api },
        { provide: AuthService, useValue: { linkTelegramIdToken: jest.fn(), linkTelegram: jest.fn() } },
        { provide: AuthStore, useValue: { kitchenSession: signal(!!opts.kitchen) } },
        {
          provide: TELEGRAM_AUTH_CONFIG,
          useValue: { clientId: opts.clientId === undefined ? null : opts.clientId, botUsername: null },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    const fixture = TestBed.createComponent(TelegramLinkPage);
    fixture.detectChanges();
    return { page: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, fixture };
  }

  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => jest.useRealTimers());

  it('shows a QR code and the link to the bot, then «linked» once the bot has it', () => {
    jest.useFakeTimers();
    const { page, el, fixture } = make();
    expect(el.querySelector('[data-testid="tg-not-linked"]')).not.toBeNull();

    page.makeLink();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="tg-pending"] svg path')?.getAttribute('d')).toMatch(/^M\d+ \d+h1v1h-1z/);
    expect(el.querySelector('[data-testid="tg-open"]')?.getAttribute('href')).toBe(LINK);

    // Not yet: the page keeps waiting.
    jest.advanceTimersByTime(LINK_POLL_MS);
    expect(page.pending()).not.toBeNull();

    api.status.mockReturnValue(of({ linked: true, botLinkAvailable: true }));
    jest.advanceTimersByTime(LINK_POLL_MS);
    fixture.detectChanges();
    expect(page.pending()).toBeNull();
    expect(el.querySelector('[data-testid="tg-linked"]')).not.toBeNull();

    // And it stops asking.
    const calls = api.status.mock.calls.length;
    jest.advanceTimersByTime(LINK_POLL_MS * 3);
    expect(api.status.mock.calls.length).toBe(calls);
  });

  it('stops waiting when the link expires and offers a new one', () => {
    jest.useFakeTimers();
    const { page, el, fixture } = make();
    api.issue.mockReturnValue(of({ url: LINK, expiresAt: new Date(Date.now() + LINK_POLL_MS / 2).toISOString() }));
    page.makeLink();
    jest.advanceTimersByTime(LINK_POLL_MS);
    fixture.detectChanges();
    expect(page.pending()).toBeNull();
    expect(el.querySelector('[data-testid="tg-expired"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="tg-make-link"]')).not.toBeNull();
  });

  it('unlinks after asking', () => {
    const { page, el, fixture } = make({ status: { linked: true, botLinkAvailable: true } });
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    expect(el.querySelector('[data-testid="tg-unlink"]')).not.toBeNull();
    page.unlink();
    fixture.detectChanges();
    expect(api.unlink).toHaveBeenCalled();
    expect(el.querySelector('[data-testid="tg-not-linked"]')).not.toBeNull();
  });

  it('says the bot is not set up when it cannot link — on the tablet, with no other way', () => {
    const { el } = make({ status: { linked: false, botLinkAvailable: false }, kitchen: true, clientId: '123' });
    expect(el.querySelector('[data-testid="tg-unavailable"]')).not.toBeNull();
    expect(el.querySelector('lib-telegram-oidc-button')).toBeNull();
  });

  it('offers the older Telegram sign-in button in a password session while the bot cannot link', () => {
    const { el } = make({ status: { linked: false, botLinkAvailable: false }, clientId: '123' });
    expect(el.querySelector('lib-telegram-oidc-button')).not.toBeNull();
    expect(el.querySelector('[data-testid="tg-make-link"]')).toBeNull();
  });

  it('words a refusal of the bot link', () => {
    const { page } = make();
    api.issue.mockReturnValue(
      throwError(() => ({ status: 503, error: { code: 'TELEGRAM_NOTIFY_LINK_UNAVAILABLE', message: 'x' } })),
    );
    page.makeLink();
    expect(page.error()).toContain('не настроена');
  });
});
